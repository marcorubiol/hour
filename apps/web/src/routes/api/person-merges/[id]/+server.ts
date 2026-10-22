/**
 * DELETE /api/person-merges/:id — deshacer una fusión (`undo_person_merge`):
 * admin del espacio, menos de 30 días, una vez. Lo movido vuelve a la ficha
 * que desapareció; lo creado después sobre la que se quedó, se queda.
 * Devuelve cuántas filas se saltó y el slug de la ficha que vuelve.
 *
 * Auth: Bearer JWT.
 */

import type { RequestHandler } from './$types';
import { extractAccessToken } from '$lib/auth';
import { pgGet, pgPostRpc, type SupabaseEnv } from '$lib/supabase';
import { pgErrorResponse } from '$lib/server/errors';
import { isUuid } from '$lib/server/performance-bundle';
import { json } from '$lib/server/http';
import { refusalResponse } from '$lib/server/person-merge';

export const DELETE: RequestHandler = async ({ request, params, platform, locals }) => {
  if (!platform?.env) return json({ error: 'platform_unavailable' }, 500);
  const env = platform.env as unknown as SupabaseEnv;
  const jwt = extractAccessToken(request);
  if (!jwt) return json({ error: 'missing_authorization' }, 401);
  if (!isUuid(params.id)) return json({ error: 'invalid_id' }, 400);

  try {
    // Antes de deshacer: a quién devuelve (person_merge la lee el admin).
    const before = await pgGet<{ workspace_id: string; drop_person_id: string }>(env, 'person_merge', jwt, {
      search: new URLSearchParams({ select: 'workspace_id,drop_person_id', id: `eq.${params.id}`, limit: '1' }),
    });
    const { data } = await pgPostRpc<{ merge_id: string; skipped: number; keep_kept: boolean }>(
      env,
      'undo_person_merge',
      jwt,
      { p_merge_id: params.id },
    );
    const m = before.data[0];
    let dropSlug: string | null = null;
    if (m) {
      const drop = await pgGet<{ slug: string }>(env, 'workspace_person', jwt, {
        search: new URLSearchParams({
          select: 'slug',
          workspace_id: `eq.${m.workspace_id}`,
          person_id: `eq.${m.drop_person_id}`,
          deleted_at: 'is.null',
          limit: '1',
        }),
      });
      dropSlug = drop.data[0]?.slug ?? null;
    }
    return json({ undo: { ...(data[0] ?? {}), drop_slug: dropSlug } });
  } catch (err) {
    return (
      refusalResponse(err) ??
      pgErrorResponse(
        err,
        { route: 'DELETE /api/person-merges/[id]', requestId: locals.requestId },
        { codes: { '42501': { status: 404, error: 'not_found' } } },
      )
    );
  }
};
