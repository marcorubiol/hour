/**
 * GET /api/conversations/:id/bolos: los bolos de una conversación (ADR-138
 * § 3), con fecha, sala, ciudad y estado. Nunca caché ni pagador.
 *
 * Lo lee quien lee la conversación y tiene `read:performance` en el proyecto
 * (`conversation_bolos`); a cualquier otro, la RPC le devuelve una lista vacía
 * y esto responde `{ items: [] }`, sin decir si la conversación existe.
 *
 * Auth: Bearer JWT (o la cookie de sesión).
 */

import type { RequestHandler } from './$types';
import * as v from 'valibot';
import { extractAccessToken } from '$lib/auth';
import { pgPostRpc, type SupabaseEnv } from '$lib/supabase';
import { pgErrorResponse } from '$lib/server/errors';
import type { ConversationBolo } from '$lib/conversation-relation';
import { json } from '$lib/server/http';

const IdSchema = v.pipe(v.string(), v.uuid());

export const GET: RequestHandler = async ({ request, params, platform, locals }) => {
  if (!platform?.env) return json({ error: 'platform_unavailable' }, 500);
  const env = platform.env as unknown as SupabaseEnv;

  const jwt = extractAccessToken(request);
  if (!jwt) return json({ error: 'missing_authorization' }, 401);

  const idParsed = v.safeParse(IdSchema, params.id);
  if (!idParsed.success) return json({ error: 'invalid_id' }, 400);

  try {
    const { data } = await pgPostRpc<ConversationBolo>(env, 'conversation_bolos', jwt, {
      p_conversation_id: idParsed.output,
    });
    return json({ items: data });
  } catch (err) {
    return pgErrorResponse(err, { route: 'GET /api/conversations/[id]/bolos', requestId: locals.requestId });
  }
};
