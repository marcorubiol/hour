/**
 * GET /api/performances/:key/trips
 *
 * ADR-242 + ADR-243: trips serving a performance (bound to its bolo, bound to
 * its line without a bolo, or suggested by day + eve when none are bound).
 *
 * Resolves via `trips_for_performance` RPC in Postgres so every team member
 * with `read:performance` (and bolo guests for bolo-bound trips) sees the
 * bound trips without needing `read:money` and without exposing `bolo_id` or
 * `travel_stage.notes`.
 */

import type { RequestHandler } from './$types';
import { extractAccessToken } from '$lib/auth';
import type { RoadsheetTrip } from '$lib/roadsheet';
import { isUuid } from '$lib/server/performance-bundle';
import { pgGet, pgPostRpc, type SupabaseEnv } from '$lib/supabase';
import { pgErrorResponse } from '$lib/server/errors';
import { json } from '$lib/server/http';

export const GET: RequestHandler = async ({ request, params, url, platform, locals }) => {
  if (!platform?.env) return json({ error: 'platform_unavailable' }, 500);
  const env = platform.env as unknown as SupabaseEnv;

  const jwt = extractAccessToken(request);
  if (!jwt) return json({ error: 'missing_authorization' }, 401);

  const key = params.key;
  const ws = url.searchParams.get('ws');
  if (!isUuid(key) && !ws) {
    return json(
      { error: 'invalid_key', hint: 'Pass a uuid, or a slug with ?ws=<workspace-slug>.' },
      400,
    );
  }

  try {
    let perfId = key;
    if (!isUuid(key)) {
      const search = new URLSearchParams({
        select: 'id,workspace:workspace_id!inner(slug)',
        slug: `eq.${key}`,
        'workspace.slug': `eq.${ws}`,
        deleted_at: 'is.null',
        limit: '1',
      });
      const { data } = await pgGet<{ id: string }>(env, 'performance', jwt, { search });
      if (data.length === 0) return json({ error: 'not_found' }, 404);
      perfId = data[0].id;
    }

    const { data } = await pgPostRpc<RoadsheetTrip[] | null>(env, 'trips_for_performance', jwt, {
      p_performance_id: perfId,
    });
    const raw = Array.isArray(data) && data.length === 1 && Array.isArray(data[0]) ? data[0] : data;
    const items = Array.isArray(raw) ? (raw as RoadsheetTrip[]) : [];
    return json({ items });
  } catch (err) {
    return pgErrorResponse(
      err,
      { route: 'GET /api/performances/[key]/trips', requestId: locals.requestId },
      { passUpstream: [401, 403] },
    );
  }
};
