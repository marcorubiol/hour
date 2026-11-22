/**
 * POST /api/calendar/oauth/google/finish — exchanges authorization code with
 * active Hour session, creates the secondary «Hour» calendar, seals the refresh
 * token with `CALENDAR_TOKEN_KEY`, and kicks off the first sync pass.
 */

import type { RequestHandler } from './$types';
import { extractAccessToken } from '$lib/auth';
import { pgPostRpc, type SupabaseEnv } from '$lib/supabase';
import { jsonNoStore, jwtSubject } from '$lib/server/http';
import {
  CALENDAR_KEY_VERSION,
  calendarCredentialAad,
  encryptCalendarSecret,
  importCalendarKey,
} from '$lib/server/calendar/crypto';
import {
  exchangeGoogleCalendarCode,
  fetchGoogleAccountEmail,
  googleCalendarAdapter,
  hasCalendarScopes,
} from '$lib/server/calendar/google';
import { clearCalendarFlow, readCalendarFlow } from '$lib/server/calendar/oauth';
import { runCalendarSync } from '$lib/server/calendar/engine';
import { googleCalendarConfigured, type CalendarSyncEnv } from '$lib/server/calendar/types';

export const POST: RequestHandler = async ({ request, url, cookies, platform }) => {
  const env = platform?.env as unknown as (SupabaseEnv & CalendarSyncEnv) | undefined;
  if (!googleCalendarConfigured(env)) return jsonNoStore({ error: 'not_configured' }, 503);

  const jwt = extractAccessToken(request);
  const sub = jwt ? jwtSubject(jwt) : null;
  if (!jwt || !sub) return jsonNoStore({ error: 'missing_authorization' }, 401);

  const key = await importCalendarKey(env.CALENDAR_TOKEN_KEY);
  const flow = await readCalendarFlow(cookies, key);
  clearCalendarFlow(cookies);
  if (!flow?.c) return jsonNoStore({ error: 'expired' }, 400);
  if (flow.u !== sub) return jsonNoStore({ error: 'forbidden' }, 403);

  const creds = { clientId: env.GOOGLE_OAUTH_CLIENT_ID, clientSecret: env.GOOGLE_OAUTH_CLIENT_SECRET };
  let tokens;
  try {
    tokens = await exchangeGoogleCalendarCode(fetch, {
      ...creds,
      code: flow.c,
      verifier: flow.v,
      redirectUri: `${url.origin}/api/calendar/oauth/google/callback`,
    });
  } catch {
    return jsonNoStore({ error: 'exchange_failed' }, 502);
  }
  if (!hasCalendarScopes(tokens.scope)) return jsonNoStore({ error: 'missing_scopes' }, 400);
  if (!tokens.refreshToken) return jsonNoStore({ error: 'no_refresh_token' }, 400);

  let email: string;
  let discovery;
  const adapter = googleCalendarAdapter(fetch, {
    ...creds,
    refreshToken: tokens.refreshToken,
    initialAccessToken: tokens.accessToken,
  });
  try {
    email = await fetchGoogleAccountEmail(fetch, tokens.accessToken);
    discovery = await adapter.ensureCalendar();
  } catch {
    return jsonNoStore({ error: 'google_calendar_setup_failed' }, 502);
  }

  const sealed = await encryptCalendarSecret(
    key,
    JSON.stringify({ refreshToken: tokens.refreshToken }),
    calendarCredentialAad(sub, 'google', email),
  );

  try {
    const { data } = await pgPostRpc<string>(env, 'upsert_my_calendar_connection', jwt, {
      p_provider: 'google',
      p_account_email: email,
      p_credentials_ciphertext: sealed,
      p_key_version: CALENDAR_KEY_VERSION,
      p_alarm_mode: flow.a,
      p_hour_calendar_id: discovery.hourCalendarId,
      p_available_calendars: discovery.availableCalendars,
    });
    const connectionId = data[0];
    if (connectionId && platform?.ctx) {
      platform.ctx.waitUntil(
        runCalendarSync(env, { connectionId }).then(
          () => undefined,
          () => undefined,
        ),
      );
    }
    return jsonNoStore({ connection_id: connectionId, account_email: email }, 201);
  } catch {
    await adapter.revoke?.();
    return jsonNoStore({ error: 'connect_failed' }, 502);
  }
};
