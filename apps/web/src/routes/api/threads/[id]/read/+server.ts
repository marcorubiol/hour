/**
 * POST /api/threads/:id/read: el hilo, leído hasta su último mensaje
 * (`mark_thread_read`, ADR-106 pregunta 6). Devuelve { last_read_at }.
 * Un hilo que no lees, 403 (igual que uno que no existe).
 */

import type { RequestHandler } from './$types';
import * as v from 'valibot';
import { extractAccessToken } from '$lib/auth';
import { pgPostRpc, type SupabaseEnv } from '$lib/supabase';
import { pgErrorResponse } from '$lib/server/errors';

const IdSchema = v.pipe(v.string(), v.uuid());

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

export const POST: RequestHandler = async ({ request, params, platform, locals }) => {
  if (!platform?.env) return json({ error: 'platform_unavailable' }, 500);
  const env = platform.env as unknown as SupabaseEnv;

  const jwt = extractAccessToken(request);
  if (!jwt) return json({ error: 'missing_authorization' }, 401);

  const idParsed = v.safeParse(IdSchema, params.id);
  if (!idParsed.success) return json({ error: 'invalid_id' }, 400);

  try {
    const { data } = await pgPostRpc<string>(env, 'mark_thread_read', jwt, { p_thread_id: idParsed.output });
    return json({ last_read_at: data[0] ?? null });
  } catch (err) {
    return pgErrorResponse(
      err,
      { route: 'POST /api/threads/[id]/read', requestId: locals.requestId },
      { codes: { '42501': { status: 403, error: 'forbidden_or_not_found' } } },
    );
  }
};
