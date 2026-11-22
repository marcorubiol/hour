/**
 * POST /api/calendar/proposals/:id/apply — apply a remote date change from
 * Apple/Google Calendar to Hour's `date` (ADR-241 Fase 4).
 */

import type { RequestHandler } from './$types';
import { extractAccessToken } from '$lib/auth';
import { pgPostRpc, type SupabaseEnv } from '$lib/supabase';
import { pgErrorResponse } from '$lib/server/errors';
import { jsonNoStore, UUID_RE } from '$lib/server/http';

export const POST: RequestHandler = async ({ params, request, platform, locals }) => {
  if (!platform?.env) return jsonNoStore({ error: 'platform_unavailable' }, 500);
  if (!UUID_RE.test(params.id)) return jsonNoStore({ error: 'invalid_id' }, 400);

  const env = platform.env as unknown as SupabaseEnv;
  const jwt = extractAccessToken(request);
  if (!jwt) return jsonNoStore({ error: 'missing_authorization' }, 401);

  try {
    const { data } = await pgPostRpc<string>(env, 'apply_calendar_change_proposal', jwt, {
      p_proposal_id: params.id,
    });
    return jsonNoStore({ applied: true, date_id: data[0] ?? null });
  } catch (err) {
    return pgErrorResponse(
      err,
      { route: 'POST /api/calendar/proposals/:id/apply', requestId: locals.requestId },
      { codes: { P0002: { status: 404, error: 'not_found' }, '42501': { status: 403, error: 'forbidden' } } },
    );
  }
};
