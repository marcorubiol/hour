/**
 * GET /api/money/performances — the fees feed for the Money lens
 * (ADR-046). Reads `performance_redacted`, the decided money-safe path:
 * fee columns are NULLed by the view unless the caller holds
 * `read:money` on the project (invoker semantics — RLS of the base
 * table applies underneath).
 *
 * Union filters + optional performed_at window, same contract as the
 * other list endpoints.
 */

import type { RequestHandler } from './$types';
import * as v from 'valibot';
import { extractBearer } from '$lib/auth';
import { pgGet, PostgrestError, type SupabaseEnv } from '$lib/supabase';

const QuerySchema = v.object({
  project_ids: v.optional(v.string()),
  workspace_ids: v.optional(v.string()),
  line_ids: v.optional(v.string()),
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

type MoneyPerformance = {
  id: string;
  slug: string | null;
  performed_at: string;
  status: string;
  venue_name: string | null;
  city: string | null;
  fee_amount: number | null;
  fee_currency: string | null;
  project_id: string;
  line_id: string | null;
  project: {
    id: string;
    slug: string;
    name: string;
    accent: string | null;
    workspace_id: string;
  } | null;
};

export const GET: RequestHandler = async ({ request, url, platform }) => {
  if (!platform?.env) return json({ error: 'platform_unavailable' }, 500);
  const env = platform.env as unknown as SupabaseEnv;

  const jwt = extractBearer(request);
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
  const { project_ids, workspace_ids, line_ids, from, to, limit } = parsed.output;
  const projectIds = parseUuidList(project_ids);
  const workspaceIds = parseUuidList(workspace_ids);
  const lineIds = parseUuidList(line_ids);

  const search = new URLSearchParams();
  search.set(
    'select',
    [
      'id,slug,performed_at,status,venue_name,city,fee_amount,fee_currency,project_id,line_id',
      'project:project_id(id,slug,name,accent,workspace_id)',
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

  // Line narrowing (ADR-056): the Money module fetches only its line's
  // gigs instead of the whole project. Composes with the union filter.
  if (lineIds.length > 0) search.set('line_id', `in.(${lineIds.join(',')})`);
  search.set('deleted_at', 'is.null');
  if (from) search.append('performed_at', `gte.${from}`);
  if (to) search.append('performed_at', `lte.${to}`);
  search.set('order', 'performed_at.asc');
  search.set('limit', String(limit));

  try {
    const { data } = await pgGet<MoneyPerformance>(env, 'performance_redacted', jwt, {
      search,
    });
    return json({ items: data });
  } catch (err) {
    if (err instanceof PostgrestError) {
      const upstream = err.status === 401 || err.status === 403 ? err.status : 502;
      return json(
        { error: 'postgrest_error', status: err.status, detail: err.body },
        upstream,
      );
    }
    return json({ error: 'unexpected', detail: String(err) }, 500);
  }
};
