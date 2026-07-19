/**
 * GET /api/dates
 *
 * Lists `date` rows (rehearsals, travel days, residencies, press, other —
 * the calendar primitive that is NOT a performance). Same union filter
 * contract as /api/performances and /api/lines:
 *   - ?project_ids=uuid,uuid,...   → multi-project union
 *   - ?workspace_ids=uuid,uuid,... → all dates in these workspaces
 *   - (none)                       → all dates accessible by RLS
 * Window for the Calendar lens (on starts_at, inclusive):
 *   - ?from=YYYY-MM-DD&to=YYYY-MM-DD
 *
 * `to` is compared against the START of a date row — multi-day rows that
 * begin inside the window are included; Phase 0 keeps this simple.
 *
 * NOTE (calendar v2): the GET select now ASKS for the ADR-078 columns
 * (line_id, travel_direction, label ← custom_fields->>label) but degrades
 * when the migrations aren't applied yet: an undefined-column error (42703)
 * retries once with the legacy select, so the live calendar keeps working
 * and the new fields simply arrive absent (§ Graceful absence of the
 * contract — feature silently off, zero errors surfaced).
 *
 * POST /api/dates — create a date row (ADR-078) via the `create_date` RPC:
 * claim-independent, gated on has_permission(project, 'edit:performance').
 * The RPC enforces line ∈ project, performance ∈ project, the status
 * create-whitelist (tentative|confirmed), travel_direction only on
 * kind='travel_day', and label only on kind='other' (sole custom_fields
 * writer) — the endpoint pre-checks the cross-field rules for 400s with
 * hints.
 *
 * Auth: Bearer JWT required. RLS scopes rows (same 'edit:performance' permission
 * as performance — the calendar is production-side data).
 */

import type { RequestHandler } from './$types';
import * as v from 'valibot';
import { extractAccessToken } from '$lib/auth';
import { DateCreateSchema, type DateRow } from '$lib/date';
import { pgGet, pgPostRpc, PostgrestError, type SupabaseEnv } from '$lib/supabase';
import { pgErrorResponse } from '$lib/server/errors';

const QuerySchema = v.object({
  project_ids: v.optional(v.string()),
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

type ProjectLite = {
  id: string;
  slug: string;
  name: string;
  accent: string | null;
  initials: string | null;
  workspace_id: string;
};

type DateItem = {
  id: string;
  kind: string;
  status: string;
  title: string | null;
  starts_at: string;
  ends_at: string | null;
  all_day: boolean;
  venue_name: string | null;
  city: string | null;
  project_id: string;
  performance_id: string | null;
  project: ProjectLite | null;
  /** Timezone rule: a timed date buckets/renders on its venue's day. */
  venue: { timezone: string | null } | null;
  /** ADR-078 columns — absent until the migrations are applied. */
  line_id?: string | null;
  /** ADR-084 §1 — multi-day block key; NULL/absent = standalone date. */
  series_id?: string | null;
  travel_direction?: string | null;
  label?: string | null;
};

export const GET: RequestHandler = async ({ request, url, platform, locals }) => {
  if (!platform?.env) {
    return json({ error: 'platform_unavailable' }, 500);
  }
  const env = platform.env as unknown as SupabaseEnv;

  const jwt = extractAccessToken(request);
  if (!jwt) {
    return json(
      {
        error: 'missing_authorization',
        hint: 'Send Authorization: Bearer <supabase_jwt>.',
      },
      401,
    );
  }

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
  const { project_ids, workspace_ids, from, to, limit } = parsed.output;

  const projectIds = parseUuidList(project_ids);
  const workspaceIds = parseUuidList(workspace_ids);

  const search = new URLSearchParams();
  // Extended select first (ADR-078 cascade columns + the Altres label);
  // the catch below retries with the legacy columns while the migrations
  // aren't applied (42703 undefined column — graceful absence).
  const BASE_SELECT = [
    'id,kind,status,title,starts_at,ends_at,all_day,venue_name,city',
    'project_id,performance_id',
    'project:project_id(id,slug,name,accent,initials,workspace_id)',
    'venue:venue_id(timezone)',
  ];
  const EXTENDED_SELECT = [
    ...BASE_SELECT,
    'line_id,travel_direction',
    // ADR-084 §1 — the multi-day block's grouping key. The planner joins
    // consecutive rows of one series into a band; NULL = a standalone date.
    'series_id',
    'label:custom_fields->>label',
  ];
  search.set('select', EXTENDED_SELECT.join(','));

  if (projectIds.length > 0 && workspaceIds.length > 0) {
    search.set(
      'or',
      `(project_id.in.(${projectIds.join(',')}),workspace_id.in.(${workspaceIds.join(',')}))`,
    );
  } else if (projectIds.length > 0) {
    search.set('project_id', `in.(${projectIds.join(',')})`);
  } else if (workspaceIds.length > 0) {
    search.set('workspace_id', `in.(${workspaceIds.join(',')})`);
  }

  search.set('deleted_at', 'is.null');
  // Window on starts_at. `to` is a date — pad to end-of-day so timestamptz
  // rows on the last day are included regardless of time.
  if (from) search.append('starts_at', `gte.${from}`);
  if (to) search.append('starts_at', `lte.${to}T23:59:59.999Z`);
  search.set('order', 'starts_at.asc');
  search.set('limit', String(limit));

  try {
    const { data } = await pgGet<DateItem>(env, 'date', jwt, { search });
    return json({ items: data });
  } catch (err) {
    // Pre-migration DB: the cascade columns don't exist yet. Retry once
    // with the legacy select — the calendar keeps working, the new fields
    // are simply absent (contract § Graceful absence).
    if (err instanceof PostgrestError && err.code === '42703') {
      search.set('select', BASE_SELECT.join(','));
      try {
        const { data } = await pgGet<DateItem>(env, 'date', jwt, { search });
        return json({ items: data });
      } catch (retryErr) {
        return pgErrorResponse(
          retryErr,
          { route: 'GET /api/dates', requestId: locals.requestId },
          { passUpstream: [401, 403] },
        );
      }
    }
    return pgErrorResponse(
      err,
      { route: 'GET /api/dates', requestId: locals.requestId },
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
  const parsed = v.safeParse(DateCreateSchema, raw);
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

  // Cross-field rules pre-checked for honest 400s; the RPC re-enforces
  // every one of them (strict AI=UI parity — no path bypasses the contract).
  if (input.travel_direction && input.kind !== 'travel_day') {
    return json(
      { error: 'invalid_body', hint: "travel_direction requires kind='travel_day'." },
      400,
    );
  }
  if (input.label && input.kind !== 'other') {
    return json(
      { error: 'invalid_body', hint: "label is only accepted for kind='other'." },
      400,
    );
  }

  try {
    const { data } = await pgPostRpc<DateRow>(env, 'create_date', jwt, {
      p_project_id: input.project_id,
      p_kind: input.kind,
      p_starts_at: input.starts_at,
      p_ends_at: input.ends_at ?? null,
      p_all_day: input.all_day ?? false,
      p_title: input.title ?? null,
      p_venue_name: input.venue_name ?? null,
      p_city: input.city ?? null,
      p_country: input.country ? input.country.toUpperCase() : null,
      p_status: input.status ?? 'tentative',
      p_performance_id: input.performance_id ?? null,
      p_line_id: input.line_id ?? null,
      p_travel_direction: input.travel_direction ?? null,
      p_label: input.label ?? null,
    });
    if (data.length === 0 || !data[0]) return json({ error: 'create_failed' }, 502);
    return json({ date: data[0] }, 201);
  } catch (err) {
    // RPC RAISEs: 22023 invalid input (incl. line/performance ∉ project,
    // status outside the create whitelist) → 400; 42501 collapses unknown
    // project and no-permission → 403 (no existence oracle).
    return pgErrorResponse(
      err,
      { route: 'POST /api/dates', requestId: locals.requestId },
      {
        codes: {
          '22023': { status: 400, error: 'invalid_input' },
          '42501': { status: 403, error: 'forbidden' },
        },
      },
    );
  }
};
