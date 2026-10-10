/**
 * Directorio global de salas (fase 1): search.
 *
 * GET /api/venue-directory?q=&country= — entries whose name+city contain
 *     every word of `q` (normalised like the import's `search_key`), active
 *     first, at most 20. `country` (ISO-2) narrows. Read-only: the directory
 *     is written only by the import (scripts/venue-directory).
 *
 * Adopting an entry into a space is POST /api/venue-directory/adopt.
 */

import type { RequestHandler } from './$types';
import { extractAccessToken } from '$lib/auth';
import { normPlace } from '$lib/places';
import { DIRECTORY_COLS, directoryQueryWords } from '$lib/venue-directory';
import { pgGet, type SupabaseEnv } from '$lib/supabase';
import { pgErrorResponse } from '$lib/server/errors';

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

export const GET: RequestHandler = async ({ request, url, platform, locals }) => {
  if (!platform?.env) return json({ error: 'platform_unavailable' }, 500);
  const env = platform.env as unknown as SupabaseEnv;

  const jwt = extractAccessToken(request);
  if (!jwt) return json({ error: 'missing_authorization' }, 401);

  const words = directoryQueryWords(normPlace(url.searchParams.get('q') ?? ''));
  if (words.length === 0) return json({ items: [] });

  const search = new URLSearchParams();
  search.set('select', DIRECTORY_COLS);
  // normPlace leaves letters, digits and single spaces: nothing here can
  // break out of the PostgREST pattern.
  search.set('and', `(${words.map((w) => `search_key.ilike.*${w}*`).join(',')})`);
  const country = url.searchParams.get('country')?.trim().toUpperCase();
  if (country && /^[A-Z]{2}$/.test(country)) search.set('country', `eq.${country}`);
  search.set('order', 'status.asc,name.asc');
  search.set('limit', '20');

  try {
    const { data } = await pgGet(env, 'venue_directory', jwt, { search });
    return json({ items: data });
  } catch (err) {
    return pgErrorResponse(err, { route: 'GET /api/venue-directory', requestId: locals.requestId });
  }
};
