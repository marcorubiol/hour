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
 * Auth: Bearer JWT required. RLS scopes rows (same 'edit:performance' permission
 * as performance — the calendar is production-side data).
 */

import type { RequestHandler } from './$types';
import * as v from 'valibot';
import { extractAccessToken } from '$lib/auth';
import { pgGet, type SupabaseEnv } from '$lib/supabase';
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
  search.set(
    'select',
    [
      'id,kind,status,title,starts_at,ends_at,all_day,venue_name,city',
      'project_id,performance_id',
      'project:project_id(id,slug,name,accent,workspace_id)',
      'venue:venue_id(timezone)',
    ].join(','),
  );

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
    return pgErrorResponse(
      err,
      { route: 'GET /api/dates', requestId: locals.requestId },
      { passUpstream: [401, 403] },
    );
  }
};
