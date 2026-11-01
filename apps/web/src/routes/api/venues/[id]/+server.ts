/**
 * GET /api/venues/:key?workspace_id=:workspace: la ficha de sala (ADR-164
 * § 1): la sala (`VENUE_COLS`) y sus funciones, pasadas y futuras, con su
 * proyecto y la organización de su conversación. `key` es el id o el slug.
 * La RLS de siempre decide cada fila; sin migración.
 *
 * PATCH /api/venues/:id — edit the venue entity (ADR-053): address,
 * timezone (feeds the road sheet dual-time), contacts, capacity, notes,
 * name/city/country.
 *
 * Direct PostgREST PATCH — no RPC: venue_update RLS allows workspace
 * members, and the row stays SELECT-visible after the update (the
 * ADR-048 rule only bites soft-deletes). Whitelisted by VenuePatchSchema.
 *
 * 409 venue_exists: name/city collision with the live-unique
 * (workspace, lower(name), lower(city)) index.
 */

import type { RequestHandler } from './$types';
import * as v from 'valibot';
import { extractAccessToken } from '$lib/auth';
import { VENUE_COLS, VenuePatchSchema } from '$lib/venue';
import type { VenueFile, VenuePerformance } from '$lib/venue-record';
import { pgGet, pgPatch, type SupabaseEnv } from '$lib/supabase';
import { pgErrorResponse } from '$lib/server/errors';
import { json, UUID_RE } from '$lib/server/http';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const WorkspaceQuery = v.object({ workspace_id: v.pipe(v.string(), v.uuid()) });

export const GET: RequestHandler = async ({ request, params, url, platform, locals }) => {
  if (!platform?.env) return json({ error: 'platform_unavailable' }, 500);
  const env = platform.env as unknown as SupabaseEnv;

  const jwt = extractAccessToken(request);
  if (!jwt) return json({ error: 'missing_authorization' }, 401);

  const query = v.safeParse(WorkspaceQuery, Object.fromEntries(url.searchParams.entries()));
  if (!query.success) return json({ error: 'invalid_query', hint: 'workspace_id is required.' }, 400);
  const workspaceId = query.output.workspace_id;
  const key = params.id;
  const byId = UUID_RE.test(key);
  if (!byId && !/^[a-z0-9-]{1,120}$/.test(key)) return json({ error: 'invalid_id' }, 400);

  try {
    const venueSearch = new URLSearchParams({
      select: `workspace_id,${VENUE_COLS}`,
      workspace_id: `eq.${workspaceId}`,
      deleted_at: 'is.null',
      limit: '1',
    });
    venueSearch.set(byId ? 'id' : 'slug', `eq.${key}`);
    let venue = await pgGet<VenueFile['venue']>(env, 'venue', jwt, { search: venueSearch });
    // An old link: the slug it had before a rename (`previous_slugs`).
    if (venue.data.length === 0 && !byId) {
      venueSearch.delete('slug');
      venueSearch.set('previous_slugs', `cs.{${key}}`);
      venue = await pgGet<VenueFile['venue']>(env, 'venue', jwt, { search: venueSearch });
    }
    if (venue.data.length === 0) return json({ error: 'not_found' }, 404);
    const room = venue.data[0];

    const perfSearch = new URLSearchParams({
      select:
        'id,slug,performed_at,status,project:project_id(id,slug,name),conversation:conversation_id(id,slug,organization:workspace_organization!conversation_workspace_organization_fkey(slug,name))',
      venue_id: `eq.${room.id}`,
      deleted_at: 'is.null',
      order: 'performed_at.desc',
      limit: '200',
    });
    const performances = await pgGet<VenuePerformance>(env, 'performance', jwt, { search: perfSearch });

    const file: VenueFile = { venue: room, performances: performances.data };
    return json(file);
  } catch (err) {
    return pgErrorResponse(
      err,
      { route: 'GET /api/venues/[id]', requestId: locals.requestId },
      { passUpstream: [401, 403] },
    );
  }
};

export const PATCH: RequestHandler = async ({ request, params, platform, locals }) => {
  if (!platform?.env) return json({ error: 'platform_unavailable' }, 500);
  const env = platform.env as unknown as SupabaseEnv;

  const jwt = extractAccessToken(request);
  if (!jwt) return json({ error: 'missing_authorization' }, 401);

  if (!UUID.test(params.id)) return json({ error: 'invalid_id' }, 400);

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return json({ error: 'invalid_body' }, 400);
  }
  const parsed = v.safeParse(VenuePatchSchema, raw);
  if (!parsed.success) {
    return json(
      {
        error: 'invalid_body',
        issues: parsed.issues.map((i) => ({
          path: i.path?.map((p) => p.key).join('.'),
          message: i.message,
        })),
      },
      400,
    );
  }
  const patch = { ...parsed.output };
  if (patch.country) patch.country = patch.country.toUpperCase();
  if (Object.keys(patch).length === 0) {
    return json({ error: 'empty_patch' }, 400);
  }

  try {
    const search = new URLSearchParams();
    search.set('id', `eq.${params.id}`);
    search.set('deleted_at', 'is.null');
    search.set('select', VENUE_COLS);
    const { data } = await pgPatch<Record<string, unknown>>(env, 'venue', jwt, patch, {
      search,
    });
    // Empty = missing id or RLS denied; PostgREST doesn't distinguish.
    if (data.length === 0) return json({ error: 'not_found' }, 404);
    return json({ venue: data[0] });
  } catch (err) {
    return pgErrorResponse(
      err,
      { route: 'PATCH /api/venues/[id]', requestId: locals.requestId },
      {
        codes: {
          '23505': {
            status: 409,
            error: 'venue_exists',
            hint: 'Another venue in this workspace already has this name and city.',
          },
          // 23514 = CHECK violation (country format, empty name).
          '23514': { status: 400, error: 'constraint_violation' },
        },
        passUpstream: [401, 403],
      },
    );
  }
};
