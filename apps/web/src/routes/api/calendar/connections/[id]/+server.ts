/**
 * PATCH  /api/calendar/connections/:id — update alarm_mode or busy_calendar_ids.
 * DELETE /api/calendar/connections/:id — delete remote «Hour» calendar, revoke
 *   token (Google) and remove connection, links, busy intervals & proposals.
 */

import type { RequestHandler } from './$types';
import * as v from 'valibot';
import { extractAccessToken } from '$lib/auth';
import { pgPostRpc, type SupabaseEnv } from '$lib/supabase';
import { pgErrorResponse } from '$lib/server/errors';
import { jsonNoStore, jwtSubject, UUID_RE } from '$lib/server/http';
import { CALENDAR_ALARM_MODES } from '$lib/personal-calendar';
import { disconnectCalendarConnection, runCalendarSync } from '$lib/server/calendar/engine';
import { calendarSyncConfigured, type CalendarSyncEnv } from '$lib/server/calendar/types';

const PatchSchema = v.object({
  alarm_mode: v.optional(v.picklist(CALENDAR_ALARM_MODES)),
  busy_calendar_ids: v.optional(v.array(v.pipe(v.string(), v.minLength(1), v.maxLength(1024)))),
});

export const PATCH: RequestHandler = async ({ params, request, platform, locals }) => {
  if (!platform?.env) return jsonNoStore({ error: 'platform_unavailable' }, 500);
  if (!UUID_RE.test(params.id)) return jsonNoStore({ error: 'invalid_id' }, 400);

  const env = platform.env as unknown as SupabaseEnv & CalendarSyncEnv;
  const jwt = extractAccessToken(request);
  if (!jwt) return jsonNoStore({ error: 'missing_authorization' }, 401);

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return jsonNoStore({ error: 'invalid_body' }, 400);
  }
  const parsed = v.safeParse(PatchSchema, raw);
  if (!parsed.success) return jsonNoStore({ error: 'invalid_body' }, 400);

  try {
    await pgPostRpc(env, 'update_my_calendar_connection', jwt, {
      p_connection_id: params.id,
      ...(parsed.output.alarm_mode !== undefined ? { p_alarm_mode: parsed.output.alarm_mode } : {}),
      ...(parsed.output.busy_calendar_ids !== undefined
        ? { p_busy_calendar_ids: parsed.output.busy_calendar_ids }
        : {}),
    });
    if (calendarSyncConfigured(env) && platform.ctx) {
      platform.ctx.waitUntil(
        runCalendarSync(env, { connectionId: params.id }).then(
          () => undefined,
          () => undefined,
        ),
      );
    }
    return jsonNoStore({ ok: true });
  } catch (err) {
    return pgErrorResponse(
      err,
      { route: 'PATCH /api/calendar/connections/:id', requestId: locals.requestId },
      { codes: { P0002: { status: 404, error: 'not_found' }, '22023': { status: 400, error: 'invalid_body' } } },
    );
  }
};

export const DELETE: RequestHandler = async ({ params, request, platform }) => {
  if (!platform?.env) return jsonNoStore({ error: 'platform_unavailable' }, 500);
  if (!UUID_RE.test(params.id)) return jsonNoStore({ error: 'invalid_id' }, 400);

  const env = platform.env as unknown as CalendarSyncEnv;
  if (!calendarSyncConfigured(env)) return jsonNoStore({ error: 'not_configured' }, 503);

  const jwt = extractAccessToken(request);
  const sub = jwt ? jwtSubject(jwt) : null;
  if (!jwt || !sub) return jsonNoStore({ error: 'missing_authorization' }, 401);

  const result = await disconnectCalendarConnection(env, params.id, sub);
  if (!result.deleted) return jsonNoStore({ error: 'not_found' }, 404);
  return jsonNoStore({ disconnected: true, remote_deleted: result.remoteDeleted });
};
