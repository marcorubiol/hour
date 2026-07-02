/**
 * GET /api/performances/:key
 *
 * Single performance with the full detail bundle: venue, line, project,
 * engagement (+person), crew, cast overrides, related dates, assets, and
 * the project's canonical cast (ADR-034).
 *
 * `:key` is a uuid, or a slug combined with `?ws=<workspace-slug>` (slugs
 * are unique per workspace, ADR-024).
 *
 * RLS authorizes (`has_permission(project_id, 'edit:show')` on the base
 * table); zero rows map to 404 without confirming existence.
 *
 * Auth: Bearer JWT required.
 */

import type { RequestHandler } from './$types';
import { extractBearer } from '$lib/auth';
import { fetchPerformanceBundle, isUuid } from '$lib/server/performance-bundle';
import { PostgrestError, type SupabaseEnv } from '$lib/supabase';

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

export const GET: RequestHandler = async ({ request, params, url, platform }) => {
  if (!platform?.env) return json({ error: 'platform_unavailable' }, 500);
  const env = platform.env as unknown as SupabaseEnv;

  const jwt = extractBearer(request);
  if (!jwt) {
    return json(
      { error: 'missing_authorization', hint: 'Send Authorization: Bearer <supabase_jwt>.' },
      401,
    );
  }

  const key = params.key;
  const ws = url.searchParams.get('ws');
  if (!isUuid(key) && !ws) {
    return json(
      { error: 'invalid_key', hint: 'Pass a uuid, or a slug with ?ws=<workspace-slug>.' },
      400,
    );
  }

  try {
    const bundle = await fetchPerformanceBundle(env, jwt, key, ws);
    if (!bundle) return json({ error: 'not_found' }, 404);
    return json(bundle);
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
