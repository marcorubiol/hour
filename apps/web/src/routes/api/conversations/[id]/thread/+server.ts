/**
 * GET /api/conversations/:id/thread: el hilo del equipo de una conversación
 * (ADR-106, fase 3), con sus mensajes, quién los escribió y hasta dónde había
 * leído el que llama.
 *
 * Lo lee quien lee la conversación, privacidad incluida. Una conversación que
 * no lees (o que no existe) responde 404, sin decir cuál de las dos. Nadie ha
 * escrito aún: `thread.thread_id` null, y el primer mensaje lo crea
 * (`POST /api/messages` con `anchor_kind: 'conversation'`).
 *
 * Auth: Bearer JWT (o la cookie de sesión).
 */

import type { RequestHandler } from './$types';
import * as v from 'valibot';
import { extractAccessToken } from '$lib/auth';
import { type SupabaseEnv } from '$lib/supabase';
import { pgErrorResponse } from '$lib/server/errors';
import { decodeJwtPayload } from '$lib/server/session';
import { loadConversationThread } from '$lib/server/threads';

const IdSchema = v.pipe(v.string(), v.uuid());

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

export const GET: RequestHandler = async ({ request, params, platform, locals }) => {
  if (!platform?.env) return json({ error: 'platform_unavailable' }, 500);
  const env = platform.env as unknown as SupabaseEnv;

  const jwt = extractAccessToken(request);
  if (!jwt) return json({ error: 'missing_authorization' }, 401);
  const me = decodeJwtPayload(jwt)?.sub;
  if (typeof me !== 'string') return json({ error: 'missing_authorization' }, 401);

  const idParsed = v.safeParse(IdSchema, params.id);
  if (!idParsed.success) return json({ error: 'invalid_id' }, 400);

  try {
    const view = await loadConversationThread(env, jwt, me, idParsed.output);
    if (!view) return json({ error: 'not_found' }, 404);
    return json(view);
  } catch (err) {
    return pgErrorResponse(err, { route: 'GET /api/conversations/[id]/thread', requestId: locals.requestId });
  }
};
