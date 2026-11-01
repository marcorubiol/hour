/**
 * GET /api/workspaces/:id/organization-merges: las fusiones de organización
 * de los últimos 30 días sin deshacer, con los dos nombres (84, ADR-171), para
 * Ajustes › Equipo junto a las de persona. `organization_merge` la lee solo
 * el admin del espacio (RLS): cualquier otro recibe una lista vacía.
 *
 * Auth: Bearer JWT.
 */

import type { RequestHandler } from './$types';
import * as v from 'valibot';
import { extractAccessToken } from '$lib/auth';
import { pgGet, type SupabaseEnv } from '$lib/supabase';
import { pgErrorResponse } from '$lib/server/errors';
import { jsonNoStore } from '$lib/server/http';
import { UNDO_DAYS, type RecentOrgMerge } from '$lib/organization-merge';

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
    const merges = await pgGet<{
      id: string;
      merged_at: string;
      keep_organization_id: string;
      drop_name: string | null;
    }>(env, 'organization_merge', jwt, {
      search: new URLSearchParams({
        select: 'id,merged_at,keep_organization_id,drop_name:drop_before->>name',
        workspace_id: `eq.${workspaceId}`,
        undone_at: 'is.null',
        merged_at: `gt.${since}`,
        order: 'merged_at.desc',
        limit: '20',
      }),
    });

    const keepIds = [...new Set(merges.data.map((m) => m.keep_organization_id))];
    const keeps =
      keepIds.length === 0
        ? { data: [] as Array<{ id: string; slug: string; name: string }> }
        : await pgGet<{ id: string; slug: string; name: string }>(env, 'workspace_organization', jwt, {
            search: new URLSearchParams({
              select: 'id,slug,name',
              id: `in.(${keepIds.join(',')})`,
              deleted_at: 'is.null',
            }),
          });
    const keepById = new Map(keeps.data.map((k) => [k.id, k]));
    const recent: RecentOrgMerge[] = merges.data.map((m) => ({
      ...m,
      keep_name: keepById.get(m.keep_organization_id)?.name ?? null,
      keep_slug: keepById.get(m.keep_organization_id)?.slug ?? null,
    }));
    return jsonNoStore({ recent });
  } catch (err) {
    return pgErrorResponse(
      err,
      { route: 'GET /api/workspaces/[id]/organization-merges', requestId: locals.requestId },
      { passUpstream: [401, 403] },
    );
  }
};
