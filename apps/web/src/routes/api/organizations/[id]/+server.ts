/**
 * DELETE /api/organizations/:id — soft-delete an organization of the
 * workspace through `delete_workspace_organization` (ADR-048: a soft delete
 * never rides a client PATCH). The RPC gates on owner, admin or member of the
 * workspace, and refuses while a live conversation or invoice uses it.
 *
 * Auth: Bearer JWT required.
 */

import type { RequestHandler } from './$types';
import { extractAccessToken } from '$lib/auth';
import { pgPostRpc, type SupabaseEnv } from '$lib/supabase';
import { pgErrorResponse } from '$lib/server/errors';
import { json, UUID_RE } from '$lib/server/http';

export const DELETE: RequestHandler = async ({ request, params, platform, locals }) => {
  if (!platform?.env) return json({ error: 'platform_unavailable' }, 500);
  const env = platform.env as unknown as SupabaseEnv;

  const jwt = extractAccessToken(request);
  if (!jwt) return json({ error: 'missing_authorization' }, 401);
  if (!UUID_RE.test(params.id)) return json({ error: 'invalid_id' }, 400);

  try {
    await pgPostRpc(env, 'delete_workspace_organization', jwt, { p_organization_id: params.id });
    return new Response(null, { status: 204 });
  } catch (err) {
    return pgErrorResponse(
      err,
      { route: 'DELETE /api/organizations/[id]', requestId: locals.requestId },
      {
        codes: {
          '42501': { status: 404, error: 'not_found' },
          '23503': {
            status: 409,
            error: 'organization_in_use',
            hint: 'Delete its conversations and invoices first.',
          },
        },
      },
    );
  }
};
