/**
 * Personal cross-workspace `.ics` calendar feed management (ADR-241 Fase 1).
 *
 * RPC-only (`user_calendar_feed` is deny-all even for authenticated, like
 * `calendar_share`). Every operation acts strictly on `auth.uid()`.
 *
 *   GET    → active feed (`{ feed: PersonalCalendarFeedItem | null }`)
 *   POST   → revoke any previous active feed and issue a new 1-year link (`201`)
 *   PATCH  → update `alarm_mode` on the active feed (`200`)
 *   DELETE → revoke the active feed (`200`)
 */

import type { RequestHandler } from './$types';
import * as v from 'valibot';
import { extractAccessToken } from '$lib/auth';
import { pgPostRpc, type SupabaseEnv } from '$lib/supabase';
import { pgErrorResponse } from '$lib/server/errors';
import { jsonNoStore } from '$lib/server/http';
import {
  CalendarFeedCreateSchema,
  CalendarFeedPatchSchema,
  toPersonalCalendarFeed,
} from '$lib/personal-calendar';

type FeedRow = Parameters<typeof toPersonalCalendarFeed>[0];

const FEED_CODES = {
  '42501': { status: 401, error: 'unauthorized' },
  '22023': { status: 400, error: 'invalid_body' },
  P0002: { status: 404, error: 'not_found' },
};

export const GET: RequestHandler = async ({ request, platform, locals }) => {
  if (!platform?.env) return jsonNoStore({ error: 'platform_unavailable' }, 500);
  const env = platform.env as unknown as SupabaseEnv;
  const jwt = extractAccessToken(request);
  if (!jwt) return jsonNoStore({ error: 'missing_authorization' }, 401);

  try {
    const { data } = await pgPostRpc<FeedRow>(env, 'get_my_calendar_feed', jwt, {});
    const row = data.find(Boolean) ?? null;
    return jsonNoStore({ feed: row ? toPersonalCalendarFeed(row) : null });
  } catch (err) {
    return pgErrorResponse(
      err,
      { route: 'GET /api/me/calendar-feed', requestId: locals.requestId },
      { codes: FEED_CODES },
    );
  }
};

export const POST: RequestHandler = async ({ request, platform, locals }) => {
  if (!platform?.env) return jsonNoStore({ error: 'platform_unavailable' }, 500);
  const env = platform.env as unknown as SupabaseEnv;
  const jwt = extractAccessToken(request);
  if (!jwt) return jsonNoStore({ error: 'missing_authorization' }, 401);

  let raw: unknown = {};
  try {
    const text = await request.text();
    if (text.trim()) raw = JSON.parse(text);
  } catch {
    return jsonNoStore({ error: 'invalid_body' }, 400);
  }
  const parsed = v.safeParse(CalendarFeedCreateSchema, raw);
  if (!parsed.success) return jsonNoStore({ error: 'invalid_body' }, 400);

  try {
    const { data } = await pgPostRpc<FeedRow>(env, 'create_my_calendar_feed', jwt, {
      p_alarm_mode: parsed.output.alarm_mode,
    });
    const row = data.find(Boolean);
    if (!row) return jsonNoStore({ error: 'create_failed' }, 502);
    return jsonNoStore({ feed: toPersonalCalendarFeed(row) }, 201);
  } catch (err) {
    return pgErrorResponse(
      err,
      { route: 'POST /api/me/calendar-feed', requestId: locals.requestId },
      { codes: FEED_CODES },
    );
  }
};

export const PATCH: RequestHandler = async ({ request, platform, locals }) => {
  if (!platform?.env) return jsonNoStore({ error: 'platform_unavailable' }, 500);
  const env = platform.env as unknown as SupabaseEnv;
  const jwt = extractAccessToken(request);
  if (!jwt) return jsonNoStore({ error: 'missing_authorization' }, 401);

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return jsonNoStore({ error: 'invalid_body' }, 400);
  }
  const parsed = v.safeParse(CalendarFeedPatchSchema, raw);
  if (!parsed.success) return jsonNoStore({ error: 'invalid_body' }, 400);

  try {
    const { data } = await pgPostRpc<FeedRow>(env, 'update_my_calendar_feed', jwt, {
      p_alarm_mode: parsed.output.alarm_mode,
    });
    const row = data.find(Boolean);
    if (!row) return jsonNoStore({ error: 'not_found' }, 404);
    return jsonNoStore({ feed: toPersonalCalendarFeed(row) });
  } catch (err) {
    return pgErrorResponse(
      err,
      { route: 'PATCH /api/me/calendar-feed', requestId: locals.requestId },
      { codes: FEED_CODES },
    );
  }
};

export const DELETE: RequestHandler = async ({ request, platform, locals }) => {
  if (!platform?.env) return jsonNoStore({ error: 'platform_unavailable' }, 500);
  const env = platform.env as unknown as SupabaseEnv;
  const jwt = extractAccessToken(request);
  if (!jwt) return jsonNoStore({ error: 'missing_authorization' }, 401);

  try {
    await pgPostRpc(env, 'revoke_my_calendar_feed', jwt, {});
    return jsonNoStore({ revoked: true });
  } catch (err) {
    return pgErrorResponse(
      err,
      { route: 'DELETE /api/me/calendar-feed', requestId: locals.requestId },
      { codes: FEED_CODES },
    );
  }
};
