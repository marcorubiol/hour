/**
 * «Ahora no» en «Te espera» (ADR-232): lo que quien llama ha apartado y el
 * día en que vuelve cada cosa. Es por persona, no por espacio ni por navegador.
 *
 * GET  /api/me/set-aside: `{ items }`, la fila propia de `desk_set_aside` (o `{}`).
 * POST /api/me/set-aside: `{ key, until }` por `set_aside_desk_item`; `until`
 *      nulo trae la fila de vuelta. Devuelve `{ items }`.
 *
 * La RLS solo deja leer la fila propia; la RPC solo escribe la propia.
 *
 * Auth: Bearer JWT (o la cookie de sesión).
 */

import type { RequestHandler } from './$types';
import * as v from 'valibot';
import { extractAccessToken } from '$lib/auth';
import { pgGet, pgPostRpc, type SupabaseEnv } from '$lib/supabase';
import { pgErrorResponse } from '$lib/server/errors';
import { SET_ASIDE_KEY, type SetAside } from '$lib/set-aside';
import { jsonNoStore } from '$lib/server/http';

const BodySchema = v.object({
  key: v.pipe(v.string(), v.regex(SET_ASIDE_KEY)),
  until: v.nullable(v.pipe(v.string(), v.regex(/^\d{4}-\d{2}-\d{2}$/))),
});

export const GET: RequestHandler = async ({ request, platform, locals }) => {
  if (!platform?.env) return jsonNoStore({ error: 'platform_unavailable' }, 500);
  const env = platform.env as unknown as SupabaseEnv;
  const jwt = extractAccessToken(request);
  if (!jwt) return jsonNoStore({ error: 'missing_authorization' }, 401);

  try {
    // Sin filtro por user_id: la política ya solo deja ver la fila propia.
    const { data } = await pgGet<{ items: SetAside }>(env, 'desk_set_aside', jwt, {
      search: { select: 'items', limit: '1' },
    });
    return jsonNoStore({ items: data[0]?.items ?? {} });
  } catch (err) {
    return pgErrorResponse(err, { route: 'GET /api/me/set-aside', requestId: locals.requestId });
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
    const { data } = await pgPostRpc<SetAside>(env, 'set_aside_desk_item', jwt, {
      p_key: parsed.output.key,
      p_until: parsed.output.until,
    });
    return jsonNoStore({ items: data[0] ?? {} });
  } catch (err) {
    return pgErrorResponse(
      err,
      { route: 'POST /api/me/set-aside', requestId: locals.requestId },
      { codes: { '22023': { status: 400, error: 'invalid_input' } } },
    );
  }
};
