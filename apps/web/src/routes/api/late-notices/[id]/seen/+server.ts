/**
 * POST /api/late-notices/:id/seen: «Visto» (121 B, ADR-180). The first who
 * marks it stays, and the technician's sheet says who saw it. Whoever reads
 * the performance may; anything else is the same 403.
 */

import type { RequestHandler } from './$types';
import * as v from 'valibot';
import { extractAccessToken } from '$lib/auth';
import { pgPostRpc, type SupabaseEnv } from '$lib/supabase';
import { pgErrorResponse } from '$lib/server/errors';
import { json } from '$lib/server/http';

const IdSchema = v.pipe(v.string(), v.uuid());

export const POST: RequestHandler = async ({ request, params, platform, locals }) => {
  if (!platform?.env) return json({ error: 'platform_unavailable' }, 500);
  const env = platform.env as unknown as SupabaseEnv;

  const jwt = extractAccessToken(request);
  if (!jwt) return json({ error: 'missing_authorization' }, 401);

  const id = v.safeParse(IdSchema, params.id);
  if (!id.success) return json({ error: 'invalid_id' }, 400);

  try {
    await pgPostRpc(env, 'mark_roadsheet_late_seen', jwt, { p_notice_id: id.output });
    return new Response(null, { status: 204 });
  } catch (err) {
    return pgErrorResponse(
      err,
      { route: 'POST /api/late-notices/[id]/seen', requestId: locals.requestId },
      { codes: { '42501': { status: 403, error: 'forbidden_or_not_found' } } },
    );
  }
};
