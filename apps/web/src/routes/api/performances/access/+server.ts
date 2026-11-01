/**
 * GET /api/performances/access — ¿edita el plan quien llama, en ALGUNO de
 * los proyectos que ve? `{ edit: boolean }`.
 * GET /api/performances/access?project_id=X: ¿lo edita en ESE proyecto? La
 * puerta de «+ función» en la ficha del bolo (`_tasks.md § 36`): quien lee el
 * bolo (`read:money`) no por eso escribe funciones. Un proyecto ajeno o
 * inexistente responde `false`, igual que uno sin permiso.
 *
 * La puerta de «Nueva función» y «Nueva fecha» en ⌘K (ADR-139 «después»):
 * quien no puede escribir ni una función ni una fecha en ningún proyecto no
 * ve las acciones. Funciones y fechas comparten la regla, `edit:performance`
 * (`lib/do/auth.ts`). Como `/api/money/access` sin proyecto: recorre los
 * proyectos que RLS le deja ver y pregunta `has_permission` por cada uno, en
 * paralelo y hasta el primer sí; en Phase 0 son pocos, y un RPC de una sola
 * llamada queda para cuando haya migración. No abre ningún dato.
 */

import type { RequestHandler } from './$types';
import { extractAccessToken } from '$lib/auth';
import { pgGet, pgPostRpc, type SupabaseEnv } from '$lib/supabase';
import { pgErrorResponse } from '$lib/server/errors';
import { json } from '$lib/server/http';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const GET: RequestHandler = async ({ request, url, platform, locals }) => {
  if (!platform?.env) return json({ error: 'platform_unavailable' }, 500);
  const env = platform.env as unknown as SupabaseEnv;

  const jwt = extractAccessToken(request);
  if (!jwt) return json({ error: 'missing_authorization' }, 401);

  const projectId = url.searchParams.get('project_id');
  if (projectId !== null && !UUID.test(projectId)) return json({ error: 'invalid_query' }, 400);

  const edits = async (id: string) => {
    const { data } = await pgPostRpc<boolean>(env, 'has_permission', jwt, {
      p_project_id: id,
      p_perm: 'edit:performance',
    });
    return data[0] === true;
  };

  try {
    if (projectId !== null) return json({ edit: await edits(projectId) });
    const search = new URLSearchParams({ select: 'id', deleted_at: 'is.null', limit: '500' });
    const { data: projects } = await pgGet<{ id: string }>(env, 'project', jwt, { search });
    const edit = await Promise.any(
      projects.map(async (p) => {
        if (await edits(p.id)) return true;
        throw new Error('no');
      }),
    ).catch(() => false);
    return json({ edit });
  } catch (err) {
    return pgErrorResponse(
      err,
      { route: 'GET /api/performances/access', requestId: locals.requestId },
      { passUpstream: [401, 403] },
    );
  }
};
