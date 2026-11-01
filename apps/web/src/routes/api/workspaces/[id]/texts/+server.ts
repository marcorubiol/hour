/**
 * Textos guardados de un espacio (89, ADR-171; tabla `workspace_text`).
 *
 * GET                               → { items, can_edit }: los vivos (RLS: los
 *       miembros internos) y si quien llama puede escribirlos.
 * POST   { title, body }            → crea uno.
 * PATCH  { text_id, title, body }   → lo cambia.
 * DELETE ?text_id=                  → lo borra (blando) por `delete_workspace_text`:
 *       un UPDATE que lo esconde chocaría con la policy de lectura al
 *       devolverlo (la trampa de la representación de PostgREST).
 *
 * Escribe quien tiene `edit:conversation` en algún proyecto vivo del espacio:
 * la RLS lo exige; `can_edit` lo pregunta antes para no ofrecer lo que no
 * puede. 42501 es 403 (escribir) o 404 (borrar uno que no existe o no puedes).
 *
 * Auth: Bearer JWT.
 */

import type { RequestHandler } from './$types';
import * as v from 'valibot';
import { extractAccessToken } from '$lib/auth';
import { pgGet, pgInsert, pgPatch, pgPostRpc, type SupabaseEnv } from '$lib/supabase';
import { pgErrorResponse, type PgErrorMapEntry } from '$lib/server/errors';
import { jsonNoStore, UUID_RE } from '$lib/server/http';
import { TEXT_BODY_MAX, TEXT_TITLE_MAX, cleanText, type WorkspaceText } from '$lib/workspace-texts';

const SELECT = 'id,title,body,updated_at';

const TextSchema = v.object({
  title: v.pipe(v.string(), v.maxLength(TEXT_TITLE_MAX + 20)),
  body: v.pipe(v.string(), v.maxLength(TEXT_BODY_MAX + 200)),
});
const PatchSchema = v.object({ text_id: v.pipe(v.string(), v.regex(UUID_RE)), ...TextSchema.entries });

const CODES: Record<string, PgErrorMapEntry> = {
  '23514': { status: 400, error: 'invalid' },
  '42501': { status: 403, error: 'forbidden' },
};

function begin(request: Request, params: { id: string }, platform: App.Platform | undefined) {
  if (!platform?.env) return { error: jsonNoStore({ error: 'platform_unavailable' }, 500) };
  const jwt = extractAccessToken(request);
  if (!jwt) return { error: jsonNoStore({ error: 'missing_authorization' }, 401) };
  if (!UUID_RE.test(params.id)) return { error: jsonNoStore({ error: 'invalid_id' }, 400) };
  return { env: platform.env as unknown as SupabaseEnv, jwt, ws: params.id };
}

/** `edit:conversation` en algún proyecto vivo del espacio, como las policies. */
async function canEdit(env: SupabaseEnv, jwt: string, ws: string): Promise<boolean> {
  const projects = await pgGet<{ id: string }>(env, 'project', jwt, {
    search: { select: 'id', workspace_id: `eq.${ws}`, deleted_at: 'is.null', limit: '50' },
  });
  const checks = await Promise.all(
    projects.data.map((p) =>
      pgPostRpc<boolean>(env, 'has_permission', jwt, { p_project_id: p.id, p_perm: 'edit:conversation' })
        .then((r) => r.data[0] === true)
        .catch(() => false),
    ),
  );
  return checks.some(Boolean);
}

export const GET: RequestHandler = async ({ request, params, platform, locals }) => {
  const c = begin(request, params, platform);
  if ('error' in c) return c.error!;
  try {
    const [texts, edit] = await Promise.all([
      pgGet<WorkspaceText>(c.env, 'workspace_text', c.jwt, {
        search: { select: SELECT, workspace_id: `eq.${c.ws}`, deleted_at: 'is.null', order: 'title.asc', limit: '200' },
      }),
      canEdit(c.env, c.jwt, c.ws),
    ]);
    return jsonNoStore({ items: texts.data, can_edit: edit });
  } catch (err) {
    return pgErrorResponse(err, { route: 'GET /api/workspaces/[id]/texts', requestId: locals.requestId }, { codes: CODES });
  }
};

export const POST: RequestHandler = async ({ request, params, platform, locals }) => {
  const c = begin(request, params, platform);
  if ('error' in c) return c.error!;
  const parsed = v.safeParse(TextSchema, await request.json().catch(() => null));
  const clean = parsed.success ? cleanText(parsed.output.title, parsed.output.body) : null;
  if (!clean) return jsonNoStore({ error: 'invalid' }, 400);
  try {
    const { data } = await pgInsert<WorkspaceText>(
      c.env,
      'workspace_text',
      c.jwt,
      { workspace_id: c.ws, ...clean },
      { search: { select: SELECT } },
    );
    return jsonNoStore({ text: data[0] }, 201);
  } catch (err) {
    return pgErrorResponse(err, { route: 'POST /api/workspaces/[id]/texts', requestId: locals.requestId }, { codes: CODES });
  }
};

export const PATCH: RequestHandler = async ({ request, params, platform, locals }) => {
  const c = begin(request, params, platform);
  if ('error' in c) return c.error!;
  const parsed = v.safeParse(PatchSchema, await request.json().catch(() => null));
  const clean = parsed.success ? cleanText(parsed.output.title, parsed.output.body) : null;
  if (!parsed.success || !clean) return jsonNoStore({ error: 'invalid' }, 400);
  try {
    const { data } = await pgPatch<WorkspaceText>(c.env, 'workspace_text', c.jwt, clean, {
      search: { id: `eq.${parsed.output.text_id}`, workspace_id: `eq.${c.ws}`, select: SELECT },
    });
    // No row back: gone, or not yours to write (RLS filters the UPDATE).
    if (data.length === 0) return jsonNoStore({ error: 'not_found' }, 404);
    return jsonNoStore({ text: data[0] });
  } catch (err) {
    return pgErrorResponse(err, { route: 'PATCH /api/workspaces/[id]/texts', requestId: locals.requestId }, { codes: CODES });
  }
};

export const DELETE: RequestHandler = async ({ request, params, url, platform, locals }) => {
  const c = begin(request, params, platform);
  if ('error' in c) return c.error!;
  const id = url.searchParams.get('text_id') ?? '';
  if (!UUID_RE.test(id)) return jsonNoStore({ error: 'invalid_id' }, 400);
  try {
    await pgPostRpc(c.env, 'delete_workspace_text', c.jwt, { p_text_id: id });
    return new Response(null, { status: 204 });
  } catch (err) {
    return pgErrorResponse(
      err,
      { route: 'DELETE /api/workspaces/[id]/texts', requestId: locals.requestId },
      { codes: { '42501': { status: 404, error: 'not_found' } } },
    );
  }
};
