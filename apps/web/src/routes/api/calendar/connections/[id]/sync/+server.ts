/**
 * POST /api/calendar/connections/:id/sync — trigger immediate sync for one connection.
 */

import type { RequestHandler } from './$types';
import { extractAccessToken } from '$lib/auth';
import { pgPostRpc, type SupabaseEnv } from '$lib/supabase';
import { pgErrorResponse } from '$lib/server/errors';
import { jsonNoStore, UUID_RE } from '$lib/server/http';
import { runCalendarSync } from '$lib/server/calendar/engine';
import { calendarSyncConfigured, type CalendarSyncEnv } from '$lib/server/calendar/types';

export const POST: RequestHandler = async ({ params, request, platform, locals }) => {
  if (!platform?.env) return jsonNoStore({ error: 'platform_unavailable' }, 500);
  if (!UUID_RE.test(params.id)) return jsonNoStore({ error: 'invalid_id' }, 400);

  const env = platform.env as unknown as SupabaseEnv & CalendarSyncEnv;
  if (!calendarSyncConfigured(env)) return jsonNoStore({ error: 'not_configured' }, 503);

  const jwt = extractAccessToken(request);
  if (!jwt) return jsonNoStore({ error: 'missing_authorization' }, 401);

  try {
    await pgPostRpc(env, 'request_my_calendar_sync', jwt, { p_connection_id: params.id });
  } catch (err) {
    return pgErrorResponse(
      err,
      { route: 'POST /api/calendar/connections/:id/sync', requestId: locals.requestId },
      { codes: { P0002: { status: 404, error: 'not_found' }, '42501': { status: 401, error: 'unauthorized' } } },
    );
  }

  const [result] = await runCalendarSync(env, { connectionId: params.id });
  return jsonNoStore(result ?? { status: 'ok', created: 0, updated: 0, deleted: 0, proposals: 0, busyCount: 0, error: null });
};
