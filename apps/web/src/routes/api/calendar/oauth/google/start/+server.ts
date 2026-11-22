/**
 * GET /api/calendar/oauth/google/start?alarm_mode=none&return=/h/…
 *
 * Starts Google Calendar OAuth with separate consent & minimal Calendar scopes
 * (ADR-241 Fase 5). Independent from Mailboxes OAuth.
 */

import type { RequestHandler } from './$types';
import { redirect } from '@sveltejs/kit';
import { extractAccessToken } from '$lib/auth';
import { normalizeAlarmMode } from '$lib/calendar-events';
import { jwtSubject } from '$lib/server/http';
import { calendarPkcePair, importCalendarKey, randomCalendarToken } from '$lib/server/calendar/crypto';
import { googleCalendarAuthUrl } from '$lib/server/calendar/google';
import {
  CALENDAR_FLOW_TTL_MS,
  safeCalendarReturnPath,
  withCalendarQuery,
  writeCalendarFlow,
} from '$lib/server/calendar/oauth';
import { googleCalendarConfigured, type CalendarSyncEnv } from '$lib/server/calendar/types';

export const GET: RequestHandler = async ({ request, url, cookies, platform }) => {
  const env = platform?.env as unknown as CalendarSyncEnv | undefined;
  const back = safeCalendarReturnPath(url.searchParams.get('return'));
  if (!googleCalendarConfigured(env)) {
    redirect(303, withCalendarQuery(back, { cal: 'error', reason: 'not_configured' }));
  }
  const jwt = extractAccessToken(request);
  const sub = jwt ? jwtSubject(jwt) : null;
  if (!jwt || !sub) redirect(303, '/login');

  const key = await importCalendarKey(env.CALENDAR_TOKEN_KEY);
  const state = randomCalendarToken();
  const { verifier, challenge } = await calendarPkcePair();
  const alarmMode = normalizeAlarmMode(url.searchParams.get('alarm_mode'));

  await writeCalendarFlow(cookies, key, {
    n: state,
    v: verifier,
    u: sub,
    r: back,
    a: alarmMode,
    e: Date.now() + CALENDAR_FLOW_TTL_MS,
  });

  const authUrl = googleCalendarAuthUrl({
    clientId: env.GOOGLE_OAUTH_CLIENT_ID,
    redirectUri: `${url.origin}/api/calendar/oauth/google/callback`,
    state,
    codeChallenge: challenge,
  });
  redirect(303, authUrl);
};
