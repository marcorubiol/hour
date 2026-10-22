/**
 * Fusionar dos fichas de persona del mismo espacio (plan 2026-10-22, fase 2).
 *
 * GET  /api/person-merges?workspace_id=&keep=&drop= — `preview_person_merge`:
 *      los dos dossiers y los recuentos de lo que quien llama puede leer
 *      (SECURITY INVOKER: la RLS cuenta, no esta ruta). Puede volver con
 *      keep y drop intercambiados (`swapped`): la cuenta siempre se queda.
 * POST /api/person-merges — { workspace_id, keep_person_id, drop_person_id,
 *      fields?, invitation_id? } — `merge_workspace_person`. Devuelve el id de
 *      la fusión y el slug de la ficha que se queda.
 *
 * Solo el admin del espacio: las RPC lo exigen. 42501 es 404 (no existe o no
 * puedes, la misma respuesta); 22023 nombra por qué no (`$lib/person-merge`).
 *
 * Auth: Bearer JWT.
 */

import type { RequestHandler } from './$types';
import * as v from 'valibot';
import { extractAccessToken } from '$lib/auth';
import { pgGet, pgPostRpc, type SupabaseEnv } from '$lib/supabase';
import { pgErrorResponse } from '$lib/server/errors';
import { json, jsonNoStore } from '$lib/server/http';
import type { MergePreview } from '$lib/person-merge';
import { refusalResponse } from '$lib/server/person-merge';

const UUID = v.pipe(v.string(), v.uuid());

const PreviewQuery = v.object({ workspace_id: UUID, keep: UUID, drop: UUID });

const MergeBody = v.object({
  workspace_id: UUID,
  keep_person_id: UUID,
  drop_person_id: UUID,
  fields: v.optional(
    v.object({ full_name: v.optional(UUID), email: v.optional(UUID), phone: v.optional(UUID) }),
    {},
  ),
  invitation_id: v.nullish(UUID),
});

const CODES = { '42501': { status: 404, error: 'not_found' } };

export const GET: RequestHandler = async ({ request, url, platform, locals }) => {
  if (!platform?.env) return jsonNoStore({ error: 'platform_unavailable' }, 500);
  const env = platform.env as unknown as SupabaseEnv;
  const jwt = extractAccessToken(request);
  if (!jwt) return jsonNoStore({ error: 'missing_authorization' }, 401);

  const q = v.safeParse(PreviewQuery, Object.fromEntries(url.searchParams.entries()));
  if (!q.success) return jsonNoStore({ error: 'invalid_query' }, 400);

  try {
    const { data } = await pgPostRpc<MergePreview>(env, 'preview_person_merge', jwt, {
      p_workspace_id: q.output.workspace_id,
      p_keep_person_id: q.output.keep,
      p_drop_person_id: q.output.drop,
    });
    if (!data[0]) return jsonNoStore({ error: 'not_found' }, 404);
    return jsonNoStore({ preview: data[0] });
  } catch (err) {
    return (
      refusalResponse(err) ??
      pgErrorResponse(err, { route: 'GET /api/person-merges', requestId: locals.requestId }, { codes: CODES })
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
      keep_person_id: string;
      drop_person_id: string;
      swapped: boolean;
    }>(env, 'merge_workspace_person', jwt, {
      p_workspace_id: b.workspace_id,
      p_keep_person_id: b.keep_person_id,
      p_drop_person_id: b.drop_person_id,
      p_fields: b.fields,
      p_invitation_id: b.invitation_id ?? null,
    });
    const merge = data[0];
    if (!merge) return json({ error: 'merge_failed' }, 502);
    // La ficha que se queda, para llevar allí a quien estaba en la otra.
    const keep = await pgGet<{ slug: string }>(env, 'workspace_person', jwt, {
      search: new URLSearchParams({
        select: 'slug',
        workspace_id: `eq.${b.workspace_id}`,
        person_id: `eq.${merge.keep_person_id}`,
        deleted_at: 'is.null',
        limit: '1',
      }),
    });
    return json({ merge: { ...merge, keep_slug: keep.data[0]?.slug ?? null } });
  } catch (err) {
    return (
      refusalResponse(err) ??
      pgErrorResponse(err, { route: 'POST /api/person-merges', requestId: locals.requestId }, { codes: CODES })
    );
  }
};
