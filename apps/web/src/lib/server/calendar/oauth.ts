/**
 * Sealed OAuth flow cookie for Google Calendar (ADR-241 Fase 5).
 * Separate cookie & path from Mail (`/api/calendar/oauth`), using `CALENDAR_TOKEN_KEY`.
 */

import type { Cookies } from '@sveltejs/kit';
import { dev } from '$app/environment';
import { openCalendarJson, sealCalendarJson } from './crypto';
import type { CalendarAlarmMode } from '../../calendar-events';

const OAUTH_COOKIE = 'hour_calendar_oauth';
const COOKIE_PATH = '/api/calendar/oauth';
const TTL_SEC = 600;

export interface CalendarOAuthState {
  n: string;
  v: string;
  u: string;
  r: string;
  a: CalendarAlarmMode;
  e: number;
  c?: string;
}

export const CALENDAR_FLOW_TTL_MS = TTL_SEC * 1000;

export function safeCalendarReturnPath(raw: string | null | undefined, fallback = '/h'): string {
  if (!raw || !raw.startsWith('/h/') || raw.startsWith('//') || /[\r\n\\]/.test(raw)) return fallback;
  return raw;
}

export function withCalendarQuery(path: string, params: Record<string, string>): string {
  const u = new URL(path, 'http://x');
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
  return `${u.pathname}${u.search}`;
}

export async function writeCalendarFlow(cookies: Cookies, key: CryptoKey, state: CalendarOAuthState): Promise<void> {
  cookies.set(OAUTH_COOKIE, await sealCalendarJson(key, state, 'calendar-oauth'), {
    path: COOKIE_PATH,
    httpOnly: true,
    secure: !dev,
    sameSite: 'lax',
    maxAge: TTL_SEC,
  });
}

export async function readCalendarFlow(cookies: Cookies, key: CryptoKey): Promise<CalendarOAuthState | null> {
  const raw = cookies.get(OAUTH_COOKIE);
  if (!raw) return null;
  const state = await openCalendarJson<CalendarOAuthState>(key, raw, 'calendar-oauth');
  if (!state || typeof state.e !== 'number' || state.e < Date.now()) return null;
  return state;
}

export function clearCalendarFlow(cookies: Cookies): void {
  cookies.delete(OAUTH_COOKIE, { path: COOKIE_PATH });
}

export function calendarBounceHtml(path: string): Response {
  const safe = path.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
  return new Response(
    `<!doctype html><meta charset="utf-8"><meta http-equiv="refresh" content="0;url=${safe}"><title>hour</title><a href="${safe}">hour</a>`,
    {
      status: 200,
      headers: {
        'content-type': 'text/html; charset=utf-8',
        'cache-control': 'no-store',
        'referrer-policy': 'no-referrer',
      },
    },
  );
}
