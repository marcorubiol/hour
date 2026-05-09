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
  return {
    apikey: env.SUPABASE_SECRET_KEY,
    Authorization: `Bearer ${env.SUPABASE_SECRET_KEY}`,
  };
}

/**
 * Fetch the workspace_id that owns `(targetTable, targetId)`. The DO needs
 * this to write `collab_snapshot.workspace_id` (FK + audit). Caller in
 * hour-web has already validated user membership via RLS; here we use the
 * secret key because the DO has no user JWT.
 *
 * Returns null when the row doesn't exist (or was soft-deleted).
 */
export async function fetchWorkspaceId(
  env: PersistEnv,
  targetTable: 'show' | 'project',
  targetId: string,
): Promise<string | null> {
  const url = new URL(`/rest/v1/${targetTable}`, env.PUBLIC_SUPABASE_URL);
  url.searchParams.set('id', `eq.${targetId}`);
  url.searchParams.set('select', 'workspace_id');
  url.searchParams.set('limit', '1');

  const res = await fetch(url, { headers: authHeaders(env) });
  if (!res.ok) {
    throw new Error(`fetchWorkspaceId(${targetTable}/${targetId}): ${res.status}`);
  }
  const rows = (await res.json()) as { workspace_id: string }[];
  return rows[0]?.workspace_id ?? null;
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
      Prefer: 'return=minimal',
    },
    body,
  });

  if (!res.ok) {
    throw new Error(`saveSnapshot: ${res.status} ${await res.text()}`);
  }
}
