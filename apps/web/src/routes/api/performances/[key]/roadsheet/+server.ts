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
 * Auth: Bearer JWT required (the signed anonymous link is D6, not built).
 */

import type { RequestHandler } from './$types';
import { extractBearer } from '$lib/auth';
import {
  buildRoadsheet,
  isRoadsheetRole,
  type CastEntry,
  type PerformanceBundle,
} from '$lib/roadsheet';
import {
  fetchPerformanceBundle,
  isUuid,
  type PerformanceBundleResult,
} from '$lib/server/performance-bundle';
import { PostgrestError, type SupabaseEnv } from '$lib/supabase';

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

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
    programmer: p.engagement?.person
      ? {
          full_name: p.engagement.person.full_name,
          email: p.engagement.person.email,
          phone: p.engagement.person.phone,
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

    const sheet = buildRoadsheet(toProjectionBundle(result), roleParam);
    // The viewer needs the venue timezone for dual-time display even when
    // the venue section itself is filtered out of the role.
    return json({
      roadsheet: sheet,
      venue_timezone: result.performance.venue?.timezone ?? null,
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
