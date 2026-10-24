/**
 * GET /api/conversations/last-mailout: el último envío del alcance con sus
 * cifras (el bloque «Último envío» de Difusión y la noticia de Hoy).
 *
 * Salió del dashboard (`/api/conversations/overview`) el 2026-10-24: lo hacía
 * esperar unos 2 s (la RLS de `mailout` y hasta cuatro vistas previas una
 * detrás de otra). Ahora es su propia lectura, que la pantalla pide a la vez
 * que el panel y pinta cuando llega.
 *
 * Query: `project_ids`, `workspace_ids` (el alcance, unión; sin ninguno, todo).
 * No lee el chip: el envío es del alcance, como antes.
 *
 * Auth: Bearer JWT (o la cookie de sesión). Todo con la RLS de quien llama.
 */

import type { RequestHandler } from './$types';
import { extractAccessToken } from '$lib/auth';
import { type SupabaseEnv } from '$lib/supabase';
import { pgErrorResponse } from '$lib/server/errors';
import { loadLastMailout, parseIds } from '$lib/server/conversation-overview';
import type { LastMailoutResponse } from '$lib/conversation-overview';
import { json } from '$lib/server/http';

export const GET: RequestHandler = async ({ request, url, platform, locals }) => {
  if (!platform?.env) return json({ error: 'platform_unavailable' }, 500);
  const env = platform.env as unknown as SupabaseEnv;

  const jwt = extractAccessToken(request);
  if (!jwt) return json({ error: 'missing_authorization' }, 401);

  const scope = {
    projectIds: parseIds(url.searchParams.get('project_ids')),
    workspaceIds: parseIds(url.searchParams.get('workspace_ids')),
  };

  try {
    const body: LastMailoutResponse = { last_mailout: await loadLastMailout(env, jwt, scope) };
    return json(body);
  } catch (err) {
    return pgErrorResponse(err, { route: 'GET /api/conversations/last-mailout', requestId: locals.requestId });
  }
};
