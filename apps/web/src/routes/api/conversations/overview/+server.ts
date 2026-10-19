/**
 * GET /api/conversations/overview: el dashboard de «con quién hablas»
 * (ADR-117, propuesta A). Los bloques ya calculados en una sola petición: te
 * toca, la temporada, caliente, se enfría y el último envío. Los hilos del
 * equipo ya no están aquí: son la lente Equipo (ADR-133).
 *
 * Query: `project_ids`, `workspace_ids` (el alcance de la lista, unión; sin
 * ninguno, todo) y `line_ids` (las líneas fijadas en la barra: acotan la
 * temporada, ADR-117 § 3).
 *
 * ADR-138 fase 2, el dominio es el chip: `etiqueta=<clave>` acota a las
 * conversaciones con esa etiqueta (sin ninguna se lee `sales`), y `panel=common`
 * dice que la pantalla solo pinta el panel común (te toca): no se lee el
 * último envío, que es de Difusión. Sin `etiqueta`, todas, como el Desk.
 *
 * Auth: Bearer JWT (o la cookie de sesión). Todo con la RLS de quien llama.
 */

import type { RequestHandler } from './$types';
import { extractAccessToken } from '$lib/auth';
import { type SupabaseEnv } from '$lib/supabase';
import { pgErrorResponse } from '$lib/server/errors';
import { loadLastMailout, loadOverviewRows } from '$lib/server/conversation-overview';
import { buildOverview, type OverviewResponse } from '$lib/conversation-overview';
import { TAG_KEY_RE, filterByChip } from '$lib/conversation-tags';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

function parseIds(raw: string | null): string[] {
  return raw ? [...new Set(raw.split(',').map((x) => x.trim()).filter((x) => UUID.test(x)))] : [];
}

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
  const common = url.searchParams.get('panel') === 'common';

  try {
    const all = await loadOverviewRows(env, jwt, scope);
    const rows = etiqueta ? filterByChip(all, etiqueta) : all;
    const body: OverviewResponse = {
      ...buildOverview(rows, new Date(), { lineIds }),
      last_mailout: common ? null : await loadLastMailout(env, jwt, scope, all),
    };
    return json(body);
  } catch (err) {
    return pgErrorResponse(err, { route: 'GET /api/conversations/overview', requestId: locals.requestId });
  }
};
