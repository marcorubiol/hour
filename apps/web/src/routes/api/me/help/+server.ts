/**
 * Ayuda contextual (enfoque A): qué tarjetas de bienvenida y avisos de primera
 * vez ha visto quien llama. Es por persona, no por espacio ni por navegador.
 *
 * GET    /api/me/help: `{ seen }`, la fila propia de `help_seen` (o `{}`).
 * POST   /api/me/help: `{ key }` por `mark_help_seen`; devuelve `{ seen }`.
 * DELETE /api/me/help: «Volver a ver las ayudas», por `reset_help_seen`.
 *
 * La RLS solo deja leer la fila propia; las dos RPC solo escriben la propia.
 *
 * Auth: Bearer JWT (o la cookie de sesión).
 */

import type { RequestHandler } from './$types';
import * as v from 'valibot';
import { extractAccessToken } from '$lib/auth';
import { pgGet, pgPostRpc, type SupabaseEnv } from '$lib/supabase';
import { pgErrorResponse } from '$lib/server/errors';
import { HELP_KEY, type HelpSeen } from '$lib/help';
import { jsonNoStore } from '$lib/server/http';

const BodySchema = v.object({ key: v.pipe(v.string(), v.regex(HELP_KEY)) });

export const GET: RequestHandler = async ({ request, platform, locals }) => {
  if (!platform?.env) return jsonNoStore({ error: 'platform_unavailable' }, 500);
  const env = platform.env as unknown as SupabaseEnv;
  const jwt = extractAccessToken(request);
  if (!jwt) return jsonNoStore({ error: 'missing_authorization' }, 401);

  try {
    // Sin filtro por user_id: la política ya solo deja ver la fila propia.
    const { data } = await pgGet<{ seen: HelpSeen }>(env, 'help_seen', jwt, {
      search: { select: 'seen', limit: '1' },
    });
    return jsonNoStore({ seen: data[0]?.seen ?? {} });
  } catch (err) {
    return pgErrorResponse(err, { route: 'GET /api/me/help', requestId: locals.requestId });
  }
};

export const POST: RequestHandler = async ({ request, platform, locals }) => {
  if (!platform?.env) return jsonNoStore({ error: 'platform_unavailable' }, 500);
  const env = platform.env as unknown as SupabaseEnv;
  const jwt = extractAccessToken(request);
  if (!jwt) return jsonNoStore({ error: 'missing_authorization' }, 401);

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return jsonNoStore({ error: 'invalid_body' }, 400);
  }
  const parsed = v.safeParse(BodySchema, raw);
  if (!parsed.success) return jsonNoStore({ error: 'invalid_body' }, 400);

  try {
    const { data } = await pgPostRpc<HelpSeen>(env, 'mark_help_seen', jwt, { p_key: parsed.output.key });
    return jsonNoStore({ seen: data[0] ?? {} });
  } catch (err) {
    return pgErrorResponse(
      err,
      { route: 'POST /api/me/help', requestId: locals.requestId },
      { codes: { '22023': { status: 400, error: 'invalid_input' } } },
    );
  }
};

export const DELETE: RequestHandler = async ({ request, platform, locals }) => {
  if (!platform?.env) return jsonNoStore({ error: 'platform_unavailable' }, 500);
  const env = platform.env as unknown as SupabaseEnv;
  const jwt = extractAccessToken(request);
  if (!jwt) return jsonNoStore({ error: 'missing_authorization' }, 401);

  try {
    await pgPostRpc(env, 'reset_help_seen', jwt);
    return jsonNoStore({ seen: {} });
  } catch (err) {
    return pgErrorResponse(err, { route: 'DELETE /api/me/help', requestId: locals.requestId });
  }
};
