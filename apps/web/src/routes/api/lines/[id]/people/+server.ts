/**
 * GET /api/lines/:id/people — the line's contact sheet (ADR-056, People
 * module, read-only v1). Three sources, all existing data:
 *
 *   · own team    — cast_member of the line's project (canonical, ADR-034)
 *   · crew        — crew_assignment of the line's performances
 *   · venue folk  — venue.contacts jsonb of the line's performances
 *
 * Pure derivation: RLS covers everything (cast/crew ride edit:show via
 * their project), no RPC, no new tables. The jsonb contacts are parsed
 * defensively server-side — legacy rows may hold anything (same rule as
 * ProductionStub).
 *
 * Auth: Bearer JWT required.
 */

import type { RequestHandler } from './$types';
import * as v from 'valibot';
import { extractAccessToken } from '$lib/auth';
import { pgGet, type SupabaseEnv } from '$lib/supabase';
import { pgErrorResponse } from '$lib/server/errors';

const IdSchema = v.pipe(v.string(), v.uuid());

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

type PersonLite = {
  id: string;
  slug: string | null;
  full_name: string;
  email: string | null;
  phone: string | null;
};

type CastRow = { id: string; role: string | null; notes: string | null; person: PersonLite | null };
type CrewRow = {
  id: string;
  role: string | null;
  notes: string | null;
  person: PersonLite | null;
  performance: { id: string; slug: string | null; performed_at: string; venue_name: string | null; city: string | null } | null;
};
type VenueRow = {
  id: string;
  slug: string | null;
  performed_at: string;
  venue: { id: string; name: string; city: string | null; contacts: unknown } | null;
};

type VenueContact = { name: string; role: string | null; email: string | null; phone: string | null };

/** Defensive jsonb parse — only object entries with a non-empty name survive. */
function parseContacts(rawList: unknown): VenueContact[] {
  if (!Array.isArray(rawList)) return [];
  const out: VenueContact[] = [];
  for (const entry of rawList) {
    if (typeof entry !== 'object' || entry === null) continue;
    const c = entry as Record<string, unknown>;
    const name = typeof c.name === 'string' ? c.name.trim() : '';
    if (!name) continue;
    out.push({
      name,
      role: typeof c.role === 'string' && c.role.trim() ? c.role.trim() : null,
      email: typeof c.email === 'string' && c.email.trim() ? c.email.trim() : null,
      phone: typeof c.phone === 'string' && c.phone.trim() ? c.phone.trim() : null,
    });
  }
  return out;
}

const PERSON_SELECT = 'person:person_id(id,slug,full_name,email,phone)';

export const GET: RequestHandler = async ({ request, params, platform, locals }) => {
  if (!platform?.env) return json({ error: 'platform_unavailable' }, 500);
  const env = platform.env as unknown as SupabaseEnv;

  const jwt = extractAccessToken(request);
  if (!jwt) return json({ error: 'missing_authorization' }, 401);

  const idParsed = v.safeParse(IdSchema, params.id);
  if (!idParsed.success) return json({ error: 'invalid_id' }, 400);
  const lineId = idParsed.output;

  try {
    // Resolve the line first (RLS decides visibility; 0 rows → 404).
    const lineLookup = new URLSearchParams();
    lineLookup.set('select', 'id,project_id,workspace_id');
    lineLookup.set('id', `eq.${lineId}`);
    lineLookup.set('deleted_at', 'is.null');
    lineLookup.set('limit', '1');
    const line = await pgGet<{ id: string; project_id: string; workspace_id: string }>(
      env,
      'line',
      jwt,
      { search: lineLookup },
    );
    if (line.data.length === 0) return json({ error: 'not_found' }, 404);
    const projectId = line.data[0].project_id;

    const castSearch = new URLSearchParams();
    castSearch.set('select', `id,role,notes,${PERSON_SELECT}`);
    castSearch.set('project_id', `eq.${projectId}`);
    castSearch.set('deleted_at', 'is.null');
    castSearch.set('order', 'role.asc');

    // Inner-embed filter: crew of THIS line's performances only.
    const crewSearch = new URLSearchParams();
    crewSearch.set(
      'select',
      `id,role,notes,${PERSON_SELECT},performance:performance_id!inner(id,slug,performed_at,venue_name,city,line_id)`,
    );
    crewSearch.set('performance.line_id', `eq.${lineId}`);
    crewSearch.set('deleted_at', 'is.null');

    const venuesSearch = new URLSearchParams();
    venuesSearch.set('select', 'id,slug,performed_at,venue:venue_id(id,name,city,contacts)');
    venuesSearch.set('line_id', `eq.${lineId}`);
    venuesSearch.set('deleted_at', 'is.null');
    venuesSearch.set('order', 'performed_at.asc');

    const [cast, crew, venues] = await Promise.all([
      pgGet<CastRow>(env, 'cast_member', jwt, { search: castSearch }),
      pgGet<CrewRow>(env, 'crew_assignment', jwt, { search: crewSearch }),
      pgGet<VenueRow>(env, 'performance', jwt, { search: venuesSearch }),
    ]);

    // Dedupe venues (a venue hosts several gigs) and parse their contacts.
    const seenVenues = new Set<string>();
    const venueContacts: {
      venue: { id: string; name: string; city: string | null };
      contacts: VenueContact[];
      performances: { id: string; slug: string | null; performed_at: string }[];
    }[] = [];
    for (const row of venues.data) {
      if (!row.venue) continue;
      if (seenVenues.has(row.venue.id)) {
        const existing = venueContacts.find((vc) => vc.venue.id === row.venue!.id);
        existing?.performances.push({ id: row.id, slug: row.slug, performed_at: row.performed_at });
        continue;
      }
      seenVenues.add(row.venue.id);
      venueContacts.push({
        venue: { id: row.venue.id, name: row.venue.name, city: row.venue.city },
        contacts: parseContacts(row.venue.contacts),
        performances: [{ id: row.id, slug: row.slug, performed_at: row.performed_at }],
      });
    }

    return json({
      cast: cast.data,
      crew: crew.data,
      venues: venueContacts,
    });
  } catch (err) {
    return pgErrorResponse(
      err,
      { route: 'GET /api/lines/[id]/people', requestId: locals.requestId },
      { passUpstream: [401, 403] },
    );
  }
};
