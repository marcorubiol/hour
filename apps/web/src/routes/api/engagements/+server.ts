/**
 * GET /api/engagements
 *
 * Lists engagements in the current workspace, with the linked person and
 * project embedded. RLS + the `current_workspace_id` claim decide visibility —
 * this endpoint is a thin PostgREST wrapper, no RPC needed.
 *
 * Anti-CRM vocabulary (reset v2 enum, 2026-04-19): status defaults to
 * `contacted`. Pass `status=any` to disable status filtering.
 *
 * Auth: Bearer JWT required. RLS denies anon.
 */

import type { RequestHandler } from './$types';
import * as v from 'valibot';
import { extractBearer } from '$lib/auth';
import {
  ENGAGEMENT_SELECT,
  ENGAGEMENT_STATUSES,
  type EngagementItem,
} from '$lib/engagement';
import { pgGet, PostgrestError, type SupabaseEnv } from '$lib/supabase';

const QuerySchema = v.object({
  status: v.optional(
    v.union([v.literal('any'), v.picklist(ENGAGEMENT_STATUSES)]),
    'contacted',
  ),
  project_slug: v.optional(v.pipe(v.string(), v.minLength(1))),
  project_ids: v.optional(v.string()),
  workspace_ids: v.optional(v.string()),
  q: v.optional(v.pipe(v.string(), v.trim(), v.maxLength(120))),
  season: v.optional(v.string(), 'any'),
  limit: v.optional(
    v.pipe(
      v.string(),
      v.transform((n) => Number(n)),
      v.number(),
      v.integer(),
      v.minValue(1),
      v.maxValue(100),
    ),
    '50',
  ),
  offset: v.optional(
    v.pipe(
      v.string(),
      v.transform((n) => Number(n)),
      v.number(),
      v.integer(),
      v.minValue(0),
    ),
    '0',
  ),
});

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

export const GET: RequestHandler = async ({ request, url, platform }) => {
  if (!platform?.env) {
    return json({ error: 'platform_unavailable' }, 500);
  }
  const env = platform.env as unknown as SupabaseEnv;

  const jwt = extractBearer(request);
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
  const { status, project_slug, project_ids, workspace_ids, q, season, limit, offset } =
    parsed.output;

  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const parseIds = (raw?: string) =>
    raw
      ? [...new Set(raw.split(',').map((x) => x.trim()).filter((x) => UUID.test(x)))]
      : [];
  const projectIds = parseIds(project_ids);
  const workspaceIds = parseIds(workspace_ids);

  const search = new URLSearchParams();
  // !inner joins: project when filtering by its slug; person when the
  // free-text search runs over its columns.
  let select = ENGAGEMENT_SELECT;
  if (project_slug) {
    select = select.replace('project:project_id(', 'project:project_id!inner(');
  }
  if (q) {
    select = select.replace('person:person_id(', 'person:person_id!inner(');
  }
  search.set('select', select);

  if (project_slug) search.set('project.slug', `eq.${project_slug}`);
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

  if (q) {
    // Escape PostgREST pattern/logic chars, then substring-match person
    // name and organization.
    const safe = q.replace(/[%_*(),.]/g, ' ').trim();
    if (safe) {
      search.set(
        'person.or',
        `(full_name.ilike.*${safe}*,organization_name.ilike.*${safe}*)`,
      );
    }
  }

  if (status !== 'any') search.set('status', `eq.${status}`);
  if (season !== 'any') search.set('custom_fields->>season', `eq.${season}`);

  search.set('order', 'next_action_at.asc.nullslast,updated_at.desc');
  search.set('limit', String(limit));
  search.set('offset', String(offset));

  try {
    const { data, total } = await pgGet<EngagementItem>(env, 'engagement', jwt, {
      search,
      exactCount: true,
    });

    return json({
      total: total ?? data.length,
      limit,
      offset,
      status,
      season,
      items: data,
    });
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
