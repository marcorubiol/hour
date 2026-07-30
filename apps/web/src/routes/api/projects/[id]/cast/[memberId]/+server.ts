/**
 * DELETE /api/projects/:id/cast/:memberId — take somebody off a project's
 * cast, via the `remove_cast_member` RPC.
 *
 * SOFT delete (ADR-048): `deleted_at` is never written by a client PATCH and
 * removal goes through an RPC, so the row survives for audit and a later
 * re-cast of the same (project, person, role) resurrects it rather than
 * growing a second one.
 *
 * The project id in the path is not passed to the RPC — the row already knows
 * its project, and trusting the URL over the row would let a caller aim a
 * delete at a project they can edit while naming a member of one they cannot.
 * It IS checked against the resolved row, so a mismatched pair is a 404
 * rather than a silent success.
 *
 * Auth: Bearer JWT required. The RPC gates on
 * has_permission(project, 'edit:performance').
 */

import type { RequestHandler } from './$types';
import * as v from 'valibot';
import { extractAccessToken } from '$lib/auth';
import { pgGet, pgPostRpc, type SupabaseEnv } from '$lib/supabase';
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

  const projectParsed = v.safeParse(IdSchema, params.id);
  const memberParsed = v.safeParse(IdSchema, params.memberId);
  if (!projectParsed.success || !memberParsed.success) {
    return json({ error: 'invalid_id' }, 400);
  }

  try {
    // The row decides which project this is, and the URL has to agree.
    const search = new URLSearchParams({
      select: 'id,project_id',
      id: `eq.${memberParsed.output}`,
      deleted_at: 'is.null',
      limit: '1',
    });
    const { data: found } = await pgGet<{ id: string; project_id: string }>(
      env,
      'cast_member',
      jwt,
      { search },
    );
    if (found.length === 0 || found[0].project_id !== projectParsed.output) {
      return json({ error: 'not_found' }, 404);
    }

    await pgPostRpc(env, 'remove_cast_member', jwt, { p_cast_member_id: memberParsed.output });
    return new Response(null, { status: 204 });
  } catch (err) {
    return pgErrorResponse(
      err,
      { route: 'DELETE /api/projects/[id]/cast/[memberId]', requestId: locals.requestId },
      { codes: { '42501': { status: 403, error: 'forbidden' } } },
    );
  }
};
