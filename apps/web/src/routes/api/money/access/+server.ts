/**
 * GET /api/money/access?project_id=X — ¿lee dinero quien llama, en ese
 * proyecto? `{ read_money: boolean }`.
 * GET /api/money/access (sin proyecto) — ¿lo lee en ALGUNO de los proyectos
 * que ve? Es la puerta de la lente Cuentas (ADR-117): quien no lee dinero en
 * ninguno no la ve en el selector de lentes, y si entra por URL se le dice que
 * no tiene acceso, nunca «no hay bolos». Recorre los proyectos que RLS le deja
 * ver y pregunta `has_permission` por cada uno, en paralelo y hasta el primer
 * sí: en Phase 0 son pocos. Un RPC `money_access_any()` lo haría en una
 * llamada; queda para cuando haya migración (propuesta de Cuentas § 4.9).
 *
 * Existe para una sola pregunta de pantalla (`_tasks.md § 36`): el feed de
 * bolos devuelve `[]` tanto a quien no lee dinero como a un proyecto sin
 * tratos, y el alta de función tiene que distinguirlos para ofrecer «crear un
 * bolo en Cuentas» solo a quien puede verlo después. Lo responde
 * `has_permission`, la misma regla que deciden las RPC de dinero; no abre
 * ningún dato, solo dice sí o no sobre el propio llamante. Un proyecto ajeno o
 * inexistente responde `false`, igual que uno sin permiso.
 */

import type { RequestHandler } from './$types';
import { extractAccessToken } from '$lib/auth';
import { pgGet, pgPostRpc, type SupabaseEnv } from '$lib/supabase';
import { pgErrorResponse } from '$lib/server/errors';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

export const GET: RequestHandler = async ({ request, url, platform, locals }) => {
  if (!platform?.env) return json({ error: 'platform_unavailable' }, 500);
  const env = platform.env as unknown as SupabaseEnv;

  const jwt = extractAccessToken(request);
  if (!jwt) return json({ error: 'missing_authorization' }, 401);

  const projectId = url.searchParams.get('project_id');
  if (projectId !== null && !UUID.test(projectId)) return json({ error: 'invalid_query' }, 400);

  const readsMoney = async (id: string) => {
    const { data } = await pgPostRpc<boolean>(env, 'has_permission', jwt, {
      p_project_id: id,
      p_perm: 'read:money',
    });
    return data[0] === true;
  };

  try {
    if (projectId !== null) return json({ read_money: await readsMoney(projectId) });
    const search = new URLSearchParams({ select: 'id', deleted_at: 'is.null', limit: '500' });
    const { data: projects } = await pgGet<{ id: string }>(env, 'project', jwt, { search });
    const any = await Promise.any(
      projects.map(async (p) => {
        if (await readsMoney(p.id)) return true;
        throw new Error('no');
      }),
    ).catch(() => false);
    return json({ read_money: any });
  } catch (err) {
    return pgErrorResponse(
      err,
      { route: 'GET /api/money/access', requestId: locals.requestId },
      { passUpstream: [401, 403] },
    );
  }
};
