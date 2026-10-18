/**
 * GET /api/conversations/access — ¿lee o edita conversaciones quien llama, en
 * ALGUNO de sus proyectos? `{ read: boolean, edit: boolean }`.
 *
 * La puerta de la lente Conversations (ADR-124, `permisos.md` § 4), como
 * `/api/money/access` lo es de Cuentas: sin `read` el selector de lentes la
 * esconde y la lente dice «no tienes acceso»; sin `edit` no ofrece «Añadir»,
 * «Seleccionar» ni importar, ni pide el directorio de organizaciones (que la
 * RLS ya no le da). Lo responde `conversation_access()`, la misma regla que
 * `has_permission`; no abre ningún dato, solo dice sí o no sobre quien llama.
 */

import type { RequestHandler } from './$types';
import { extractAccessToken } from '$lib/auth';
import { pgPostRpc, type SupabaseEnv } from '$lib/supabase';
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

  try {
    const { data } = await pgPostRpc<{ read: boolean; edit: boolean }>(env, 'conversation_access', jwt, {});
    const row = data[0];
    return json({ read: row?.read === true, edit: row?.edit === true });
  } catch (err) {
    return pgErrorResponse(
      err,
      { route: 'GET /api/conversations/access', requestId: locals.requestId },
      { passUpstream: [401, 403] },
    );
  }
};
