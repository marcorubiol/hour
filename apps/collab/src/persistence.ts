/**
 * Snapshot persistence + workspace lookup for the RoadsheetCollab DO.
 *
 * All calls authenticate as Postgres `service_role` via the new-model secret
 * key (`sb_secret_...`), bypassing RLS. The DO is the only writer of
 * `collab_snapshot`; the `service_role` permission is intentionally narrow.
 *
 * The legacy `service_role` JWT is NOT supported here — only the new
 * `sb_secret_...` format. Set with:
 *     pnpm wrangler secret put SUPABASE_SECRET_KEY
 */

export interface PersistEnv {
  PUBLIC_SUPABASE_URL: string;
  SUPABASE_SECRET_KEY: string;
}

import type { CollabTargetTable } from './persistence-guard';
import type { ScheduleSlot } from './schedule';

const TABLE = 'collab_snapshot';

function bytesToHex(bytes: Uint8Array): string {
  let hex = '';
  for (let i = 0; i < bytes.length; i++) {
    hex += bytes[i].toString(16).padStart(2, '0');
  }
  return hex;
}

function hexToBytes(hex: string): Uint8Array {
  const clean = hex.startsWith('\\x') ? hex.slice(2) : hex;
  const bytes = new Uint8Array(clean.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = Number.parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

function authHeaders(env: PersistEnv): Record<string, string> {
  // New-model secret keys authenticate via the apikey header alone; adding
  // an Authorization: Bearer with the same sb_secret makes the gateway
  // parse it as a (invalid) JWT and demote the role (found live 2026-07-02:
  // 200 + zero rows on a row that exists).
  return {
    apikey: env.SUPABASE_SECRET_KEY,
  };
}

export interface TargetMeta {
  workspace_id: string;
  /** Current text of the target's notes column — seeds a fresh doc. Null for
   *  a target whose doc does not own its notes (a `date`). */
  notes: string | null;
}

/**
 * Fetch the workspace_id (FK for collab_snapshot) + current notes text of
 * `(targetTable, targetId)` in one round-trip. Caller in hour-web has
 * already validated user membership via RLS; here we use the secret key
 * because the DO has no user JWT.
 *
 * Returns null when the row doesn't exist (or was soft-deleted).
 */
export async function fetchTargetMeta(
  env: PersistEnv,
  targetTable: CollabTargetTable,
  targetId: string,
  withNotes = true,
): Promise<TargetMeta | null> {
  const url = new URL(`/rest/v1/${targetTable}`, env.PUBLIC_SUPABASE_URL);
  url.searchParams.set('id', `eq.${targetId}`);
  url.searchParams.set('select', withNotes ? 'workspace_id,notes' : 'workspace_id');
  url.searchParams.set('deleted_at', 'is.null');
  url.searchParams.set('limit', '1');

  const res = await fetch(url, { headers: authHeaders(env) });
  const body = await res.text();
  if (!res.ok) {
    throw new Error(`fetchTargetMeta(${targetTable}/${targetId}): ${res.status}`);
  }
  const rows = (body ? JSON.parse(body) : []) as Array<Partial<TargetMeta>>;
  const row = rows[0];
  if (!row?.workspace_id) return null;
  return { workspace_id: row.workspace_id, notes: row.notes ?? null };
}

/**
 * Materialize the collaborative doc's text back into the target's `notes`
 * column, so non-collab read surfaces (road sheet projection, detail
 * endpoint, future exports) see current content. Push-on-change — no
 * state machine (ADR-023). Empty text stores NULL.
 */
export async function writeNotesColumn(
  env: PersistEnv,
  targetTable: CollabTargetTable,
  targetId: string,
  text: string,
): Promise<void> {
  const url = new URL(`/rest/v1/${targetTable}`, env.PUBLIC_SUPABASE_URL);
  url.searchParams.set('id', `eq.${targetId}`);

  const res = await fetch(url, {
    method: 'PATCH',
    headers: {
      ...authHeaders(env),
      'content-type': 'application/json',
      Prefer: 'return=minimal',
    },
    body: JSON.stringify({ notes: text.length > 0 ? text : null }),
  });

  if (!res.ok) {
    throw new Error(`writeNotesColumn: ${res.status} ${await res.text()}`);
  }
}

export async function loadLatestSnapshot(
  env: PersistEnv,
  targetTable: string,
  targetId: string,
): Promise<{ snapshot: Uint8Array; version: number } | null> {
  const url = new URL(`/rest/v1/${TABLE}`, env.PUBLIC_SUPABASE_URL);
  url.searchParams.set('target_table', `eq.${targetTable}`);
  url.searchParams.set('target_id', `eq.${targetId}`);
  url.searchParams.set('select', 'snapshot,version');
  url.searchParams.set('order', 'version.desc');
  url.searchParams.set('limit', '1');

  const res = await fetch(url, { headers: authHeaders(env) });
  if (!res.ok) {
    throw new Error(`loadLatestSnapshot: ${res.status} ${await res.text()}`);
  }
  const rows = (await res.json()) as { snapshot: string; version: number }[];
  if (rows.length === 0) return null;
  return { snapshot: hexToBytes(rows[0].snapshot), version: rows[0].version };
}

export async function saveSnapshot(
  env: PersistEnv,
  workspaceId: string,
  targetTable: string,
  targetId: string,
  snapshot: Uint8Array,
  version: number,
): Promise<void> {
  const url = new URL(`/rest/v1/${TABLE}`, env.PUBLIC_SUPABASE_URL);
  const body = JSON.stringify({
    workspace_id: workspaceId,
    target_table: targetTable,
    target_id: targetId,
    // PostgREST accepts bytea in JSON as a hex string with `\x` prefix.
    snapshot: '\\x' + bytesToHex(snapshot),
    version,
  });

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      ...authHeaders(env),
      'content-type': 'application/json',
      // Upsert on the (target_table, target_id, version) unique index. A save
      // that already wrote the snapshot row but failed to advance the durable
      // marker retries the SAME version; without merge-duplicates that retry
      // 23505s forever (found by review: persistence-guard commit ordering).
      // Merging makes the retry a harmless overwrite with the newer doc state.
      Prefer: 'return=minimal, resolution=merge-duplicates',
    },
    body,
  });

  if (!res.ok) {
    throw new Error(`saveSnapshot: ${res.status} ${await res.text()}`);
  }
}

/**
 * Drop snapshot rows older than `keepFromVersion` for a target. Each save
 * writes a full-document row and only the latest is ever read, so without
 * pruning `collab_snapshot` grows unbounded (one ever-larger row per ~30
 * edits). Keep a small tail for safety. Best-effort — a failed prune must
 * never fail the save that just committed.
 */
export async function pruneSnapshots(
  env: PersistEnv,
  targetTable: string,
  targetId: string,
  keepFromVersion: number,
): Promise<void> {
  if (keepFromVersion <= 0) return;
  const url = new URL(`/rest/v1/${TABLE}`, env.PUBLIC_SUPABASE_URL);
  url.searchParams.set('target_table', `eq.${targetTable}`);
  url.searchParams.set('target_id', `eq.${targetId}`);
  url.searchParams.set('version', `lt.${keepFromVersion}`);

  const res = await fetch(url, {
    method: 'DELETE',
    headers: { ...authHeaders(env), Prefer: 'return=minimal' },
  });
  if (!res.ok) {
    throw new Error(`pruneSnapshots: ${res.status} ${await res.text()}`);
  }
}

/**
 * The running order's rows, in their order: what seeds a doc that has never
 * held a `schedule` (ADR-090 risk 1). `service_role` reads `schedule_slot`
 * since 20261010220000 (SELECT only).
 */
export async function fetchScheduleRows(
  env: PersistEnv,
  targetTable: 'performance' | 'date',
  targetId: string,
): Promise<ScheduleSlot[]> {
  const url = new URL('/rest/v1/schedule_slot', env.PUBLIC_SUPABASE_URL);
  url.searchParams.set(
    targetTable === 'performance' ? 'performance_id' : 'date_id',
    `eq.${targetId}`,
  );
  url.searchParams.set('select', 'id,kind,label,at,ends_at,notes');
  url.searchParams.set('order', 'sort.asc');

  const res = await fetch(url, { headers: authHeaders(env) });
  if (!res.ok) {
    throw new Error(
      `fetchScheduleRows(${targetTable}/${targetId}): ${res.status} ${await res.text()}`,
    );
  }
  return (await res.json()) as ScheduleSlot[];
}

/** A PostgREST refusal, carrying the status so a caller can tell «not this user». */
export class PostgrestError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

/**
 * Materialize the doc's running order into `schedule_slot` (ADR-090 P2): the
 * whole order, diffed by id in one transaction, through the service-only RPC
 * that gates on `edit:performance` OF `userId` and signs the audit with them.
 * A 401/403 means that user may not write this order (any more).
 */
export async function replaceScheduleSlots(
  env: PersistEnv,
  userId: string,
  targetTable: 'performance' | 'date',
  targetId: string,
  slots: readonly ScheduleSlot[],
): Promise<void> {
  const res = await fetch(
    new URL('/rest/v1/rpc/replace_schedule_slots_for_user', env.PUBLIC_SUPABASE_URL),
    {
      method: 'POST',
      headers: {
        ...authHeaders(env),
        'content-type': 'application/json',
        Prefer: 'return=minimal',
      },
      body: JSON.stringify({
        p_user_id: userId,
        p_target_table: targetTable,
        p_target_id: targetId,
        p_slots: slots,
      }),
    },
  );
  if (!res.ok) {
    throw new PostgrestError(
      `replaceScheduleSlots: ${res.status} ${await res.text()}`,
      res.status,
    );
  }
}
