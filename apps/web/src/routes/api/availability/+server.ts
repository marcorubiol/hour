/**
 * GET /api/availability — availability blocks (blackouts, ADR-072 §2 /
 * ADR-078 §4) for the calendar and the conflict engine.
 *   - ?workspace_ids=uuid,uuid,... → union filter (house contract)
 *   - (none)                       → all blackouts accessible by RLS —
 *     cross-space visibility is exactly what the conflict engine wants
 *     for people shared between companies (ADR-078 §5).
 * Window (?from/?to, ISO dates, inclusive) uses OVERLAP semantics — a
 * blackout is a day RANGE, so it matches when starts_on <= to AND
 * ends_on >= from (unlike /api/dates, which windows on starts only).
 *
 * POST /api/availability — create a blackout via the
 * `create_availability_block` RPC (claim-bound INSERT policy, ninth case
 * of the pattern). Write-target is always ONE workspace, member-gated;
 * person_id null/absent = the whole company. NO kind/reason axis anywhere.
 *
 * Auth: Bearer JWT required. RLS: workspace-member scoped (venue family).
 */

import type { RequestHandler } from './$types';
import * as v from 'valibot';
import { extractAccessToken } from '$lib/auth';
import {
  AVAILABILITY_SELECT,
  AvailabilityCreateSchema,
  type AvailabilityItem,
} from '$lib/availability';
import { pgGet, pgPostRpc, type SupabaseEnv } from '$lib/supabase';
import { pgErrorResponse } from '$lib/server/errors';
import { json } from '$lib/server/http';

const QuerySchema = v.object({
  workspace_ids: v.optional(v.string()),
  from: v.optional(v.pipe(v.string(), v.isoDate())),
  to: v.optional(v.pipe(v.string(), v.isoDate())),
  limit: v.optional(
    v.pipe(
      v.string(),
      v.transform((n) => Number(n)),
      v.number(),
      v.integer(),
      v.minValue(1),
      v.maxValue(500),
    ),
    '200',
  ),
});

function parseUuidList(raw: string | undefined): string[] {
  if (!raw) return [];
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  return [...new Set(raw.split(',').map((s) => s.trim()).filter((s) => UUID.test(s)))];
}

export const GET: RequestHandler = async ({ request, url, platform, locals }) => {
  if (!platform?.env) return json({ error: 'platform_unavailable' }, 500);
  const env = platform.env as unknown as SupabaseEnv;

  const jwt = extractAccessToken(request);
  if (!jwt) return json({ error: 'missing_authorization' }, 401);

  const rawParams = Object.fromEntries(url.searchParams.entries());
  const parsed = v.safeParse(QuerySchema, rawParams);
  if (!parsed.success) {
    return json(
      {
        error: 'invalid_query',
        issues: parsed.issues.map((i) => ({
          path: i.path?.map((p) => p.key).join('.'),
          message: i.message,
        })),
      },
      400,
    );
  }
  const { workspace_ids, from, to, limit } = parsed.output;
  const workspaceIds = parseUuidList(workspace_ids);

  const search = new URLSearchParams();
  search.set('select', AVAILABILITY_SELECT);
  if (workspaceIds.length > 0) {
    search.set('workspace_id', `in.(${workspaceIds.join(',')})`);
  }
  search.set('deleted_at', 'is.null');
  // Overlap window: the block's range must intersect [from, to].
  if (from) search.set('ends_on', `gte.${from}`);
  if (to) search.set('starts_on', `lte.${to}`);
  search.set('order', 'starts_on.asc');
  search.set('limit', String(limit));

  try {
    const busyPromise =
      from && to
        ? pgPostRpc<{
            id: string;
            workspace_id: string;
            person_id: string;
            starts_at: string;
            ends_at: string;
            all_day: boolean;
            full_name: string | null;
            slug: string | null;
          }>(env, 'get_calendar_busy_in_window', jwt, {
            p_from: from,
            p_to: to,
            ...(workspaceIds.length > 0 ? { p_workspace_ids: workspaceIds } : {}),
          }).catch(() => ({ data: [] }))
        : Promise.resolve({ data: [] });

    const [{ data }, busyRes] = await Promise.all([
      pgGet<AvailabilityItem>(env, 'availability_block', jwt, { search }),
      busyPromise,
    ]);

    // ADR-241 Fase 3: external calendar busy times join the availability feed
    // with zero titles/locations. All-day/multi-day = 'unavailable' (day
    // blackout); timed (<24h) = 'tentative' (clash warning).
    const calendarItems: AvailabilityItem[] = busyRes.data.filter(Boolean).map((b) => {
      const startDay = b.starts_at.slice(0, 10);
      // Exclusive midnight end for all-day ICS/Google events → subtract 1 ms to get inclusive end day.
      const endMs = Date.parse(b.ends_at);
      const inclusiveEndDay = Number.isNaN(endMs)
        ? startDay
        : new Date(b.all_day ? Math.max(Date.parse(b.starts_at), endMs - 1) : endMs).toISOString().slice(0, 10);
      const isFullDay = b.all_day || inclusiveEndDay > startDay;
      return {
        id: `calbusy:${b.id}`,
        workspace_id: b.workspace_id,
        person_id: b.person_id,
        starts_on: startDay,
        ends_on: inclusiveEndDay,
        certainty: isFullDay ? 'unavailable' : 'tentative',
        note: null,
        created_at: b.starts_at,
        updated_at: b.starts_at,
        person: b.full_name ? { id: b.person_id, slug: b.slug ?? '', full_name: b.full_name } : null,
        source: 'calendar',
        starts_at: b.starts_at,
        ends_at: b.ends_at,
        all_day: isFullDay,
      };
    });

    return json({ items: [...data, ...calendarItems] });
  } catch (err) {
    return pgErrorResponse(
      err,
      { route: 'GET /api/availability', requestId: locals.requestId },
      { passUpstream: [401, 403] },
    );
  }
};

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
  const parsed = v.safeParse(AvailabilityCreateSchema, raw);
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

  if (input.ends_on < input.starts_on) {
    return json(
      { error: 'invalid_body', hint: 'ends_on must be on or after starts_on.' },
      400,
    );
  }

  try {
    const { data } = await pgPostRpc<AvailabilityItem>(env, 'create_availability_block', jwt, {
      p_workspace_id: input.workspace_id,
      p_person_id: input.person_id ?? null,
      p_starts_on: input.starts_on,
      p_ends_on: input.ends_on,
      p_certainty: input.certainty,
      p_note: input.note ?? null,
    });
    if (data.length === 0 || !data[0]) return json({ error: 'create_failed' }, 502);
    // RPC returns the bare row — no person embed (the list GET carries it).
    return json({ block: data[0] }, 201);
  } catch (err) {
    // RPC RAISEs: 22023 invalid input → 400; 42501 collapses no-membership,
    // unknown workspace and invisible person → 403 (no existence oracle).
    return pgErrorResponse(
      err,
      { route: 'POST /api/availability', requestId: locals.requestId },
      {
        codes: {
          '22023': { status: 400, error: 'invalid_input' },
          '42501': { status: 403, error: 'forbidden' },
        },
      },
    );
  }
};
