/**
 * GET /api/conversations/feed: la lectura común de Conversaciones (ADR-138,
 * fase 3). Conversaciones e hilos del equipo en una sola lista, cada fila con
 * la regla de lectura de su tabla (`conversation_feed`): no leídos arriba,
 * después te toca, después lo último. Sin dinero.
 *
 * Query: `project_ids`, `workspace_ids` (el alcance de la barra lateral, unión;
 * sin ninguno, todo), `etiqueta` (sin ella, Todas; `team`, los hilos; una
 * clave, esa etiqueta), `q` (organización, contacto o contenedor) y `limit`
 * (100 por defecto, 500 como mucho).
 *
 * Auth: Bearer JWT (o la cookie de sesión).
 */

import type { RequestHandler } from './$types';
import { extractAccessToken } from '$lib/auth';
import { type SupabaseEnv } from '$lib/supabase';
import { pgErrorResponse } from '$lib/server/errors';
import { decodeJwtPayload } from '$lib/server/session';
import { loadConversationFeed } from '$lib/server/conversation-feed';
import { json } from '$lib/server/http';
import { ALL, TAG_KEY_RE, TEAM } from '$lib/conversation-tags';

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

  const etiqueta = url.searchParams.get('etiqueta');
  if (etiqueta !== null && etiqueta !== ALL && etiqueta !== TEAM && !TAG_KEY_RE.test(etiqueta)) {
    return json({ error: 'invalid_query' }, 400);
  }
  const q = (url.searchParams.get('q') ?? '').trim().slice(0, 120);
  const limit = Number(url.searchParams.get('limit') ?? 100);

  try {
    const view = await loadConversationFeed(
      env,
      jwt,
      me,
      {
        projectIds: parseIds(url.searchParams.get('project_ids')),
        workspaceIds: parseIds(url.searchParams.get('workspace_ids')),
        tag: etiqueta === ALL ? null : etiqueta,
        q: q || null,
        limit: Number.isFinite(limit) ? Math.min(Math.max(Math.trunc(limit), 1), 500) : 100,
      },
      new Date(),
    );
    return json(view);
  } catch (err) {
    return pgErrorResponse(err, { route: 'GET /api/conversations/feed', requestId: locals.requestId });
  }
};
