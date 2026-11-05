/**
 * GET /api/late-notices: the open «llego tarde» notices (121 B, ADR-180):
 * the last one of each personal link, from the last 24 h, nobody has marked
 * «Visto», of the performances the caller reads. Hoy and Ahora draw them as a
 * band at the top. `roadsheet_late_notices()` decides who sees what and
 * whether they may move the time (`can_edit`).
 */

import type { RequestHandler } from './$types';
import { extractAccessToken } from '$lib/auth';
import { pgPostRpc, type SupabaseEnv } from '$lib/supabase';
import { pgErrorResponse } from '$lib/server/errors';
import { json } from '$lib/server/http';
import type { LateNotice } from '$lib/roadsheet-late';

export const GET: RequestHandler = async ({ request, platform, locals }) => {
  if (!platform?.env) return json({ error: 'platform_unavailable' }, 500);
  const env = platform.env as unknown as SupabaseEnv;

  const jwt = extractAccessToken(request);
  if (!jwt) return json({ error: 'missing_authorization' }, 401);

  try {
    // A jsonb array comes back as the array itself (`pgPostRpc` normalises).
    const { data } = await pgPostRpc<LateNotice>(env, 'roadsheet_late_notices', jwt, {});
    return json({ items: data.filter(Boolean) });
  } catch (err) {
    return pgErrorResponse(err, { route: 'GET /api/late-notices', requestId: locals.requestId });
  }
};
