/**
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
import { extractBearer } from '$lib/auth';
import { VENUE_COLS, VenuePatchSchema } from '$lib/venue';
import { pgPatch, PostgrestError, type SupabaseEnv } from '$lib/supabase';

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const PATCH: RequestHandler = async ({ request, params, platform }) => {
  if (!platform?.env) return json({ error: 'platform_unavailable' }, 500);
  const env = platform.env as unknown as SupabaseEnv;

  const jwt = extractBearer(request);
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
    if (err instanceof PostgrestError) {
      if (err.code === '23505') {
        return json(
          {
            error: 'venue_exists',
            hint: 'Another venue in this workspace already has this name and city.',
          },
          409,
        );
      }
      // 23514 = CHECK violation (country format, empty name).
      if (err.code === '23514') {
        return json({ error: 'constraint_violation', detail: err.body }, 400);
      }
      const upstream = err.status === 401 || err.status === 403 ? err.status : 502;
      return json({ error: 'postgrest_error', status: err.status, detail: err.body }, upstream);
    }
    return json({ error: 'unexpected', detail: String(err) }, 500);
  }
};
