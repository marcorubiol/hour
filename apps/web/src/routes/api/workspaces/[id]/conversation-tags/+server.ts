/**
 * Las etiquetas de conversación de un espacio en Ajustes (ADR-138, fase 4).
 * La lectura es `GET /api/conversation-tags` (el vocabulario, una sola caché
 * para la lente, la ficha, «Añadir» y esta pantalla); aquí solo se escribe.
 *
 * POST  { label }                       → crea una propia; la clave sale del
 *       nombre (`tagKeyFromLabel`). `all` y `team` no (son chips), ni una clave
 *       que el espacio ya usa, estándar incluidas: 400 { error: reserved |
 *       taken | invalid }.
 * PATCH { tag_id, label?, active? }     → renombra (una estándar en el ajuste
 *       del espacio, null vuelve al nombre de Hour; una propia en su fila) y
 *       activa o desactiva (el ajuste; las asignaciones se conservan).
 * PUT   { order: uuid[] }               → el orden, de diez en diez en el ajuste.
 *
 * Lo decide un admin del espacio: la RLS lo exige (grants por columnas, sin
 * DELETE) y esto lo comprueba antes para no escribir a medias. La etiqueta
 * nunca decide permisos.
 */

import type { RequestHandler } from './$types';
import * as v from 'valibot';
import { extractAccessToken } from '$lib/auth';
import { pgGet, pgInsert, pgPatch, pgPostRpc, type SupabaseEnv } from '$lib/supabase';
import { pgErrorResponse, type PgErrorMapEntry } from '$lib/server/errors';
import { jsonNoStore, jwtSubject, UUID_RE } from '$lib/server/http';
import {
  TAG_LABEL_MAX,
  newTagProblem,
  nextSort,
  settingsTags,
  sortsOf,
  tagKeyFromLabel,
  type TagRow,
  type TagSettingRow,
  type TagVocabulary,
} from '$lib/conversation-tags';

const Label = v.pipe(v.string(), v.trim(), v.minLength(1), v.maxLength(TAG_LABEL_MAX));
const CreateSchema = v.object({ label: v.string() });
const PatchSchema = v.object({
  tag_id: v.pipe(v.string(), v.regex(UUID_RE)),
  label: v.optional(v.nullable(Label)),
  active: v.optional(v.boolean()),
});
const OrderSchema = v.object({ order: v.pipe(v.array(v.pipe(v.string(), v.regex(UUID_RE))), v.maxLength(200)) });

const CODES: Record<string, PgErrorMapEntry> = {
  '23505': { status: 409, error: 'taken' },
  '23514': { status: 400, error: 'invalid' },
  '42501': { status: 403, error: 'forbidden' },
};

type Ctx = { env: SupabaseEnv; jwt: string; ws: string };

async function begin(request: Request, params: { id: string }, platform: App.Platform | undefined) {
  if (!platform?.env) return { error: jsonNoStore({ error: 'platform_unavailable' }, 500) };
  const jwt = extractAccessToken(request);
  if (!jwt) return { error: jsonNoStore({ error: 'missing_authorization' }, 401) };
  if (!UUID_RE.test(params.id)) return { error: jsonNoStore({ error: 'invalid_id' }, 400) };
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return { error: jsonNoStore({ error: 'invalid_body' }, 400) };
  }
  return { ctx: { env: platform.env as unknown as SupabaseEnv, jwt, ws: params.id } as Ctx, raw };
}

async function isAdmin({ env, jwt, ws }: Ctx): Promise<boolean> {
  const r = await pgPostRpc<boolean>(env, 'is_workspace_admin', jwt, { ws_id: ws });
  return r.data[0] === true;
}

/** Lo que el espacio ve: las estándar, las suyas y sus ajustes. */
async function vocabulary({ env, jwt, ws }: Ctx): Promise<TagVocabulary> {
  const [tags, settings] = await Promise.all([
    pgGet<TagRow>(env, 'conversation_tag', jwt, {
      search: { select: 'id,workspace_id,key,label,labels,sort', or: `(workspace_id.is.null,workspace_id.eq.${ws})` },
    }),
    pgGet<TagSettingRow>(env, 'workspace_conversation_tag_setting', jwt, {
      search: { select: 'workspace_id,tag_id,label,labels,active,sort', workspace_id: `eq.${ws}` },
    }),
  ]);
  return { tags: tags.data, settings: settings.data };
}

/** El ajuste del espacio sobre una etiqueta: se cambia si existe, se crea si no. */
async function writeSetting(
  { env, jwt, ws }: Ctx,
  vocab: TagVocabulary,
  tagId: string,
  patch: { label?: string | null; active?: boolean; sort?: number },
): Promise<void> {
  if (vocab.settings.some((s) => s.tag_id === tagId)) {
    const r = await pgPatch(env, 'workspace_conversation_tag_setting', jwt, patch, {
      search: { workspace_id: `eq.${ws}`, tag_id: `eq.${tagId}`, select: 'tag_id' },
    });
    if (r.data.length === 0) throw new Forbidden();
  } else {
    await pgInsert(env, 'workspace_conversation_tag_setting', jwt, { workspace_id: ws, tag_id: tagId, ...patch }, {
      search: { select: 'tag_id' },
    });
  }
}

class Forbidden extends Error {}

function fail(err: unknown, route: string, requestId: string | null | undefined): Response {
  if (err instanceof Forbidden) return jsonNoStore({ error: 'forbidden' }, 403);
  return pgErrorResponse(err, { route, requestId }, { codes: CODES });
}

export const POST: RequestHandler = async ({ request, params, platform, locals }) => {
  const start = await begin(request, params, platform);
  if (start.error) return start.error;
  const { ctx, raw } = start;
  const parsed = v.safeParse(CreateSchema, raw);
  if (!parsed.success) return jsonNoStore({ error: 'invalid' }, 400);
  const label = parsed.output.label.trim();
  const sub = jwtSubject(ctx.jwt);
  if (!sub) return jsonNoStore({ error: 'missing_authorization' }, 401);
  try {
    if (!(await isAdmin(ctx))) return jsonNoStore({ error: 'forbidden' }, 403);
    const vocab = await vocabulary(ctx);
    const problem = newTagProblem(label, vocab.tags.map((x) => x.key));
    if (problem) return jsonNoStore({ error: problem }, 400);
    const { data } = await pgInsert<TagRow>(
      ctx.env,
      'conversation_tag',
      ctx.jwt,
      {
        workspace_id: ctx.ws,
        key: tagKeyFromLabel(label),
        label,
        created_by: sub,
        sort: nextSort(settingsTags(vocab, ctx.ws)),
      },
      { search: { select: 'id,workspace_id,key,label,labels,sort' } },
    );
    return jsonNoStore({ tag: data[0] }, 201);
  } catch (err) {
    return fail(err, 'POST /api/workspaces/[id]/conversation-tags', locals.requestId);
  }
};

export const PATCH: RequestHandler = async ({ request, params, platform, locals }) => {
  const start = await begin(request, params, platform);
  if (start.error) return start.error;
  const { ctx, raw } = start;
  const parsed = v.safeParse(PatchSchema, raw);
  if (!parsed.success) return jsonNoStore({ error: 'invalid' }, 400);
  const { tag_id, label, active } = parsed.output;
  try {
    if (!(await isAdmin(ctx))) return jsonNoStore({ error: 'forbidden' }, 403);
    const vocab = await vocabulary(ctx);
    const tag = vocab.tags.find((x) => x.id === tag_id);
    if (!tag) return jsonNoStore({ error: 'not_found' }, 404);
    const standard = tag.workspace_id === null;

    // Una estándar se renombra en el ajuste; una propia, en su fila, y siempre
    // tiene nombre: no hay «el de Hour» al que volver.
    const setting: { label?: string | null; active?: boolean } = {};
    if (active !== undefined) setting.active = active;
    if (label !== undefined && standard) setting.label = label;
    if (label !== undefined && !standard) {
      if (label === null) return jsonNoStore({ error: 'invalid' }, 400);
      const r = await pgPatch(ctx.env, 'conversation_tag', ctx.jwt, { label }, {
        search: { id: `eq.${tag_id}`, workspace_id: `eq.${ctx.ws}`, select: 'id' },
      });
      if (r.data.length === 0) throw new Forbidden();
    }
    if (Object.keys(setting).length > 0) await writeSetting(ctx, vocab, tag_id, setting);
    return jsonNoStore({ ok: true });
  } catch (err) {
    return fail(err, 'PATCH /api/workspaces/[id]/conversation-tags', locals.requestId);
  }
};

export const PUT: RequestHandler = async ({ request, params, platform, locals }) => {
  const start = await begin(request, params, platform);
  if (start.error) return start.error;
  const { ctx, raw } = start;
  const parsed = v.safeParse(OrderSchema, raw);
  if (!parsed.success) return jsonNoStore({ error: 'invalid' }, 400);
  const order = [...new Set(parsed.output.order)];
  try {
    if (!(await isAdmin(ctx))) return jsonNoStore({ error: 'forbidden' }, 403);
    const vocab = await vocabulary(ctx);
    const known = new Set(vocab.tags.map((x) => x.id));
    if (order.some((id) => !known.has(id))) return jsonNoStore({ error: 'not_found' }, 404);
    const current = new Map(settingsTags(vocab, ctx.ws).map((x) => [x.id, x.sort]));
    await Promise.all(
      sortsOf(order)
        .filter(({ id, sort }) => current.get(id) !== sort)
        .map(({ id, sort }) => writeSetting(ctx, vocab, id, { sort })),
    );
    return jsonNoStore({ ok: true });
  } catch (err) {
    return fail(err, 'PUT /api/workspaces/[id]/conversation-tags', locals.requestId);
  }
};
