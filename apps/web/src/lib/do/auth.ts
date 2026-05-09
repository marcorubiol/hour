/**
 * Auth gate for /api/collab/[target_table]/[target_id] WebSocket upgrades.
 *
 * Strategy: resolve `workspace_id` from the target row using the user's JWT.
 * Postgres validates the JWT (no separate `/auth/v1/user` round-trip), and
 * RLS hides the row if the user isn't a member — so a non-empty result
 * proves both auth and membership in one call.
 */

export interface CollabAuthEnv {
  PUBLIC_SUPABASE_URL: string;
  PUBLIC_SUPABASE_ANON_KEY: string;
}

export interface CollabAuthOk {
  ok: true;
  workspaceId: string;
}

export interface CollabAuthFail {
  ok: false;
  status: number;
  reason: string;
}

export type CollabAuthResult = CollabAuthOk | CollabAuthFail;

const ALLOWED_TABLES = new Set(['show', 'project']);

export function isAllowedTargetTable(t: string): t is 'show' | 'project' {
  return ALLOWED_TABLES.has(t);
}

export async function authorizeCollab(
  env: CollabAuthEnv,
  jwt: string,
  targetTable: string,
  targetId: string,
): Promise<CollabAuthResult> {
  if (!isAllowedTargetTable(targetTable)) {
    return { ok: false, status: 400, reason: 'unsupported-target-table' };
  }
  if (!targetId) {
    return { ok: false, status: 400, reason: 'missing-target-id' };
  }
  if (!jwt) {
    return { ok: false, status: 401, reason: 'missing-jwt' };
  }

  const url = new URL(`/rest/v1/${targetTable}`, env.PUBLIC_SUPABASE_URL);
  url.searchParams.set('id', `eq.${targetId}`);
  url.searchParams.set('select', 'workspace_id');
  url.searchParams.set('limit', '1');

  let res: Response;
  try {
    res = await fetch(url, {
      headers: {
        apikey: env.PUBLIC_SUPABASE_ANON_KEY,
        Authorization: `Bearer ${jwt}`,
      },
    });
  } catch (e) {
    return { ok: false, status: 502, reason: `network-${(e as Error).message}` };
  }

  if (res.status === 401) {
    return { ok: false, status: 401, reason: 'jwt-rejected' };
  }
  if (!res.ok) {
    return { ok: false, status: 502, reason: `lookup-${res.status}` };
  }

  const rows = (await res.json()) as { workspace_id: string }[];
  if (rows.length === 0) {
    // Either the target doesn't exist, was soft-deleted, or RLS hid it
    // because the user isn't a member. Don't leak which.
    return { ok: false, status: 403, reason: 'not-found-or-forbidden' };
  }

  return { ok: true, workspaceId: rows[0].workspace_id };
}
