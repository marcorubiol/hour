/**
 * GET /api/public/calendar/:token — the subscribable ICS feed (ADR-054).
 * No auth: the token IS the capability (128+ bits, unguessable,
 * revocable) — same model as the public road sheet (ADR-047). The
 * `get_public_calendar` RPC runs as anon and returns sanitized JSON
 * (confirmed+ performances, non-cancelled dates — no fee, no notes, no
 * person data); the Worker renders RFC 5545.
 *
 * `cache-control: no-store` — revocation must bite on the next poll.
 * Calendar apps poll on their own schedule anyway (X-PUBLISHED-TTL:PT1H
 * is the hint inside the payload).
 *
 * Language (ADR-162): the link carries it (`?lang=es`, `&trade=music`), set by
 * whoever copied it from Hour; else the caller's Accept-Language; else
 * English. The workspace has no language of its own to read.
 */

import type { RequestHandler } from './$types';
import { buildCalendar, type CalendarFeed } from '$lib/ics';
import { detectLocale, LOCALES, TRADES, type Locale, type Trade } from '$lib/i18n';
import { pgPostRpc, PostgrestError, type SupabaseEnv } from '$lib/supabase';

const TOKEN = /^[0-9a-f]{40,128}$/i;

function feedLocale(url: URL, acceptLanguage: string | null): Locale {
  const lang = url.searchParams.get('lang');
  if (lang && (LOCALES as readonly string[]).includes(lang)) return lang as Locale;
  return detectLocale(acceptLanguage?.split(',')[0]?.trim());
}

/** The link's trade; none, and the feed's own (`workspace.trade`) decides. */
function feedTrade(url: URL): Trade | undefined {
  const trade = url.searchParams.get('trade');
  return trade && (TRADES as readonly string[]).includes(trade) ? (trade as Trade) : undefined;
}

export const GET: RequestHandler = async ({ params, platform, url, request }) => {
  if (!platform?.env) return new Response('unavailable', { status: 500 });
  const env = platform.env as unknown as SupabaseEnv;

  if (!TOKEN.test(params.token)) return new Response('not found', { status: 404 });

  try {
    const { data } = await pgPostRpc<CalendarFeed | null>(env, 'get_public_calendar', null, {
      p_token: params.token,
    });
    const feed = data[0];
    if (!feed) return new Response('not found', { status: 404 });

    const ics = buildCalendar(feed, new Date(), {
      locale: feedLocale(url, request.headers.get('accept-language')),
      trade: feedTrade(url),
      origin: url.origin,
    });
    return new Response(ics, {
      status: 200,
      headers: {
        'content-type': 'text/calendar; charset=utf-8',
        'content-disposition': `inline; filename="${feed.workspace?.slug ?? 'hour'}.ics"`,
        'cache-control': 'no-store',
      },
    });
  } catch (err) {
    if (err instanceof PostgrestError) {
      return new Response('upstream error', { status: 502 });
    }
    // Anon surface — never reflect the raw error string back to the caller.
    console.error('public calendar feed error', String(err));
    return new Response('unexpected error', { status: 500 });
  }
};
