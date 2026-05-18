/**
 * GET /api/houses
 *
 * Lists workspaces visible to the caller. RLS gates this to workspaces the
 * user has an accepted membership in — for Phase 0 that is just
 * `marco-rubiol`, but the shape supports multi-workspace as soon as Phase 1
 * onboards external clients.
 *
 * Product vocabulary: workspace → House (ADR-008). Schema name retained in
 * the implementation; only the URL surface uses the product name.
 *
 * Auth: Bearer JWT required. RLS denies anon.
 */

import type { RequestHandler } from './$types';
import * as v from 'valibot';
import { extractBearer } from '$lib/auth';
import type { Tables } from '$lib/db-types';
import { pgGet, PostgrestError, type SupabaseEnv } from '$lib/supabase';

const QuerySchema = v.object({
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
});

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

type HouseItem = Pick<
  Tables<'workspace'>,
  'id' | 'slug' | 'name' | 'kind' | 'timezone' | 'country'
>;

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
  const { limit } = parsed.output;

  const search = new URLSearchParams();
  search.set('select', 'id,slug,name,kind,timezone,country');
  search.set('deleted_at', 'is.null');
  search.set('order', 'created_at.asc');
  search.set('limit', String(limit));

  try {
    const { data } = await pgGet<HouseItem>(env, 'workspace', jwt, { search });
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
