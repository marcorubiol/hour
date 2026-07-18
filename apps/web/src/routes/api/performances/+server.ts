/**
 * GET /api/performances
 *
 * Lists performances. Filter scope (any combination, OR/union semantics —
 * same contract as /api/lines):
 *   - ?project_id=<uuid>           → single project (original contract)
 *   - ?project_ids=uuid,uuid,...   → multi-project union
 *   - ?workspace_ids=uuid,uuid,... → all performances in these workspaces
 *   - (none)                       → all performances accessible by RLS
 * Plus an optional window on performed_at for the Calendar lens:
 *   - ?from=YYYY-MM-DD&to=YYYY-MM-DD (inclusive)
 * Plus an opt-in roster projection for the conflict engine (calendar v2,
 * ADR-072 §1):
 *   - ?rosters=1 → each item gains `person_ids: string[]` (project
 *     cast_member − replaced + cast_override + crew_assignment, deduped —
 *     the same rule as the detail bundle, batched in 3 queries). An empty
 *     roster means "no team data" and conflictsFor() degrades honestly.
 *
 * Embeds `venue` (city/date rendering) and `project` (accent + slug for
 * calendar coloring and links) without a second round-trip.
 *
 * Schema renamed `show` → `performance` (ADR-036, 2026-05-19). Column
 * `show_start_at` renamed to `start_at`. The permission code `'edit:performance'`
 * stays as-is (closed RBAC vocab, deferred to Phase 0.9 admin UI).
 *
 * RLS scopes by workspace membership (ADR-029). No `current_workspace_id`
 * claim needed.
 *
 * Auth: Bearer JWT required. RLS denies anon.
 */

import type { RequestHandler } from './$types';
import * as v from 'valibot';
import { extractAccessToken } from '$lib/auth';
import { PerformanceCreateSchema } from '$lib/performance';
import { pgGet, pgPostRpc, type SupabaseEnv } from '$lib/supabase';
import { pgErrorResponse } from '$lib/server/errors';
import { fetchPerformanceRosters } from '$lib/server/rosters';

const ALLOWED_STATUSES = [
  'any',
  'proposed',
  'hold',
  'hold_1',
  'hold_2',
  'hold_3',
  'confirmed',
  'done',
  'invoiced',
  'paid',
  'cancelled',
] as const;

const QuerySchema = v.object({
  project_id: v.optional(v.pipe(v.string(), v.uuid())),
  project_ids: v.optional(v.string()),
  workspace_ids: v.optional(v.string()),
  line_id: v.optional(v.pipe(v.string(), v.uuid())),
  status: v.optional(v.picklist(ALLOWED_STATUSES), 'any'),
  from: v.optional(v.pipe(v.string(), v.isoDate())),
  to: v.optional(v.pipe(v.string(), v.isoDate())),
  rosters: v.optional(v.picklist(['0', '1']), '0'),
  limit: v.optional(
    v.pipe(
      v.string(),
      v.transform((n) => Number(n)),
      v.number(),
      v.integer(),
      v.minValue(1),
      v.maxValue(200),
    ),
    '100',
  ),
});

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

/** Comma-separated uuid list → deduped valid uuids (invalid dropped). */
function parseUuidList(raw: string | undefined): string[] {
  if (!raw) return [];
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  return [...new Set(raw.split(',').map((s) => s.trim()).filter((s) => UUID.test(s)))];
}

type VenueLite = {
  id: string;
  name: string;
  city: string | null;
  country: string | null;
};

type ProjectLite = {
  id: string;
  slug: string;
  name: string;
  accent: string | null;
  workspace_id: string;
};

type PerformanceItem = {
  id: string;
  slug: string | null;
  performed_at: string;
  status: string;
  venue_id: string | null;
  venue_name: string | null;
  city: string | null;
  country: string | null;
  project_id: string;
  line_id: string | null;
  conversation_id: string | null;
  load_in_at: string | null;
  soundcheck_at: string | null;
  start_at: string | null;
  loadout_at: string | null;
  wrap_at: string | null;
  venue: VenueLite | null;
  project: ProjectLite | null;
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
  const { project_id, project_ids, workspace_ids, line_id, status, from, to, rosters, limit } =
    parsed.output;

  const projectIds = parseUuidList(project_ids);
  if (project_id) projectIds.push(project_id);
  const uniqueProjectIds = [...new Set(projectIds)];
  const workspaceIds = parseUuidList(workspace_ids);

  const search = new URLSearchParams();
  // No fee columns here: this reads the BASE table (RLS = edit:performance), so
  // fees would leak past the read:money gate. The money door is
  // /api/money/performances over performance_redacted (ADR-041/056).
  search.set(
    'select',
    [
      'id,slug,performed_at,status,venue_id,venue_name,city,country',
      'project_id,line_id,conversation_id',
      'load_in_at,soundcheck_at,start_at,loadout_at,wrap_at',
      'venue:venue_id(id,name,city,country,timezone)',
      'project:project_id(id,slug,name,accent,workspace_id)',
    ].join(','),
  );

  if (uniqueProjectIds.length > 0 && workspaceIds.length > 0) {
    search.set(
      'or',
      `(project_id.in.(${uniqueProjectIds.join(',')}),workspace_id.in.(${workspaceIds.join(',')}))`,
    );
  } else if (uniqueProjectIds.length > 0) {
    search.set('project_id', `in.(${uniqueProjectIds.join(',')})`);
  } else if (workspaceIds.length > 0) {
    search.set('workspace_id', `in.(${workspaceIds.join(',')})`);
  }

  if (line_id) search.set('line_id', `eq.${line_id}`);
  search.set('deleted_at', 'is.null');
  if (status !== 'any') search.set('status', `eq.${status}`);
  if (from) search.append('performed_at', `gte.${from}`);
  if (to) search.append('performed_at', `lte.${to}`);
  search.set('order', 'performed_at.asc.nullslast');
  search.set('limit', String(limit));

  try {
    const { data } = await pgGet<PerformanceItem>(env, 'performance', jwt, { search });
    if (rosters !== '1') return json({ items: data });

    const personIdsByPerformance = await fetchPerformanceRosters(
      env,
      jwt,
      data.map((p) => ({ id: p.id, project_id: p.project_id })),
    );
    return json({
      items: data.map((p) => ({ ...p, person_ids: personIdsByPerformance[p.id] ?? [] })),
    });
  } catch (err) {
    return pgErrorResponse(
      err,
      { route: 'GET /api/performances', requestId: locals.requestId },
      { passUpstream: [401, 403] },
    );
  }
};

/**
 * POST /api/performances — create a gig (ADR-043).
 *
 * Body: PerformanceCreateSchema. Goes through the `create_performance`
 * RPC (SECURITY DEFINER): claim-independent, gated on
 * has_permission(project_id, 'edit:performance'), slug auto-generated
 * (slugify(venue|city|'gig')-YYYY-MM-DD, numeric suffix on collision).
 * Returns { performance } — the full created row.
 */
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
  const parsed = v.safeParse(PerformanceCreateSchema, raw);
  if (!parsed.success) {
    return json(
      {
        error: 'invalid_body',
        issues: parsed.issues.map((i) => ({
          path: i.path?.map((pp) => pp.key).join('.'),
          message: i.message,
        })),
      },
      400,
    );
  }
  const input = parsed.output;

  try {
    const { data } = await pgPostRpc<PerformanceItem>(env, 'create_performance', jwt, {
      p_project_id: input.project_id,
      p_performed_at: input.performed_at,
      p_venue_name: input.venue_name ?? null,
      p_city: input.city ?? null,
      p_country: input.country ? input.country.toUpperCase() : null,
      p_status: input.status ?? 'proposed',
      p_conversation_id: input.conversation_id ?? null,
      p_line_id: input.line_id ?? null,
    });
    if (data.length === 0) return json({ error: 'create_failed' }, 502);
    return json({ performance: data[0] }, 201);
  } catch (err) {
    // RPC RAISEs: 22023 invalid input → 400, 42501 permission → 403.
    return pgErrorResponse(
      err,
      { route: 'POST /api/performances', requestId: locals.requestId },
      {
        codes: {
          '22023': { status: 400, error: 'invalid_input' },
          '42501': { status: 403, error: 'forbidden' },
        },
      },
    );
  }
};
