/**
 * POST /api/messages: escribir en un hilo (ADR-106) por `post_message`.
 *
 * Body: { anchor_kind: 'bolo' | 'conversation', anchor_id, facet_id?,
 * performance_id?, body }. Sin faceta es el General del bolo (o el hilo del
 * equipo de una conversación). El hilo nace con el primer mensaje. El autor es
 * siempre el que llama: no hay parámetro para otro.
 *
 * 403 si no lee el hilo (ver una faceta es escribir en su hilo, pregunta 3);
 * 400 si el cuerpo no cabe o la función no cuelga de ese bolo.
 */

import type { RequestHandler } from './$types';
import * as v from 'valibot';
import { extractAccessToken } from '$lib/auth';
import { pgPostRpc, type SupabaseEnv } from '$lib/supabase';
import { pgErrorResponse } from '$lib/server/errors';
import { MessageCreateSchema, type ThreadMessage } from '$lib/threads';
import { json } from '$lib/server/http';

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
  const parsed = v.safeParse(MessageCreateSchema, raw);
  if (!parsed.success) return json({ error: 'invalid_body' }, 400);
  const input = parsed.output;

  try {
    const { data } = await pgPostRpc<ThreadMessage>(env, 'post_message', jwt, {
      p_anchor_kind: input.anchor_kind,
      p_anchor_id: input.anchor_id,
      p_body: input.body,
      p_facet_id: input.facet_id ?? null,
      p_performance_id: input.performance_id ?? null,
    });
    const row = data[0];
    if (!row) return json({ error: 'create_failed' }, 502);
    return json({ message: row }, 201);
  } catch (err) {
    return pgErrorResponse(
      err,
      { route: 'POST /api/messages', requestId: locals.requestId },
      {
        codes: {
          '22023': { status: 400, error: 'invalid_input' },
          '42501': { status: 403, error: 'forbidden_or_not_found' },
        },
      },
    );
  }
};
