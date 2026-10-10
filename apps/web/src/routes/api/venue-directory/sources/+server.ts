/**
 * Directorio global de salas: its sources, licences and data dates, for
 * the credits page (the licences oblige: Licence Ouverte asks for the source
 * and the date, Gencat for attribution with the date, CC BY for attribution).
 *
 * GET /api/venue-directory/sources
 */

import type { RequestHandler } from './$types';
import { extractAccessToken } from '$lib/auth';
import { pgGet, type SupabaseEnv } from '$lib/supabase';
import { pgErrorResponse } from '$lib/server/errors';

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

export const GET: RequestHandler = async ({ request, platform, locals }) => {
  if (!platform?.env) return json({ error: 'platform_unavailable' }, 500);
  const env = platform.env as unknown as SupabaseEnv;

  const jwt = extractAccessToken(request);
  if (!jwt) return json({ error: 'missing_authorization' }, 401);

  const search = new URLSearchParams({
    select: 'key,name,publisher,license,license_url,source_url,attribution,data_date,imported_at',
    order: 'key.asc',
  });
  try {
    const { data } = await pgGet(env, 'venue_directory_source', jwt, { search });
    return json({ items: data });
  } catch (err) {
    return pgErrorResponse(err, { route: 'GET /api/venue-directory/sources', requestId: locals.requestId });
  }
};
