/**
 * Directorio global de salas: adopt an entry into a space.
 *
 * POST /api/venue-directory/adopt { workspace_id, directory_id } — copies
 *      the entry into a `venue` of the space via `adopt_directory_venue`
 *      (membership-gated; idempotent; a venue of the space with the same
 *      name and city is linked, not overwritten) and returns it with the
 *      venue columns. From then on the venue is the space's and is edited
 *      with PATCH /api/venues/:id like any other.
 */

import type { RequestHandler } from './$types';
import * as v from 'valibot';
import { extractAccessToken } from '$lib/auth';
import { VENUE_COLS } from '$lib/venue';
import { pgPostRpc, type SupabaseEnv } from '$lib/supabase';
import { pgErrorResponse } from '$lib/server/errors';

const AdoptSchema = v.object({
  workspace_id: v.pipe(v.string(), v.uuid()),
  directory_id: v.pipe(v.string(), v.uuid()),
});

const COLS = new Set(VENUE_COLS.split(','));

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

export const POST: RequestHandler = async ({ request, platform, locals }) => {
  if (!platform?.env) return json({ error: 'platform_unavailable' }, 500);
  const env = platform.env as unknown as SupabaseEnv;

  const jwt = extractAccessToken(request);
  if (!jwt) return json({ error: 'missing_authorization' }, 401);

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return json({ error: 'invalid_body' }, 400);
  }
  const parsed = v.safeParse(AdoptSchema, raw);
  if (!parsed.success) return json({ error: 'invalid_body' }, 400);

  try {
    const { data } = await pgPostRpc<Record<string, unknown>>(env, 'adopt_directory_venue', jwt, {
      p_workspace_id: parsed.output.workspace_id,
      p_directory_id: parsed.output.directory_id,
    });
    const row = data[0];
    if (!row) return json({ error: 'adopt_failed' }, 502);
    // Only the columns every venue endpoint returns (no audit fields).
    const venue = Object.fromEntries(Object.entries(row).filter(([k]) => COLS.has(k) || k === 'directory_id'));
    return json({ venue }, 201);
  } catch (err) {
    return pgErrorResponse(
      err,
      { route: 'POST /api/venue-directory/adopt', requestId: locals.requestId },
      {
        codes: {
          '22023': { status: 404, error: 'not_found' },
          '42501': { status: 403, error: 'forbidden' },
        },
      },
    );
  }
};
