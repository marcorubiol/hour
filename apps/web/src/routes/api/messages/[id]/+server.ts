/**
 * PATCH  /api/messages/:id: { body }: el autor corrige su mensaje
 *        (`edit_message`), mientras siga leyendo el hilo.
 * DELETE /api/messages/:id: borrado blando del propio (`delete_message`).
 *
 * Las dos RPC dan el mismo 42501 a «no existe» y «no es tuyo»: aquí, 403.
 */

import type { RequestHandler } from './$types';
import * as v from 'valibot';
import { extractAccessToken } from '$lib/auth';
import { pgPostRpc, type SupabaseEnv } from '$lib/supabase';
import { pgErrorResponse } from '$lib/server/errors';
import { MessageEditSchema, type ThreadMessage } from '$lib/threads';
import { json } from '$lib/server/http';

const IdSchema = v.pipe(v.string(), v.uuid());

const CODES = {
  '22023': { status: 400, error: 'invalid_input' },
  '42501': { status: 403, error: 'forbidden_or_not_found' },
};

export const PATCH: RequestHandler = async ({ request, params, platform, locals }) => {
  if (!platform?.env) return json({ error: 'platform_unavailable' }, 500);
  const env = platform.env as unknown as SupabaseEnv;

  const jwt = extractAccessToken(request);
  if (!jwt) return json({ error: 'missing_authorization' }, 401);

  const idParsed = v.safeParse(IdSchema, params.id);
  if (!idParsed.success) return json({ error: 'invalid_id' }, 400);

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return json({ error: 'invalid_body' }, 400);
  }
  const parsed = v.safeParse(MessageEditSchema, raw);
  if (!parsed.success) return json({ error: 'invalid_body' }, 400);

  try {
    const { data } = await pgPostRpc<ThreadMessage>(env, 'edit_message', jwt, {
      p_message_id: idParsed.output,
      p_body: parsed.output.body,
    });
    return json({ message: data[0] ?? null });
  } catch (err) {
    return pgErrorResponse(err, { route: 'PATCH /api/messages/[id]', requestId: locals.requestId }, { codes: CODES });
  }
};

export const DELETE: RequestHandler = async ({ request, params, platform, locals }) => {
  if (!platform?.env) return json({ error: 'platform_unavailable' }, 500);
  const env = platform.env as unknown as SupabaseEnv;

  const jwt = extractAccessToken(request);
  if (!jwt) return json({ error: 'missing_authorization' }, 401);

  const idParsed = v.safeParse(IdSchema, params.id);
  if (!idParsed.success) return json({ error: 'invalid_id' }, 400);

  try {
    await pgPostRpc(env, 'delete_message', jwt, { p_message_id: idParsed.output });
    return new Response(null, { status: 204 });
  } catch (err) {
    return pgErrorResponse(err, { route: 'DELETE /api/messages/[id]', requestId: locals.requestId }, { codes: CODES });
  }
};
