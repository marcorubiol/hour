/**
 * POST /api/public/roadsheet/:token/late: «Llego tarde» (121 B, ADR-180).
 *
 * ANONYMOUS: the token is the capability, and only a personal link can use
 * it. The body carries the minutes (10, 20, 30, 45 or null for «No sé») and
 * an optional note; never an id. `report_roadsheet_late` resolves token →
 * link → person → performance in the base and refuses a revoked, expired or
 * role-only link, anyone no longer in the team, any day but the
 * performance's (venue's zone) and a fourth notice in an hour.
 *
 * Two limits, because the RPC is also callable straight against PostgREST
 * with the public anon key: per link in the base (3 an hour, under a row
 * lock), per IP here (a sweep of tokens from one address). The IP window is
 * KV's, so it bounds a slow sweep, not a burst (`$lib/server/rate-limit`).
 *
 * Errors stay opaque: 404 for any link problem, 400 for the day or the body,
 * 429 for either limit.
 */

import type { RequestHandler } from './$types';
import * as v from 'valibot';
import { pgPostRpc, type SupabaseEnv } from '$lib/supabase';
import { pgErrorResponse } from '$lib/server/errors';
import { jsonNoStore } from '$lib/server/http';
import { allowRequest, clientIp } from '$lib/server/rate-limit';
import { LATE_MINUTES, LATE_NOTE_MAX, type PublicLateNotice } from '$lib/roadsheet-late';

const TOKEN = /^[0-9a-f]{40,128}$/i;

/** Per address: a technician sends one or two; ten an hour is a sweep. */
const IP_RULE = { limit: 10, windowSec: 3600 };

const BodySchema = v.object({
  minutes: v.nullable(v.picklist(LATE_MINUTES)),
  note: v.optional(v.nullable(v.pipe(v.string(), v.trim(), v.maxLength(LATE_NOTE_MAX)))),
});

export const POST: RequestHandler = async ({ params, request, platform, locals }) => {
  if (!platform?.env) return jsonNoStore({ error: 'platform_unavailable' }, 500);
  const env = platform.env as unknown as SupabaseEnv & { RATE_LIMIT?: KVNamespace };

  if (!(await allowRequest(env.RATE_LIMIT, `late:${clientIp(request)}`, IP_RULE))) {
    return jsonNoStore({ error: 'rate_limited' }, 429);
  }
  if (!TOKEN.test(params.token)) return jsonNoStore({ error: 'not_found' }, 404);

  const parsed = v.safeParse(BodySchema, await request.json().catch(() => null));
  if (!parsed.success) return jsonNoStore({ error: 'invalid_body' }, 400);

  try {
    const { data } = await pgPostRpc<PublicLateNotice>(env, 'report_roadsheet_late', null, {
      // The base's token check is case-sensitive lowercase hex.
      p_token: params.token.toLowerCase(),
      p_minutes: parsed.output.minutes,
      p_note: parsed.output.note || null,
    });
    const notice = data[0];
    if (!notice) return jsonNoStore({ error: 'not_found' }, 404);
    return jsonNoStore({ notice }, 201);
  } catch (err) {
    return pgErrorResponse(
      err,
      { route: 'POST /api/public/roadsheet/[token]/late', requestId: locals.requestId },
      {
        passUpstream: [],
        codes: {
          '42501': { status: 404, error: 'not_found' },
          '22023': { status: 400, error: 'not_today_or_invalid' },
          '53400': { status: 429, error: 'rate_limited' },
        },
      },
    );
  }
};
