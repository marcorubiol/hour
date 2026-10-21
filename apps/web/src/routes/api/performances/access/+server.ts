/**
 * GET /api/performances/access — ¿edita el plan quien llama, en ALGUNO de
 * los proyectos que ve? `{ edit: boolean }`.
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

export const GET: RequestHandler = async ({ request, platform, locals }) => {
  if (!platform?.env) return json({ error: 'platform_unavailable' }, 500);
  const env = platform.env as unknown as SupabaseEnv;

  const jwt = extractAccessToken(request);
  if (!jwt) return json({ error: 'missing_authorization' }, 401);

  try {
    const search = new URLSearchParams({ select: 'id', deleted_at: 'is.null', limit: '500' });
    const { data: projects } = await pgGet<{ id: string }>(env, 'project', jwt, { search });
    const edit = await Promise.any(
      projects.map(async (p) => {
        const { data } = await pgPostRpc<boolean>(env, 'has_permission', jwt, {
          p_project_id: p.id,
          p_perm: 'edit:performance',
        });
        if (data[0] === true) return true;
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
