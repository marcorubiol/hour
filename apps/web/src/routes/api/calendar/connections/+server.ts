/**
 * GET  /api/calendar/connections — lists caller's external calendar connections (never secrets).
 * POST /api/calendar/connections — connect or reconnect Apple Calendar (CalDAV, ADR-241 Fase 2).
 */

import type { RequestHandler } from './$types';
import * as v from 'valibot';
import { extractAccessToken } from '$lib/auth';
import { pgPostRpc, type SupabaseEnv } from '$lib/supabase';
import { pgErrorResponse } from '$lib/server/errors';
import { jsonNoStore, jwtSubject } from '$lib/server/http';
import { CALENDAR_ALARM_MODES } from '$lib/personal-calendar';
import {
  CALENDAR_KEY_VERSION,
  calendarCredentialAad,
  encryptCalendarSecret,
  importCalendarKey,
} from '$lib/server/calendar/crypto';
import { caldavAdapter } from '$lib/server/calendar/caldav';
import { runCalendarSync } from '$lib/server/calendar/engine';
import {
  CalendarAuthError,
  calendarSyncConfigured,
  googleCalendarConfigured,
  type CalendarSyncEnv,
  type RemoteCalendar,
} from '$lib/server/calendar/types';

export interface CalendarConnectionPublic {
  id: string;
  provider: 'icloud' | 'google';
  account_email: string;
  hour_calendar_id: string | null;
  busy_calendar_ids: string[];
  available_calendars: RemoteCalendar[];
  alarm_mode: 'none' | 'day_before' | '2h_before';
  status: 'ok' | 'paused';
  dirty: boolean;
  last_synced_at: string | null;
  last_error: string | null;
  created_at: string;
}

const ConnectIcloudSchema = v.object({
  provider: v.literal('icloud'),
  apple_id: v.pipe(v.string(), v.trim(), v.email(), v.maxLength(254)),
  app_password: v.pipe(v.string(), v.trim(), v.minLength(8), v.maxLength(64)),
  alarm_mode: v.optional(v.picklist(CALENDAR_ALARM_MODES), 'none'),
});

export const GET: RequestHandler = async ({ request, platform, locals }) => {
  if (!platform?.env) return jsonNoStore({ error: 'platform_unavailable' }, 500);
  const env = platform.env as unknown as SupabaseEnv & CalendarSyncEnv;
  const jwt = extractAccessToken(request);
  if (!jwt) return jsonNoStore({ error: 'missing_authorization' }, 401);

  try {
    const { data } = await pgPostRpc<CalendarConnectionPublic>(env, 'list_my_calendar_connections', jwt, {});
    return jsonNoStore({
      items: data.filter(Boolean),
      configured: {
        icloud: calendarSyncConfigured(env),
        google: googleCalendarConfigured(env),
      },
    });
  } catch (err) {
    return pgErrorResponse(
      err,
      { route: 'GET /api/calendar/connections', requestId: locals.requestId },
      { codes: { '42501': { status: 401, error: 'unauthorized' } } },
    );
  }
};

export const POST: RequestHandler = async ({ request, platform, locals }) => {
  if (!platform?.env) return jsonNoStore({ error: 'platform_unavailable' }, 500);
  const env = platform.env as unknown as SupabaseEnv & CalendarSyncEnv;
  if (!calendarSyncConfigured(env)) return jsonNoStore({ error: 'not_configured' }, 503);

  const jwt = extractAccessToken(request);
  const sub = jwt ? jwtSubject(jwt) : null;
  if (!jwt || !sub) return jsonNoStore({ error: 'missing_authorization' }, 401);

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return jsonNoStore({ error: 'invalid_body' }, 400);
  }
  const parsed = v.safeParse(ConnectIcloudSchema, raw);
  if (!parsed.success) return jsonNoStore({ error: 'invalid_body' }, 400);

  const { apple_id, app_password, alarm_mode } = parsed.output;
  const adapter = caldavAdapter(fetch, { appleId: apple_id, appPassword: app_password });

  let discovery;
  try {
    discovery = await adapter.ensureCalendar();
  } catch (err) {
    if (err instanceof CalendarAuthError) {
      return jsonNoStore({ error: 'icloud_auth_failed' }, 401);
    }
    return jsonNoStore({ error: 'icloud_connect_failed' }, 502);
  }

  const key = await importCalendarKey(env.CALENDAR_TOKEN_KEY);
  const sealed = await encryptCalendarSecret(
    key,
    JSON.stringify({ appleId: apple_id.toLowerCase(), appPassword: app_password }),
    calendarCredentialAad(sub, 'icloud', apple_id),
  );

  try {
    const { data } = await pgPostRpc<string>(env, 'upsert_my_calendar_connection', jwt, {
      p_provider: 'icloud',
      p_account_email: apple_id.toLowerCase(),
      p_credentials_ciphertext: sealed,
      p_key_version: CALENDAR_KEY_VERSION,
      p_alarm_mode: alarm_mode,
      p_hour_calendar_id: discovery.hourCalendarId,
      p_principal_url: discovery.principalUrl ?? null,
      p_calendar_home_url: discovery.calendarHomeUrl ?? null,
      p_available_calendars: discovery.availableCalendars,
    });
    const connectionId = data[0];
    if (connectionId && platform.ctx) {
      platform.ctx.waitUntil(
        runCalendarSync(env, { connectionId }).then(
          () => undefined,
          () => undefined,
        ),
      );
    }
    return jsonNoStore(
      {
        connection_id: connectionId,
        provider: 'icloud',
        account_email: apple_id.toLowerCase(),
        available_calendars: discovery.availableCalendars,
      },
      201,
    );
  } catch (err) {
    return pgErrorResponse(
      err,
      { route: 'POST /api/calendar/connections', requestId: locals.requestId },
      { codes: { '42501': { status: 403, error: 'forbidden' }, '22023': { status: 400, error: 'invalid_body' } } },
    );
  }
};
