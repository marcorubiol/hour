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
import type { Enum, Row } from '$lib/db-types';
import { pgGet, PostgrestError, type SupabaseEnv } from '$lib/supabase';

const ALLOWED_STATUSES: ReadonlyArray<Enum<'engagement_status'>> = [
  'contacted',
  'in_conversation',
  'hold',
  'confirmed',
  'declined',
  'dormant',
  'recurring',
];

const QuerySchema = v.object({
  status: v.optional(
    v.union([v.literal('any'), v.picklist(ALLOWED_STATUSES)]),
    'contacted',
  ),
  project_slug: v.optional(v.pipe(v.string(), v.minLength(1)), 'mamemi'),
  season: v.optional(v.string(), '2026-27'),
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

type EngagementRow = Row<'engagement'>;
type PersonLite = Pick<
  Row<'person'>,
  'id' | 'full_name' | 'email' | 'organization_name' | 'country' | 'city' | 'website'
>;
type ProjectLite = Pick<Row<'project'>, 'id' | 'slug' | 'name' | 'status'>;

interface EngagementItem extends EngagementRow {
  person: PersonLite | null;
  project: ProjectLite | null;
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
  const { status, project_slug, season, limit, offset } = parsed.output;

  const search = new URLSearchParams();
  search.set(
    'select',
    [
      '*',
      'person:person_id(id,full_name,email,organization_name,country,city,website)',
      'project:project_id!inner(id,slug,name,status)',
    ].join(','),
  );
  search.set('project.slug', `eq.${project_slug}`);
  search.set('deleted_at', 'is.null');

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
      project_slug,
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
