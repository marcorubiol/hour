/**
 * GET /api/engagements
 *
 * Lists engagements in the current workspace, with the linked person and
 * project embedded. RLS + the `current_workspace_id` claim decide visibility —
 * this endpoint is a thin PostgREST wrapper, no RPC needed.
 *
 * Anti-CRM vocabulary: the old `/api/prospects` route is replaced. The default
 * status filter is `proposed` (previously `prospect`); pass `status=any` to
 * disable status filtering.
 *
 * Query params (all optional):
 *   status         engagement_status | 'any' (default: proposed)
 *   project_slug   project slug      (default: mamemi)
 *   season         text (matches custom_fields->>season)
 *                  (default: 2026-27; pass 'any' to disable)
 *   limit          1..100 (default: 50)
 *   offset         >= 0   (default: 0)
 *
 * Auth: Bearer JWT required. RLS denies anon.
 */

import type { APIRoute } from 'astro';
import { extractBearer } from '../../lib/auth.ts';
import type { Enum, Row } from '../../lib/db-types.ts';
import { pgGet, PostgrestError, type SupabaseEnv } from '../../lib/supabase.ts';

export const prerender = false;

const ALLOWED_STATUSES: ReadonlyArray<Enum<'engagement_status'>> = [
  'idea',
  'proposed',
  'discussing',
  'held',
  'confirmed',
  'cancelled',
  'declined',
  'performed',
  'dormant',
];
const ALLOWED_STATUSES_SET = new Set<string>(ALLOWED_STATUSES);

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

type EngagementRow = Row<'engagement'>;
type PersonLite = Pick<
  Row<'person'>,
  | 'id'
  | 'full_name'
  | 'email'
  | 'organization_name'
  | 'country'
  | 'city'
  | 'website'
>;
type ProjectLite = Pick<
  Row<'project'>,
  'id' | 'slug' | 'name' | 'type' | 'status'
>;

interface EngagementItem extends EngagementRow {
  person: PersonLite | null;
  project: ProjectLite | null;
}

export const GET: APIRoute = async ({ request, locals, url }) => {
  const env = (locals as unknown as { runtime: { env: SupabaseEnv } }).runtime
    .env;

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

  // ---- Parse & validate params --------------------------------------------
  const rawStatus = url.searchParams.get('status') ?? 'proposed';
  if (rawStatus !== 'any' && !ALLOWED_STATUSES_SET.has(rawStatus)) {
    return json(
      { error: 'invalid_status', allowed: [...ALLOWED_STATUSES, 'any'] },
      400,
    );
  }
  const projectSlug = url.searchParams.get('project_slug') ?? 'mamemi';
  const season = url.searchParams.get('season') ?? '2026-27';
  const limit = Math.min(
    Math.max(Number(url.searchParams.get('limit') ?? 50), 1),
    100,
  );
  const offset = Math.max(Number(url.searchParams.get('offset') ?? 0), 0);

  // ---- Build PostgREST query ---------------------------------------------
  const search = new URLSearchParams();
  search.set(
    'select',
    [
      '*',
      'person:person_id(id,full_name,email,organization_name,country,city,website)',
      'project:project_id!inner(id,slug,name,type,status)',
    ].join(','),
  );
  search.set('project.slug', `eq.${projectSlug}`);
  search.set('deleted_at', 'is.null');

  if (rawStatus !== 'any') search.set('status', `eq.${rawStatus}`);
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
      project_slug: projectSlug,
      status: rawStatus,
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
