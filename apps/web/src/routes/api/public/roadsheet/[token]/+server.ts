/**
 * GET /api/public/roadsheet/:token — the anonymous road sheet (ADR-047,
 * D6). No auth: the token IS the capability (128+ bits, unguessable,
 * revocable). The `get_public_roadsheet` RPC runs as anon and returns a
 * sanitized bundle — no fee, no notes, no engagement/person internals —
 * with the share's pinned role; the same `buildRoadsheet` matrix used by
 * the operator endpoint then filters sections server-side, so hidden
 * data never leaves the Worker (contacts only survive for tech_manager).
 *
 * `cache-control: no-store` — revocation must bite on the next request,
 * not when a cache expires.
 */

import type { RequestHandler } from './$types';
import {
  buildRoadsheet,
  type CastEntry,
  type PerformanceBundle,
  type RoadsheetPerson,
  type RoadsheetRole,
} from '$lib/roadsheet';
import { pgPostRpc, PostgrestError, type SupabaseEnv } from '$lib/supabase';
import type { Json } from '$lib/db-types';

const TOKEN = /^[0-9a-f]{40,128}$/i;

type PublicBundle = {
  role: Exclude<RoadsheetRole, 'full'>;
  performance: Omit<PerformanceBundle['performance'], 'notes'>;
  project: { name: string; slug: string } | null;
  venue: PerformanceBundle['venue'];
  cast: Array<{ role: string; person: RoadsheetPerson | null }>;
  cast_overrides: Array<{
    role: string;
    reason: string | null;
    person: RoadsheetPerson | null;
    replaces: string | null;
  }>;
  crew: Array<{
    role: string;
    notes: string | null;
    contact_override: Json | null;
    person: RoadsheetPerson | null;
  }>;
  assets: PerformanceBundle['assets'];
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    },
  });
}

export const GET: RequestHandler = async ({ params, platform }) => {
  if (!platform?.env) return json({ error: 'platform_unavailable' }, 500);
  const env = platform.env as unknown as SupabaseEnv;

  if (!TOKEN.test(params.token)) return json({ error: 'not_found' }, 404);

  try {
    const { data } = await pgPostRpc<PublicBundle | null>(env, 'get_public_roadsheet', null, {
      p_token: params.token,
    });
    const b = data[0];
    if (!b) return json({ error: 'not_found' }, 404);

    const cast: CastEntry[] = [
      ...b.cast.map((m) => ({ role: m.role, person: m.person })),
      ...b.cast_overrides.map((o) => ({
        role: o.role,
        person: o.person,
        replaces: o.replaces,
        reason: o.reason,
      })),
    ];

    const bundle: PerformanceBundle = {
      performance: { ...b.performance, notes: null },
      project: b.project,
      venue: b.venue,
      programmer: null,
      cast,
      crew: b.crew,
      assets: b.assets,
    };

    return json({
      roadsheet: buildRoadsheet(bundle, b.role),
      venue_timezone: b.venue?.timezone ?? null,
    });
  } catch (err) {
    if (err instanceof PostgrestError) {
      return json({ error: 'postgrest_error', status: err.status, detail: err.body }, 502);
    }
    return json({ error: 'unexpected', detail: String(err) }, 500);
  }
};
