/**
 * GET /api/performances/:key/roadsheet?role=
 *
 * Role-filtered road sheet projection (ADR-023 / ADR-041). Same key
 * semantics as the detail endpoint (:key = uuid, or slug + ?ws=). The
 * projection is computed server-side — hidden sections never leave the
 * server, so a future signed public link (D6) reuses this endpoint with a
 * pinned role instead of trusting the client to hide fields.
 *
 * `?role=` ∈ full | venue | performer | tech_manager (default full).
 * Money never appears on a road sheet regardless of role.
 *
 * Trips (ADR-166): for a role that gets `travel`, the project's travel
 * days around the performance are read as Ahora reads them (the `date` row
 * with its `travel_stage` stages and its «voy» words, ADR-146), and the
 * pure `tripsOfPerformance` keeps the day's and the eve's. RLS decides what
 * the viewer may see of them; a guest who reads no dates gets none.
 *
 * Materials (88): the outbound links of the performance and of its line,
 * the same rule as `get_public_roadsheet`, so «view as» shows what the
 * public link shows.
 *
 * Auth: Bearer JWT required (the signed anonymous link is D6, not built).
 */

import type { RequestHandler } from './$types';
import { extractAccessToken } from '$lib/auth';
import {
  ROLE_SECTIONS,
  buildRoadsheet,
  isRoadsheetRole,
  roadsheetRoleFor,
  tripsOfPerformance,
  type CastEntry,
  type PerformanceBundle,
  type RoadsheetMaterial,
  type RoadsheetTrip,
  type TripRow,
} from '$lib/roadsheet';
import { COMMITMENTS_EMBED } from '$lib/people';
import { addDaysIso } from '$lib/planner';
import { STAGE_SELECT } from '$lib/travel-stage';
import {
  fetchPerformanceBundle,
  isUuid,
  type PerformanceBundleResult,
} from '$lib/server/performance-bundle';
import { pgGet, type SupabaseEnv } from '$lib/supabase';
import { decodeJwtPayload } from '$lib/server/session';
import { pgErrorResponse } from '$lib/server/errors';
import { json } from '$lib/server/http';

/** Map the raw DB bundle into the pure projection input. */
function toProjectionBundle(result: PerformanceBundleResult): PerformanceBundle {
  const p = result.performance;

  const cast: CastEntry[] = [
    ...result.cast_members.map((m) => ({
      role: m.role,
      person: m.person
        ? { full_name: m.person.full_name, email: m.person.email, phone: m.person.phone }
        : null,
    })),
    ...p.cast_override.map((o) => ({
      role: o.role,
      person: o.person
        ? { full_name: o.person.full_name, email: o.person.email, phone: o.person.phone }
        : null,
      replaces: o.replaces_person?.full_name ?? null,
      reason: o.reason,
    })),
  ];

  return {
    performance: {
      id: p.id,
      slug: p.slug,
      performed_at: p.performed_at,
      status: p.status,
      venue_name: p.venue_name,
      city: p.city,
      country: p.country,
      load_in_at: p.load_in_at,
      soundcheck_at: p.soundcheck_at,
      start_at: p.start_at,
      loadout_at: p.loadout_at,
      wrap_at: p.wrap_at,
      schedule: p.schedule,
      notes: p.notes,
      logistics: p.logistics,
      hospitality: p.hospitality,
      technical: p.technical,
    },
    project: p.project ? { name: p.project.name, slug: p.project.slug } : null,
    venue: p.venue
      ? {
          name: p.venue.name,
          city: p.venue.city,
          country: p.venue.country,
          address: p.venue.address,
          capacity: p.venue.capacity,
          timezone: p.venue.timezone,
          contacts: p.venue.contacts,
        }
      : null,
    programmer: p.conversation?.person
      ? {
          full_name: p.conversation.person.full_name,
          email: p.conversation.person.email,
          phone: p.conversation.person.phone,
        }
      : null,
    cast,
    crew: p.crew_assignment.map((c) => ({
      role: c.role,
      person: c.person
        ? { full_name: c.person.full_name, email: c.person.email, phone: c.person.phone }
        : null,
      contact_override: c.contact_override,
      notes: c.notes,
    })),
    assets: p.asset_version.map((a) => ({
      kind: a.kind as PerformanceBundle['assets'][number]['kind'],
      direction: a.direction as PerformanceBundle['assets'][number]['direction'],
      notes: a.notes,
      uploaded_at: a.uploaded_at,
    })),
  };
}

/**
 * The project's trips around the performance, cut to the day and its eve.
 * The window asked of the database is a day wider on each side, so a zone
 * far from UTC cannot push a trip out before the pure cut sees it.
 */
async function readTrips(
  env: SupabaseEnv,
  jwt: string,
  performance: PerformanceBundleResult['performance'],
): Promise<RoadsheetTrip[]> {
  const day = performance.performed_at.slice(0, 10);
  const from = addDaysIso(day, -2);
  const search = new URLSearchParams({
    select: [
      'id,kind,status,title,starts_at,ends_at,all_day,origin_city,destination_city',
      'venue:venue_id(timezone)',
      COMMITMENTS_EMBED,
      `stages:travel_stage(${STAGE_SELECT})`,
    ].join(','),
    'stages.order': 'position.asc',
    project_id: `eq.${performance.project_id}`,
    kind: 'eq.travel_day',
    status: 'neq.cancelled',
    deleted_at: 'is.null',
    order: 'starts_at.asc',
    limit: '50',
  });
  search.append('starts_at', `lte.${addDaysIso(day, 1)}T23:59:59.999Z`);
  search.append('and', `(or(starts_at.gte.${from},ends_at.gte.${from}))`);
  const { data: rows } = await pgGet<TripRow>(env, 'date', jwt, { search });

  // Who said «voy», by the name the space knows them by (ADR-147).
  const ids = [
    ...new Set(rows.flatMap((r) => (r.commitments ?? []).filter((c) => c.state === 'going').map((c) => c.person_id))),
  ];
  const names = new Map<string, string>();
  if (ids.length > 0) {
    const { data: dossiers } = await pgGet<{ person_id: string; full_name: string }>(env, 'workspace_person', jwt, {
      search: new URLSearchParams({
        select: 'person_id,full_name',
        workspace_id: `eq.${performance.workspace_id}`,
        person_id: `in.(${ids.join(',')})`,
        deleted_at: 'is.null',
      }),
    });
    for (const d of dossiers) names.set(d.person_id, d.full_name);
  }
  return tripsOfPerformance(rows, performance.performed_at, performance.venue?.timezone ?? null, names);
}

/** The outbound links of the performance and its line (88), as the public sheet reads them. */
async function readMaterials(
  env: SupabaseEnv,
  jwt: string,
  performance: PerformanceBundleResult['performance'],
): Promise<RoadsheetMaterial[]> {
  const owners = [`performance_id.eq.${performance.id}`];
  if (performance.line_id) owners.push(`line_id.eq.${performance.line_id}`);
  const { data } = await pgGet<{
    kind: RoadsheetMaterial['kind'];
    url: string;
    uploaded_at: string | null;
    performance_id: string | null;
  }>(env, 'asset_version', jwt, {
    search: new URLSearchParams({
      select: 'kind,url,uploaded_at,performance_id',
      or: `(${owners.join(',')})`,
      direction: 'eq.outbound',
      deleted_at: 'is.null',
      order: 'kind.asc,uploaded_at.desc',
      limit: '100',
    }),
  });
  const own = (m: { performance_id: string | null }) => m.performance_id !== null;
  return [...data.filter(own), ...data.filter((m) => !own(m))].map((m) => ({
    kind: m.kind,
    url: m.url,
    uploaded_at: m.uploaded_at,
    scope: own(m) ? 'performance' : 'line',
  }));
}

export const GET: RequestHandler = async ({ request, params, url, platform, locals }) => {
  if (!platform?.env) return json({ error: 'platform_unavailable' }, 500);
  const env = platform.env as unknown as SupabaseEnv;

  const jwt = extractAccessToken(request);
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

  const roleParam = url.searchParams.get('role') ?? 'full';
  if (!isRoadsheetRole(roleParam)) {
    return json(
      { error: 'invalid_role', hint: 'role ∈ full | venue | performer | tech_manager.' },
      400,
    );
  }

  try {
    const result = await fetchPerformanceBundle(env, jwt, key, ws);
    if (!result) return json({ error: 'not_found' }, 404);

    // ADR-146 § 6: `full` only for the space's own crew; a guest gets the
    // technician's cut. Their own membership row (RLS: own rows).
    let role = roleParam;
    if (role === 'full') {
      const sub = decodeJwtPayload(jwt)?.sub;
      const own = new URLSearchParams({
        select: 'workspace_role',
        level: 'eq.workspace',
        accepted_at: 'not.is.null',
        workspace_id: `eq.${result.performance.workspace_id}`,
        limit: '1',
      });
      if (typeof sub === 'string') own.set('user_id', `eq.${sub}`);
      const { data: mine } =
        typeof sub === 'string'
          ? await pgGet<{ workspace_role: string | null }>(env, 'membership', jwt, { search: own })
          : { data: [] as { workspace_role: string | null }[] };
      role = roadsheetRoleFor(role, mine[0]?.workspace_role);
    }
    const bundle = toProjectionBundle(result);
    if (ROLE_SECTIONS[role].includes('travel')) {
      bundle.travel = await readTrips(env, jwt, result.performance);
    }
    if (ROLE_SECTIONS[role].includes('materials')) {
      bundle.materials = await readMaterials(env, jwt, result.performance);
    }
    const sheet = buildRoadsheet(bundle, role);
    // The viewer needs the venue timezone for dual-time display even when
    // the venue section itself is filtered out of the role.
    return json({
      roadsheet: sheet,
      venue_timezone: result.performance.venue?.timezone ?? null,
    });
  } catch (err) {
    return pgErrorResponse(
      err,
      { route: 'GET /api/performances/[key]/roadsheet', requestId: locals.requestId },
      { passUpstream: [401, 403] },
    );
  }
};
