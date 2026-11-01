/**
 * Fusionar dos organizaciones del mismo espacio (84, ADR-171).
 *
 * GET  /api/organization-merges?workspace_id=&keep=&drop=: `preview_organization_merge`:
 *      las dos organizaciones y los recuentos de lo que quien llama puede
 *      leer (SECURITY INVOKER: la RLS cuenta, no esta ruta). Si chocan
 *      conversaciones del mismo proyecto, `clashes` dice cuáles (las que ve).
 * POST /api/organization-merges: { workspace_id, keep_organization_id,
 *      drop_organization_id }: `merge_workspace_organization`. Devuelve el
 *      id de la fusión y el slug de la que se queda.
 *
 * Solo el admin del espacio: las RPC lo exigen. 42501 es 404 (no existe o no
 * puedes, la misma respuesta); 22023 nombra por qué no (`$lib/organization-merge`).
 *
 * Auth: Bearer JWT.
 */

import type { RequestHandler } from './$types';
import * as v from 'valibot';
import { extractAccessToken } from '$lib/auth';
import { pgGet, pgPostRpc, type SupabaseEnv } from '$lib/supabase';
import { pgErrorResponse } from '$lib/server/errors';
import { json, jsonNoStore } from '$lib/server/http';
import { orgClashes, type ClashRow, type OrgMergePreview } from '$lib/organization-merge';
import { orgRefusalResponse } from '$lib/server/organization-merge';

const UUID = v.pipe(v.string(), v.uuid());

const PreviewQuery = v.object({ workspace_id: UUID, keep: UUID, drop: UUID });

const MergeBody = v.object({
  workspace_id: UUID,
  keep_organization_id: UUID,
  drop_organization_id: UUID,
});

const CODES = { '42501': { status: 404, error: 'not_found' } };

export const GET: RequestHandler = async ({ request, url, platform, locals }) => {
  if (!platform?.env) return jsonNoStore({ error: 'platform_unavailable' }, 500);
  const env = platform.env as unknown as SupabaseEnv;
  const jwt = extractAccessToken(request);
  if (!jwt) return jsonNoStore({ error: 'missing_authorization' }, 401);

  const q = v.safeParse(PreviewQuery, Object.fromEntries(url.searchParams.entries()));
  if (!q.success) return jsonNoStore({ error: 'invalid_query' }, 400);
  const { workspace_id, keep, drop } = q.output;

  try {
    const { data } = await pgPostRpc<Omit<OrgMergePreview, 'clashes'>>(env, 'preview_organization_merge', jwt, {
      p_workspace_id: workspace_id,
      p_keep_organization_id: keep,
      p_drop_organization_id: drop,
    });
    const preview = data[0];
    if (!preview) return jsonNoStore({ error: 'not_found' }, 404);

    // Las que chocan, para decirlas con su proyecto (solo si hay).
    let clashes: OrgMergePreview['clashes'] = [];
    if ((preview.conflicts?.conversations ?? 0) > 0) {
      const rows = await pgGet<ClashRow>(env, 'conversation', jwt, {
        search: new URLSearchParams({
          select: 'id,organization_id,project_id,private_to,project:project_id(name)',
          workspace_id: `eq.${workspace_id}`,
          organization_id: `in.(${keep},${drop})`,
          deleted_at: 'is.null',
          limit: '1000',
        }),
      });
      clashes = orgClashes(rows.data, keep, drop);
    }
    return jsonNoStore({ preview: { ...preview, clashes } });
  } catch (err) {
    return (
      orgRefusalResponse(err) ??
      pgErrorResponse(err, { route: 'GET /api/organization-merges', requestId: locals.requestId }, { codes: CODES })
    );
  }
};

export const POST: RequestHandler = async ({ request, platform, locals }) => {
  if (!platform?.env) return json({ error: 'platform_unavailable' }, 500);
  const env = platform.env as unknown as SupabaseEnv;
  const jwt = extractAccessToken(request);
  if (!jwt) return json({ error: 'missing_authorization' }, 401);

  const parsed = v.safeParse(MergeBody, await request.json().catch(() => null));
  if (!parsed.success) return json({ error: 'invalid_body' }, 400);
  const b = parsed.output;

  try {
    const { data } = await pgPostRpc<{
      merge_id: string;
      keep_organization_id: string;
      drop_organization_id: string;
    }>(env, 'merge_workspace_organization', jwt, {
      p_workspace_id: b.workspace_id,
      p_keep_organization_id: b.keep_organization_id,
      p_drop_organization_id: b.drop_organization_id,
    });
    const merge = data[0];
    if (!merge) return json({ error: 'merge_failed' }, 502);
    // La que se queda, para llevar allí a quien estaba en la otra.
    const keep = await pgGet<{ slug: string }>(env, 'workspace_organization', jwt, {
      search: new URLSearchParams({
        select: 'slug',
        id: `eq.${merge.keep_organization_id}`,
        deleted_at: 'is.null',
        limit: '1',
      }),
    });
    return json({ merge: { ...merge, keep_slug: keep.data[0]?.slug ?? null } });
  } catch (err) {
    return (
      orgRefusalResponse(err) ??
      pgErrorResponse(err, { route: 'POST /api/organization-merges', requestId: locals.requestId }, { codes: CODES })
    );
  }
};
