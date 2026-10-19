/**
 * GET /api/organizations?workspace_ids=a,b — las organizaciones vivas de esos
 * espacios (o de todos los del usuario), para autocompletar el alta de una
 * conversación (ADR-102). RLS decide: solo miembros internos del espacio.
 */

import type { RequestHandler } from './$types';
import { extractAccessToken } from '$lib/auth';
import { pgGet, type SupabaseEnv } from '$lib/supabase';
import { pgErrorResponse } from '$lib/server/errors';
import { jsonNoStore, UUID_RE } from '$lib/server/http';

export interface OrganizationOption {
  id: string;
  workspace_id: string;
  name: string;
}

export const GET: RequestHandler = async ({ request, url, platform, locals }) => {
  if (!platform?.env) return jsonNoStore({ error: 'platform_unavailable' }, 500);
  const env = platform.env as unknown as SupabaseEnv;
  const jwt = extractAccessToken(request);
  if (!jwt) return jsonNoStore({ error: 'missing_authorization' }, 401);

  const ids = [
    ...new Set(
      (url.searchParams.get('workspace_ids') ?? '')
        .split(',')
        .map((x) => x.trim())
        .filter((x) => UUID_RE.test(x)),
    ),
  ];
  const search = new URLSearchParams({
    select: 'id,workspace_id,name',
    deleted_at: 'is.null',
    order: 'name.asc',
    limit: '1000',
  });
  if (ids.length) search.set('workspace_id', `in.(${ids.join(',')})`);
  try {
    const { data } = await pgGet<OrganizationOption>(env, 'workspace_organization', jwt, { search });
    return jsonNoStore({ items: data });
  } catch (err) {
    return pgErrorResponse(err, { route: 'GET /api/organizations', requestId: locals.requestId });
  }
};
