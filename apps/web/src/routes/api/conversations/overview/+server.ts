/**
 * GET /api/conversations/overview: el dashboard de «con quién hablas»
 * (ADR-117, propuesta A). Los bloques ya calculados en una sola petición: te
 * toca, la temporada, caliente y se enfría. Los hilos del equipo ya no están
 * aquí: son la lente Equipo (ADR-133). El último envío tampoco (2026-10-24):
 * es `GET /api/conversations/last-mailout`, que la pantalla pide a la vez y no
 * espera para pintar el panel.
 *
 * Query: `project_ids`, `workspace_ids` (el alcance de la lista, unión; sin
 * ninguno, todo) y `line_ids` (las líneas fijadas en la barra: acotan la
 * temporada, ADR-117 § 3).
 *
 * ADR-138 fase 2, el dominio es el chip: `etiqueta=<clave>` acota a las
 * conversaciones con esa etiqueta (sin ninguna se lee `sales`). Sin
 * `etiqueta`, todas, como el Desk.
 *
 * Auth: Bearer JWT (o la cookie de sesión). Todo con la RLS de quien llama.
 */

import type { RequestHandler } from './$types';
import { extractAccessToken } from '$lib/auth';
import { type SupabaseEnv } from '$lib/supabase';
import { pgErrorResponse } from '$lib/server/errors';
import { loadOverviewRows, parseIds } from '$lib/server/conversation-overview';
import { buildOverview, type OverviewResponse } from '$lib/conversation-overview';
import { json } from '$lib/server/http';
import { TAG_KEY_RE, filterByChip } from '$lib/conversation-tags';

export const GET: RequestHandler = async ({ request, url, platform, locals }) => {
  if (!platform?.env) return json({ error: 'platform_unavailable' }, 500);
  const env = platform.env as unknown as SupabaseEnv;

  const jwt = extractAccessToken(request);
  if (!jwt) return json({ error: 'missing_authorization' }, 401);

  const scope = {
    projectIds: parseIds(url.searchParams.get('project_ids')),
    workspaceIds: parseIds(url.searchParams.get('workspace_ids')),
  };
  const lineIds = parseIds(url.searchParams.get('line_ids'));
  const etiqueta = url.searchParams.get('etiqueta');
  if (etiqueta !== null && !TAG_KEY_RE.test(etiqueta)) return json({ error: 'invalid_query' }, 400);

  try {
    const all = await loadOverviewRows(env, jwt, scope);
    const rows = etiqueta ? filterByChip(all, etiqueta) : all;
    const body: OverviewResponse = buildOverview(rows, new Date(), { lineIds });
    return json(body);
  } catch (err) {
    return pgErrorResponse(err, { route: 'GET /api/conversations/overview', requestId: locals.requestId });
  }
};
