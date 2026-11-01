/**
 * El logo de la compañía (ADR-172): la cabecera de la plantilla de los
 * correos de difusión. Vive en `workspace.logo_url` como ruta de Hour
 * (`/m/ws/<espacio>/logo/…`, R2).
 *
 * GET → { logo_url, name, can_edit }
 * POST (cuerpo: la imagen, PNG o JPEG, ya reducida por la pantalla) → la
 *     guarda en R2 y la pone como logo → { logo_url }. Solo owner/admin.
 * DELETE → quita el logo (el fichero se queda: su ruta es su contenido).
 */

import type { RequestHandler } from './$types';
import { extractAccessToken } from '$lib/auth';
import { pgGet, pgPostRpc, type SupabaseEnv } from '$lib/supabase';
import { pgErrorResponse } from '$lib/server/errors';
import { jsonNoStore, UUID_RE } from '$lib/server/http';
import { putPublicImage, readUpload, rejectImage } from '$lib/server/media';

type Ctx = Parameters<RequestHandler>[0];

async function guard(event: Ctx): Promise<{ env: SupabaseEnv; jwt: string; id: string } | Response> {
  const { request, params, platform } = event;
  if (!platform?.env) return jsonNoStore({ error: 'platform_unavailable' }, 500);
  const jwt = extractAccessToken(request);
  if (!jwt) return jsonNoStore({ error: 'missing_authorization' }, 401);
  if (!UUID_RE.test(params.id)) return jsonNoStore({ error: 'invalid_id' }, 400);
  return { env: platform.env as unknown as SupabaseEnv, jwt, id: params.id.toLowerCase() };
}

async function isAdmin(env: SupabaseEnv, jwt: string, id: string): Promise<boolean> {
  return (await pgPostRpc<boolean>(env, 'is_workspace_admin', jwt, { ws_id: id })).data[0] === true;
}

async function setLogo(env: SupabaseEnv, jwt: string, id: string, url: string | null): Promise<string | null> {
  const { data } = await pgPostRpc<{ logo_url: string | null }>(env, 'update_workspace', jwt, {
    p_workspace_id: id,
    p_patch: { logo_url: url },
  });
  return data[0]?.logo_url ?? null;
}

export const GET: RequestHandler = async (event) => {
  const g = await guard(event);
  if (g instanceof Response) return g;
  try {
    const [ws, admin] = await Promise.all([
      pgGet<{ logo_url: string | null; name: string }>(g.env, 'workspace', g.jwt, {
        search: { select: 'logo_url,name', id: `eq.${g.id}` },
      }),
      isAdmin(g.env, g.jwt, g.id),
    ]);
    const row = ws.data[0];
    if (!row) return jsonNoStore({ error: 'not_found' }, 404);
    return jsonNoStore({ logo_url: row.logo_url, name: row.name, can_edit: admin });
  } catch (err) {
    return pgErrorResponse(err, { route: 'GET /api/workspaces/[id]/logo', requestId: event.locals.requestId });
  }
};

export const POST: RequestHandler = async (event) => {
  const g = await guard(event);
  if (g instanceof Response) return g;
  const bucket = event.platform?.env?.MEDIA;
  if (!bucket) return jsonNoStore({ error: 'platform_unavailable' }, 500);
  try {
    // Antes de escribir en R2: solo quien puede cambiar el logo sube uno.
    if (!(await isAdmin(g.env, g.jwt, g.id))) return jsonNoStore({ error: 'forbidden' }, 403);
    const bytes = await readUpload(event.request, 'logo');
    if (bytes === 'too_large') return jsonNoStore({ error: 'too_large' }, 413);
    const why = rejectImage(bytes, 'logo');
    if (why) return jsonNoStore({ error: why }, why === 'too_large' ? 413 : 415);
    const path = await putPublicImage(bucket, g.id, 'logo', bytes);
    return jsonNoStore({ logo_url: await setLogo(g.env, g.jwt, g.id, path) });
  } catch (err) {
    return pgErrorResponse(
      err,
      { route: 'POST /api/workspaces/[id]/logo', requestId: event.locals.requestId },
      { codes: { '42501': { status: 403, error: 'forbidden' } } },
    );
  }
};

export const DELETE: RequestHandler = async (event) => {
  const g = await guard(event);
  if (g instanceof Response) return g;
  try {
    await setLogo(g.env, g.jwt, g.id, null);
    return jsonNoStore({ logo_url: null });
  } catch (err) {
    return pgErrorResponse(
      err,
      { route: 'DELETE /api/workspaces/[id]/logo', requestId: event.locals.requestId },
      { codes: { '42501': { status: 403, error: 'forbidden' } } },
    );
  }
};
