/**
 * POST /api/calendar/proposals/:id/dismiss — dismiss a remote date change so
 * Hour restores its original timing on the next sync pass (ADR-241 Fase 4).
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
    await pgPostRpc(env, 'dismiss_calendar_change_proposal', jwt, {
      p_proposal_id: params.id,
    });
    return jsonNoStore({ dismissed: true });
  } catch (err) {
    return pgErrorResponse(
      err,
      { route: 'POST /api/calendar/proposals/:id/dismiss', requestId: locals.requestId },
      { codes: { P0002: { status: 404, error: 'not_found' }, '42501': { status: 403, error: 'forbidden' } } },
    );
  }
};
