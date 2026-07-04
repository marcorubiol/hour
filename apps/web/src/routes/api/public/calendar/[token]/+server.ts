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
 */

import type { RequestHandler } from './$types';
import { buildCalendar, type CalendarFeed } from '$lib/ics';
import { pgPostRpc, PostgrestError, type SupabaseEnv } from '$lib/supabase';

const TOKEN = /^[0-9a-f]{40,128}$/i;

export const GET: RequestHandler = async ({ params, platform }) => {
  if (!platform?.env) return new Response('unavailable', { status: 500 });
  const env = platform.env as unknown as SupabaseEnv;

  if (!TOKEN.test(params.token)) return new Response('not found', { status: 404 });

  try {
    const { data } = await pgPostRpc<CalendarFeed | null>(env, 'get_public_calendar', null, {
      p_token: params.token,
    });
    const feed = data[0];
    if (!feed) return new Response('not found', { status: 404 });

    const ics = buildCalendar(feed, new Date());
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
