/**
 * GET /api/public/my-calendar/:token — personal cross-workspace `.ics` feed
 * (ADR-241 Fase 1).
 *
 * No auth header: the 256-bit token IS the revocable, expiring capability.
 * `get_personal_calendar` runs as anon and returns sanitized JSON across all
 * workspaces the owner belongs to (excluding spaces set to `none`, cancelled
 * rows, and rows answered `not_going`; never money, internal notes, booking
 * references, or other people's data).
 *
 * `cache-control: no-store` — revocation and expiry take effect on the next
 * poll. Language comes from `?lang=`, else the user's stored profile locale,
 * else `Accept-Language`, else English.
 */

import type { RequestHandler } from './$types';
import { buildPersonalCalendar, type PersonalCalendarFeed } from '$lib/calendar-events';
import { detectLocale, LOCALES, type Locale } from '$lib/i18n';
import { pgPostRpc, PostgrestError, type SupabaseEnv } from '$lib/supabase';

const TOKEN = /^[0-9a-f]{40,128}$/i;

function feedLocale(url: URL, profileLocale: string | null | undefined, acceptLanguage: string | null): Locale {
  const param = url.searchParams.get('lang');
  if (param && (LOCALES as readonly string[]).includes(param)) return param as Locale;
  if (profileLocale && (LOCALES as readonly string[]).includes(profileLocale)) return profileLocale as Locale;
  return detectLocale(acceptLanguage?.split(',')[0]?.trim());
}

export const GET: RequestHandler = async ({ params, platform, url, request }) => {
  if (!platform?.env) return new Response('unavailable', { status: 500 });
  const env = platform.env as unknown as SupabaseEnv;

  if (!TOKEN.test(params.token)) return new Response('not found', { status: 404 });

  try {
    const { data } = await pgPostRpc<PersonalCalendarFeed | null>(env, 'get_personal_calendar', null, {
      p_token: params.token,
    });
    const feed = data[0];
    if (!feed) return new Response('not found', { status: 404 });

    const ics = buildPersonalCalendar(feed, new Date(), {
      locale: feedLocale(url, feed.locale, request.headers.get('accept-language')),
      origin: url.origin,
    });
    return new Response(ics, {
      status: 200,
      headers: {
        'content-type': 'text/calendar; charset=utf-8',
        'content-disposition': 'inline; filename="hour.ics"',
        'cache-control': 'no-store',
      },
    });
  } catch (err) {
    if (err instanceof PostgrestError) {
      return new Response('upstream error', { status: 502 });
    }
    console.error('personal calendar feed error', String(err));
    return new Response('unexpected error', { status: 500 });
  }
};
