/**
 * GET /api/threads: «de qué se habla» (ADR-106, fase 4; ADR-116). Los hilos
 * con mensajes que el que llama puede leer, los que tienen nuevos arriba, con
 * su último mensaje y la ficha que abre cada uno. Sin dinero.
 *
 * Query: `project_ids`, `workspace_ids` (uuid separados por coma), el alcance
 * de la barra lateral como en `/api/conversations`: unión; sin ninguno, todo.
 *
 * Auth: Bearer JWT (o la cookie de sesión).
 */

import type { RequestHandler } from './$types';
import { extractAccessToken } from '$lib/auth';
import { type SupabaseEnv } from '$lib/supabase';
import { pgErrorResponse } from '$lib/server/errors';
import { decodeJwtPayload } from '$lib/server/session';
import { loadThreadFeed } from '$lib/server/threads';
import { json } from '$lib/server/http';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function parseIds(raw: string | null): string[] {
  return raw ? [...new Set(raw.split(',').map((x) => x.trim()).filter((x) => UUID.test(x)))] : [];
}

export const GET: RequestHandler = async ({ request, url, platform, locals }) => {
  if (!platform?.env) return json({ error: 'platform_unavailable' }, 500);
  const env = platform.env as unknown as SupabaseEnv;

  const jwt = extractAccessToken(request);
  if (!jwt) return json({ error: 'missing_authorization' }, 401);
  const me = decodeJwtPayload(jwt)?.sub;
  if (typeof me !== 'string') return json({ error: 'missing_authorization' }, 401);

  try {
    const view = await loadThreadFeed(env, jwt, me, {
      projectIds: parseIds(url.searchParams.get('project_ids')),
      workspaceIds: parseIds(url.searchParams.get('workspace_ids')),
    });
    return json(view);
  } catch (err) {
    return pgErrorResponse(err, { route: 'GET /api/threads', requestId: locals.requestId });
  }
};
