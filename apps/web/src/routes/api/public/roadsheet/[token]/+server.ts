/**
 * GET /api/public/roadsheet/:token — the anonymous road sheet (ADR-047,
 * D6). No auth: the token IS the capability (128+ bits, unguessable,
 * revocable). The `get_public_roadsheet` RPC runs as anon and returns a
 * sanitized bundle — no fee, no notes, no conversation/person internals —
 * with the share's pinned role; the same `buildRoadsheet` matrix used by
 * the operator endpoint then filters sections server-side, so hidden
 * data never leaves the Worker (contacts only survive for tech_manager).
 *
 * `cache-control: no-store` — revocation must bite on the next request,
 * not when a cache expires.
 *
 * 121 B (ADR-183): the moments a «llego tarde» moved carry `moved_from` (one
 * rule, `annotateMoves`); a personal link also gets `holder` (whose sheet)
 * and `late` (may they warn today, who receives it, their last notice).
 *
 * 143 (20261113110000): `trade`, the space's, so the sheet speaks it. A base
 * without it answers without it, and the page speaks stage.
 */

import type { RequestHandler } from './$types';
import {
  buildRoadsheet,
  type CastEntry,
  type PerformanceBundle,
  type RoadsheetPerson,
  type RoadsheetMaterial,
  type RoadsheetRole,
  type RoadsheetTrip,
} from '$lib/roadsheet';
import { pgPostRpc, type SupabaseEnv } from '$lib/supabase';
import { pgErrorResponse } from '$lib/server/errors';
import type { Json } from '$lib/db-types';
import { jsonNoStore } from '$lib/server/http';
import { annotateMoves, type LateMove, type PublicLate, type RoadsheetHolder } from '$lib/roadsheet-late';

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
  /** 88 (20261102150000): the outbound links of the performance and its
      line, for every role. `slug` comes too and is not passed on. */
  materials?: Array<RoadsheetMaterial & { slug?: string | null }>;
  /** 80b (20261102150000): the day's and the eve's trips, already cut by the
      rule of `tripsOfPerformance`, only for performer and tech_manager. */
  travel?: RoadsheetTrip[];
  /** 121 B (20261106100000): the times a notice moved, every role. */
  late_moves?: LateMove[];
  /** 121 B: only on a personal link of someone still in the team. */
  holder?: RoadsheetHolder;
  late?: PublicLate;
  /** 143: `workspace.trade` of the performance's space. */
  trade?: string;
};

export const GET: RequestHandler = async ({ params, platform, locals }) => {
  if (!platform?.env) return jsonNoStore({ error: 'platform_unavailable' }, 500);
  const env = platform.env as unknown as SupabaseEnv;

  if (!TOKEN.test(params.token)) return jsonNoStore({ error: 'not_found' }, 404);

  try {
    const { data } = await pgPostRpc<PublicBundle | null>(env, 'get_public_roadsheet', null, {
      p_token: params.token,
    });
    const b = data[0];
    if (!b) return jsonNoStore({ error: 'not_found' }, 404);

    const cast: CastEntry[] = [
      ...b.cast.map((m) => ({ role: m.role, person: m.person })),
      ...b.cast_overrides.map((o) => ({
        role: o.role,
        person: o.person,
        replaces: o.replaces,
        reason: o.reason,
      })),
    ];

    const schedule = b.performance.schedule
      ? annotateMoves(b.performance.schedule, b.late_moves ?? [])
      : b.performance.schedule;

    const bundle: PerformanceBundle = {
      performance: { ...b.performance, schedule, notes: null },
      project: b.project,
      venue: b.venue,
      programmer: null,
      cast,
      crew: b.crew,
      assets: b.assets,
      materials: (b.materials ?? []).map(({ kind, url, uploaded_at, scope }) => ({ kind, url, uploaded_at, scope })),
      ...(b.travel ? { travel: b.travel } : {}),
    };

    return jsonNoStore({
      roadsheet: buildRoadsheet(bundle, b.role),
      venue_timezone: b.venue?.timezone ?? null,
      holder: b.holder ?? null,
      late: b.late ?? null,
      trade: b.trade ?? null,
    });
  } catch (err) {
    // ANONYMOUS surface — errors stay fully opaque (matches the sibling
    // public/calendar feed): details go to the server log only.
    return pgErrorResponse(
      err,
      { route: 'GET /api/public/roadsheet/[token]', requestId: locals.requestId },
      { passUpstream: [] },
    );
  }
};
