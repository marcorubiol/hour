/**
 * DELETE /api/performances/:key/roadsheet/shares/:id — revoke a public
 * road sheet link (ADR-047). Revocation is a soft kill (revoked_at): the
 * public RPC stops resolving the token immediately. The RPC re-checks
 * `edit:performance` against the share's own performance, so `:key` is URL
 * shape only.
 */

import type { RequestHandler } from './$types';
import * as v from 'valibot';
import { extractAccessToken } from '$lib/auth';
import { pgPostRpc, type SupabaseEnv } from '$lib/supabase';
import { pgErrorResponse } from '$lib/server/errors';

const IdSchema = v.pipe(v.string(), v.uuid());

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

export const DELETE: RequestHandler = async ({ request, params, platform, locals }) => {
  if (!platform?.env) return json({ error: 'platform_unavailable' }, 500);
  const env = platform.env as unknown as SupabaseEnv;

  const jwt = extractAccessToken(request);
  if (!jwt) return json({ error: 'missing_authorization' }, 401);

  const idParsed = v.safeParse(IdSchema, params.id);
  if (!idParsed.success) return json({ error: 'invalid_id' }, 400);

  try {
    await pgPostRpc(env, 'revoke_roadsheet_share', jwt, { p_share_id: idParsed.output });
    return new Response(null, { status: 204 });
  } catch (err) {
    return pgErrorResponse(
      err,
      { route: 'DELETE /api/performances/[key]/roadsheet/shares/[id]', requestId: locals.requestId },
      {
        codes: {
          '42501': { status: 403, error: 'forbidden_or_not_found' },
        },
      },
    );
  }
};
