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
  userId: string;
  expiresAt: number;
}

export interface CollabAuthFail {
  ok: false;
  status: number;
  reason: string;
}

export type CollabAuthResult = CollabAuthOk | CollabAuthFail;

export type CollabTargetTable = 'performance' | 'project' | 'line';

const ALLOWED_TABLES = new Set(['performance', 'project', 'line']);

export function isAllowedTargetTable(t: string): t is CollabTargetTable {
  return ALLOWED_TABLES.has(t);
}

/** Permission required to EDIT the collab doc, per target table. Line
 * notes gate on the parent project's meta permission (ADR-056). */
const EDIT_PERMISSION: Record<CollabTargetTable, string> = {
  performance: 'edit:performance',
  project: 'edit:project_meta',
  line: 'edit:project_meta',
};

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
  // project_id drives the write-permission check below. A project IS its
  // own project_id; performance and line both carry a project_id FK —
  // keying the branch on 'project' keeps new child targets falling into
  // the project_id side by default.
  url.searchParams.set(
    'select',
    targetTable === 'project' ? 'workspace_id,id' : 'workspace_id,project_id',
  );
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

  const rows = (await res.json()) as {
    workspace_id: string;
    project_id?: string;
    id?: string;
  }[];
  if (rows.length === 0) {
    // Either the target doesn't exist, was soft-deleted, or RLS hid it
    // because the user isn't a member. Don't leak which.
    return { ok: false, status: 403, reason: 'not-found-or-forbidden' };
  }

  // A Yjs connection is a WRITE channel — being able to read the row is
  // not enough. Gate on the edit permission for the target's project
  // (owner/admin bypass lives inside has_permission).
  const projectId = rows[0].project_id ?? rows[0].id;
  if (!projectId) {
    return { ok: false, status: 502, reason: 'missing-project-id' };
  }

  let permRes: Response;
  try {
    permRes = await fetch(
      new URL('/rest/v1/rpc/has_permission', env.PUBLIC_SUPABASE_URL),
      {
        method: 'POST',
        headers: {
          apikey: env.PUBLIC_SUPABASE_ANON_KEY,
          Authorization: `Bearer ${jwt}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          p_project_id: projectId,
          p_perm: EDIT_PERMISSION[targetTable as CollabTargetTable],
        }),
      },
    );
  } catch (e) {
    return { ok: false, status: 502, reason: `perm-network-${(e as Error).message}` };
  }

  if (!permRes.ok) {
    return { ok: false, status: 502, reason: `perm-${permRes.status}` };
  }
  const allowed = (await permRes.json()) as boolean;
  if (allowed !== true) {
    return { ok: false, status: 403, reason: 'edit-permission-required' };
  }

  // PostgREST has now verified the token signature and expiry. Decode only
  // the two claims the internal DO needs to re-check this live connection.
  const [, payload] = jwt.split('.');
  let claims: Record<string, unknown> | null = null;
  try {
    if (payload) {
      const normalized = payload.replace(/-/g, '+').replace(/_/g, '/');
      const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4);
      claims = JSON.parse(atob(padded)) as Record<string, unknown>;
    }
  } catch {
    claims = null;
  }
  if (
    typeof claims?.sub !== 'string' ||
    claims.sub.length === 0 ||
    typeof claims.exp !== 'number' ||
    !Number.isSafeInteger(claims.exp)
  ) {
    return { ok: false, status: 401, reason: 'missing-session-claims' };
  }

  return {
    ok: true,
    workspaceId: rows[0].workspace_id,
    userId: claims.sub,
    expiresAt: claims.exp,
  };
}
