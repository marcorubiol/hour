/**
 * GET /api/money/performance-bolos?performance_ids=a,b — de qué bolo cuelga
 * cada función (ADR-087 · `_tasks.md § 36`).
 *
 * `bolo_id` está fuera del SELECT por columnas de `performance` a propósito:
 * saber de qué trato cuelga una fecha es dinero. Esta ruta lo lee por la RPC
 * `list_performance_bolo_links`, con la puerta de `read:money` en el proyecto
 * de cada función. Quien no lee dinero recibe `items: []`, igual que quien
 * pregunta por una función que no existe: «sin bolo» y «no te toca» no se
 * distinguen, como en el resto del dinero.
 *
 * Una fila por función legible, con `bolo_id: null` cuando no tiene trato.
 */

import type { RequestHandler } from './$types';
import { extractAccessToken } from '$lib/auth';
import { pgPostRpc, type SupabaseEnv } from '$lib/supabase';
import { pgErrorResponse } from '$lib/server/errors';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

type Link = { performance_id: string; bolo_id: string | null };

export const GET: RequestHandler = async ({ request, url, platform, locals }) => {
  if (!platform?.env) return json({ error: 'platform_unavailable' }, 500);
  const env = platform.env as unknown as SupabaseEnv;

  const jwt = extractAccessToken(request);
  if (!jwt) return json({ error: 'missing_authorization' }, 401);

  const raw = url.searchParams.get('performance_ids') ?? '';
  const ids = [...new Set(raw.split(',').map((s) => s.trim()).filter(Boolean))];
  if (ids.length === 0 || ids.length > 500 || !ids.every((id) => UUID.test(id))) {
    return json({ error: 'invalid_query', hint: '1..500 performance uuids' }, 400);
  }

  try {
    const { data } = await pgPostRpc<Link>(env, 'list_performance_bolo_links', jwt, {
      p_performance_ids: ids,
    });
    return json({ items: data });
  } catch (err) {
    return pgErrorResponse(
      err,
      { route: 'GET /api/money/performance-bolos', requestId: locals.requestId },
      { passUpstream: [401, 403] },
    );
  }
};
