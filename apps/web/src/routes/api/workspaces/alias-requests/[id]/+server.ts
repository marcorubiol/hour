/**
 * PATCH /api/workspaces/alias-requests/:id — review a pending alias request
 * (ADR-067). Body {approve: boolean}. Platform admin only — enforced by the
 * review_workspace_alias RPC (user_profile.is_platform_admin), not here:
 * the DB is the boundary. Approving re-checks availability and sets
 * workspace.alias; rejecting just closes the request.
 */

import type { RequestHandler } from './$types';
import * as v from 'valibot';
import { extractAccessToken } from '$lib/auth';
import { pgPostRpc, type SupabaseEnv } from '$lib/supabase';
import { pgErrorResponse } from '$lib/server/errors';
import type { AliasRequestRow } from '../+server';

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

const BodySchema = v.object({ approve: v.boolean() });

export const PATCH: RequestHandler = async ({ request, params, platform, locals }) => {
  if (!platform?.env) return json({ error: 'platform_unavailable' }, 500);
  const env = platform.env as unknown as SupabaseEnv;

  const jwt = extractAccessToken(request);
  if (!jwt) return json({ error: 'missing_authorization' }, 401);

  if (!v.is(v.pipe(v.string(), v.uuid()), params.id)) {
    return json({ error: 'invalid_id' }, 400);
  }

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return json({ error: 'invalid_body' }, 400);
  }
  const parsed = v.safeParse(BodySchema, raw);
  if (!parsed.success) return json({ error: 'invalid_body' }, 400);

  try {
    const { data } = await pgPostRpc<AliasRequestRow>(env, 'review_workspace_alias', jwt, {
      p_request_id: params.id,
      p_approve: parsed.output.approve,
    });
    const request_ = data[0];
    if (!request_) return json({ error: 'rpc_empty_result' }, 502);
    return json({ request: request_ });
  } catch (err) {
    // 42501 = not platform admin, 22023 = not found/not pending, 23505 = alias no longer free
    return pgErrorResponse(
      err,
      { route: 'PATCH /api/workspaces/alias-requests/:id', requestId: locals.requestId },
      {
        codes: {
          '42501': { status: 403, error: 'forbidden' },
          '22023': { status: 404, error: 'not_found' },
          '23505': { status: 409, error: 'alias_taken' },
        },
        passUpstream: [],
      },
    );
  }
};
