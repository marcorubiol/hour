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

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

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
    const { data } = await pgGet<AvailabilityItem>(env, 'availability_block', jwt, { search });
    return json({ items: data });
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
