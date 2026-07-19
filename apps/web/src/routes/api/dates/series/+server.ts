/**
 * POST /api/dates/series — create a multi-day block (ADR-084 §1).
 *
 * N date rows, one series_id, ONE statement. The atomicity is the entire
 * reason this route exists instead of the client looping POST /api/dates:
 * a week that half-created is indistinguishable, later, from a week someone
 * deliberately left incomplete.
 *
 * Rides `create_date_series` — claim-independent, SECURITY DEFINER, gated on
 * has_permission(project, 'edit:performance'), which re-enforces every rule
 * pre-checked here (strict AI=UI parity, ADR-078 §7: no write path bypasses
 * the contract).
 */
import type { RequestHandler } from './$types';
import * as v from 'valibot';
import { extractAccessToken } from '$lib/auth';
import { DateSeriesCreateSchema, type DateRow } from '$lib/date';
import { pgPostRpc, type SupabaseEnv } from '$lib/supabase';
import { pgErrorResponse } from '$lib/server/errors';

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

export const POST: RequestHandler = async ({ request, platform, locals }) => {
  if (!platform?.env) return json({ error: 'platform_unavailable' }, 500);
  const env = platform.env as unknown as SupabaseEnv;

  const jwt = extractAccessToken(request);
  if (!jwt) return json({ error: 'missing_authorization' }, 401);

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return json({ error: 'invalid_body' }, 400);
  }
  const parsed = v.safeParse(DateSeriesCreateSchema, raw);
  if (!parsed.success) {
    return json(
      {
        error: 'invalid_body',
        issues: parsed.issues.map((i) => ({
          path: i.path?.map((p) => p.key).join('.'),
          message: i.message,
        })),
      },
      400,
    );
  }
  const input = parsed.output;

  // Cross-field rules pre-checked for honest 400s; the RPC re-enforces each
  // of them, so a client that skips this route gains nothing.
  if (input.ends && input.ends.length !== input.starts.length) {
    return json(
      { error: 'invalid_body', hint: 'ends must be absent or the same length as starts.' },
      400,
    );
  }
  if (input.kind === 'travel_day') {
    return json(
      { error: 'invalid_body', hint: 'travel_day carries a direction per row, not a series.' },
      400,
    );
  }
  if (input.label && input.kind !== 'other') {
    return json({ error: 'invalid_body', hint: "label is only accepted for kind='other'." }, 400);
  }

  try {
    const { data } = await pgPostRpc<DateRow>(env, 'create_date_series', jwt, {
      p_project_id: input.project_id,
      p_kind: input.kind,
      p_starts: input.starts,
      p_ends: input.ends ?? null,
      p_all_day: input.all_day ?? false,
      p_title: input.title ?? null,
      p_venue_name: input.venue_name ?? null,
      p_city: input.city ?? null,
      p_country: input.country ? input.country.toUpperCase() : null,
      p_status: input.status ?? 'tentative',
      p_line_id: input.line_id ?? null,
      p_label: input.label ?? null,
    });
    if (data.length === 0) return json({ error: 'create_failed' }, 502);
    return json({ dates: data }, 201);
  } catch (err) {
    // RPC RAISEs: 22023 invalid input (too few/many days, duplicate days,
    // line ∉ project, status outside the create whitelist) → 400; 42501
    // collapses unknown project and no-permission → 403 (no existence
    // oracle).
    return pgErrorResponse(
      err,
      { route: 'POST /api/dates/series', requestId: locals.requestId },
      {
        codes: {
          '22023': { status: 400, error: 'invalid_input' },
          '42501': { status: 403, error: 'forbidden' },
        },
      },
    );
  }
};
