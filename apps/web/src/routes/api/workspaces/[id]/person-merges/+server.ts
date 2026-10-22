/**
 * GET /api/workspaces/:id/person-merges — lo que Ajustes › Equipo dice de
 * las fusiones de persona del espacio (plan 2026-10-22, fase 3):
 *
 *   · `unmerged`: invitaciones aceptadas por una cuenta que ya era otra
 *     persona, con su dossier sin unir (`list_unmerged_invitations`).
 *   · `recent`: fusiones de los últimos 30 días sin deshacer, con los dos
 *     nombres (`person_merge`; su RLS la enseña solo al admin).
 *
 * Solo el admin del espacio: la RPC lo exige (42501 → 403). Sin la migración
 * de la fase 3, `unmerged` sale vacío y lo demás sigue.
 *
 * Auth: Bearer JWT.
 */

import type { RequestHandler } from './$types';
import * as v from 'valibot';
import { extractAccessToken } from '$lib/auth';
import { pgGet, pgPostRpc, type SupabaseEnv } from '$lib/supabase';
import { pgErrorResponse } from '$lib/server/errors';
import { jsonNoStore } from '$lib/server/http';
import { isMissingFunction } from '$lib/server/person-merge';
import { UNDO_DAYS, type RecentMerge, type UnmergedInvitation } from '$lib/person-merge';

const UUID = v.pipe(v.string(), v.uuid());

export const GET: RequestHandler = async ({ request, params, platform, locals }) => {
  if (!platform?.env) return jsonNoStore({ error: 'platform_unavailable' }, 500);
  const env = platform.env as unknown as SupabaseEnv;
  const jwt = extractAccessToken(request);
  if (!jwt) return jsonNoStore({ error: 'missing_authorization' }, 401);
  const id = v.safeParse(UUID, params.id ?? '');
  if (!id.success) return jsonNoStore({ error: 'invalid_id' }, 400);
  const workspaceId = id.output;

  try {
    const since = new Date(Date.now() - UNDO_DAYS * 86_400_000).toISOString();
    const [unmerged, merges] = await Promise.all([
      pgPostRpc<UnmergedInvitation>(env, 'list_unmerged_invitations', jwt, { p_workspace_id: workspaceId }).catch(
        (err) => {
          if (isMissingFunction(err)) return { data: [] as UnmergedInvitation[] };
          throw err;
        },
      ),
      pgGet<{ id: string; merged_at: string; keep_person_id: string; drop_name: string | null }>(
        env,
        'person_merge',
        jwt,
        {
          search: new URLSearchParams({
            select: 'id,merged_at,keep_person_id,drop_name:drop_dossier_before->>full_name',
            workspace_id: `eq.${workspaceId}`,
            undone_at: 'is.null',
            merged_at: `gt.${since}`,
            order: 'merged_at.desc',
            limit: '20',
          }),
        },
      ),
    ]);

    // Los nombres de las fichas que se quedaron (las que siguen vivas).
    const keepIds = [...new Set(merges.data.map((m) => m.keep_person_id))];
    const keeps =
      keepIds.length === 0
        ? { data: [] as Array<{ person_id: string; slug: string; full_name: string }> }
        : await pgGet<{ person_id: string; slug: string; full_name: string }>(env, 'workspace_person', jwt, {
            search: new URLSearchParams({
              select: 'person_id,slug,full_name',
              workspace_id: `eq.${workspaceId}`,
              person_id: `in.(${keepIds.join(',')})`,
              deleted_at: 'is.null',
            }),
          });
    const keepById = new Map(keeps.data.map((k) => [k.person_id, k]));
    const recent: RecentMerge[] = merges.data.map((m) => ({
      ...m,
      keep_name: keepById.get(m.keep_person_id)?.full_name ?? null,
      keep_slug: keepById.get(m.keep_person_id)?.slug ?? null,
    }));

    return jsonNoStore({ unmerged: unmerged.data, recent });
  } catch (err) {
    return pgErrorResponse(
      err,
      { route: 'GET /api/workspaces/[id]/person-merges', requestId: locals.requestId },
      { codes: { '42501': { status: 403, error: 'forbidden' } }, passUpstream: [401, 403] },
    );
  }
};
