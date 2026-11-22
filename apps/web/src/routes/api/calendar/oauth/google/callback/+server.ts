/**
 * GET /api/calendar/oauth/google/callback — return from Google Calendar OAuth.
 * Verifies CSRF state against sealed Lax cookie, saves code, bounces back to Settings.
 */

import type { RequestHandler } from './$types';
import { importCalendarKey } from '$lib/server/calendar/crypto';
import {
  calendarBounceHtml,
  clearCalendarFlow,
  readCalendarFlow,
  withCalendarQuery,
  writeCalendarFlow,
} from '$lib/server/calendar/oauth';
import { googleCalendarConfigured, type CalendarSyncEnv } from '$lib/server/calendar/types';

export const GET: RequestHandler = async ({ url, cookies, platform }) => {
  const env = platform?.env as unknown as CalendarSyncEnv | undefined;
  if (!googleCalendarConfigured(env)) return calendarBounceHtml('/h?cal=error&reason=not_configured');

  const key = await importCalendarKey(env.CALENDAR_TOKEN_KEY);
  const flow = await readCalendarFlow(cookies, key);
  if (!flow) return calendarBounceHtml('/h?cal=error&reason=expired');

  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  if (url.searchParams.get('error') || !code || state !== flow.n) {
    clearCalendarFlow(cookies);
    const reason = url.searchParams.get('error') === 'access_denied' ? 'denied' : 'invalid_state';
    return calendarBounceHtml(withCalendarQuery(flow.r, { cal: 'error', reason }));
  }

  await writeCalendarFlow(cookies, key, { ...flow, c: code });
  return calendarBounceHtml(withCalendarQuery(flow.r, { cal: 'finish' }));
};
