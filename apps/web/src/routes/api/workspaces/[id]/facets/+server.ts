/**
 * Las facetas de un espacio en Ajustes (comms carril 2, fase 4; plan
 * `2026-10-22-comms-threads-facets.md` § 3.5). Calco del endpoint de
 * etiquetas (ADR-138 fase 4): lectura y escritura directas, con la RLS y los
 * grants por columnas que ya dio `20261011100000_permissions_facets_expand`.
 * Sin migración.
 *
 * GET                                   → el vocabulario (estándar y propias,
 *       con sus niveles y el ajuste del espacio), los paquetes de Hour y, para
 *       un admin, las membresías bajo el espacio con sus facetas.
 * POST  { label, levels }               → crea una propia; la clave sale del
 *       nombre. Una clave que el espacio ya usa, estándar incluidas: 400
 *       { error: taken | invalid }. Los niveles, después: si fallan, la faceta
 *       queda sin nivel (no se puede dar) y se marcan otra vez en su fila.
 * PATCH { facet_id, label?, active?, levels? } → renombra (una estándar en el
 *       ajuste del espacio, null vuelve al nombre de Hour; una propia en su
 *       fila), apaga o enciende (el ajuste) y, solo una propia, sus niveles.
 * PUT   { order: uuid[] }               → el orden, de diez en diez en el ajuste.
 *
 * Lo decide un admin del espacio: la RLS lo exige y esto lo comprueba antes
 * para no escribir a medias. Apagar quita el hilo y la palabra; no cambia
 * quién lee los datos (la RLS de los datos no mira el ajuste).
 */

import type { RequestHandler } from './$types';
import * as v from 'valibot';
import { extractAccessToken } from '$lib/auth';
import { pgDelete, pgGet, pgInsert, pgPatch, pgPostRpc, type SupabaseEnv } from '$lib/supabase';
import { pgErrorResponse, type PgErrorMapEntry } from '$lib/server/errors';
import { jsonNoStore, jwtSubject, UUID_RE } from '$lib/server/http';
import { tagKeyFromLabel, nextSort, sortsOf } from '$lib/conversation-tags';
import {
  FACET_LABEL_MAX,
  OWN_LEVELS,
  levelDiff,
  newFacetProblem,
  ownLevels,
  settingsFacets,
  type ContainerLevel,
  type FacetRow,
  type FacetSettingRow,
  type GrantRow,
  type PresetFacetRow,
  type PresetRow,
} from '$lib/workspace-facets';

const Label = v.pipe(v.string(), v.trim(), v.minLength(1), v.maxLength(FACET_LABEL_MAX));
const Levels = v.pipe(v.array(v.picklist(OWN_LEVELS as ContainerLevel[])), v.maxLength(OWN_LEVELS.length));
const CreateSchema = v.object({ label: v.string(), levels: v.optional(Levels, []) });
const PatchSchema = v.object({
  facet_id: v.pipe(v.string(), v.regex(UUID_RE)),
  label: v.optional(v.nullable(Label)),
  active: v.optional(v.boolean()),
  levels: v.optional(Levels),
});
const OrderSchema = v.object({ order: v.pipe(v.array(v.pipe(v.string(), v.regex(UUID_RE))), v.maxLength(200)) });

const CODES: Record<string, PgErrorMapEntry> = {
  '23505': { status: 409, error: 'taken' },
  '23514': { status: 400, error: 'invalid' },
  '42501': { status: 403, error: 'forbidden' },
};

const FACET_SELECT = 'id,workspace_id,key,label,labels,sort,levels:facet_level(level)';

type Ctx = { env: SupabaseEnv; jwt: string; ws: string };

type Opened = { error: Response; ctx?: undefined } | { error?: undefined; ctx: Ctx };
type Begun = { error: Response; ctx?: undefined; raw?: undefined } | { error?: undefined; ctx: Ctx; raw: unknown };

function open(request: Request, params: { id: string }, platform: App.Platform | undefined): Opened {
  if (!platform?.env) return { error: jsonNoStore({ error: 'platform_unavailable' }, 500) };
  const jwt = extractAccessToken(request);
  if (!jwt) return { error: jsonNoStore({ error: 'missing_authorization' }, 401) };
  if (!UUID_RE.test(params.id)) return { error: jsonNoStore({ error: 'invalid_id' }, 400) };
  return { ctx: { env: platform.env as unknown as SupabaseEnv, jwt, ws: params.id } };
}

async function begin(request: Request, params: { id: string }, platform: App.Platform | undefined): Promise<Begun> {
  const start = open(request, params, platform);
  if (start.error) return { error: start.error };
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return { error: jsonNoStore({ error: 'invalid_body' }, 400) };
  }
  return { ctx: start.ctx, raw };
}

async function isAdmin({ env, jwt, ws }: Ctx): Promise<boolean> {
  const r = await pgPostRpc<boolean>(env, 'is_workspace_admin', jwt, { ws_id: ws });
  return r.data[0] === true;
}

async function vocabulary({ env, jwt, ws }: Ctx): Promise<{ facets: FacetRow[]; settings: FacetSettingRow[] }> {
  const [facets, settings] = await Promise.all([
    pgGet<FacetRow>(env, 'facet', jwt, {
      search: { select: FACET_SELECT, or: `(workspace_id.is.null,workspace_id.eq.${ws})` },
    }),
    pgGet<FacetSettingRow>(env, 'workspace_facet_setting', jwt, {
      search: { select: 'workspace_id,facet_id,label,labels,active,sort', workspace_id: `eq.${ws}` },
    }),
  ]);
  return { facets: facets.data, settings: settings.data };
}

type MembershipRow = {
  id: string;
  level: ContainerLevel;
  user_id: string;
  preset: string | null;
  project_id: string | null;
  line_id: string | null;
  bolo_id: string | null;
  performance_id: string | null;
  facets: GrantRow['facets'];
};

const inList = (ids: Iterable<string>) => `in.(${[...new Set(ids)].join(',')})`;

/** Las membresías bajo el espacio, con el nombre de la persona y del contenedor. Solo un admin las lee todas. */
async function grants({ env, jwt, ws }: Ctx): Promise<GrantRow[]> {
  const [members, access] = await Promise.all([
    pgGet<MembershipRow>(env, 'membership', jwt, {
      search: {
        select: 'id,level,user_id,preset,project_id,line_id,bolo_id,performance_id,facets:membership_facet(facet_id,verb,source)',
        workspace_id: `eq.${ws}`,
        level: 'neq.workspace',
      },
    }),
    pgPostRpc<{ access_kind: string; user_id: string | null; display_name: string }>(env, 'list_workspace_access', jwt, {
      p_workspace_id: ws,
    }),
  ]);
  const rows = members.data;
  const names = new Map(
    access.data.filter((a) => a.access_kind === 'member' && a.user_id).map((a) => [a.user_id!, a.display_name]),
  );
  const ids = (k: 'project_id' | 'line_id' | 'bolo_id' | 'performance_id') =>
    rows.map((r) => r[k]).filter((x): x is string => Boolean(x));
  const read = async <T extends { id: string }>(table: string, select: string, list: string[]) =>
    list.length === 0 ? [] : (await pgGet<T>(env, table, jwt, { search: { select, id: inList(list) } })).data;
  const [projects, lines, bolos, perfs] = await Promise.all([
    read<{ id: string; name: string }>('project', 'id,name', ids('project_id')),
    read<{ id: string; name: string }>('line', 'id,name', ids('line_id')),
    read<{ id: string; venue_name: string | null; city: string | null }>('bolo', 'id,venue_name,city', ids('bolo_id')),
    read<{ id: string; venue_name: string | null; performed_at: string | null }>(
      'performance',
      'id,venue_name,performed_at',
      ids('performance_id'),
    ),
  ]);
  const label = new Map<string, string>();
  for (const p of projects) label.set(p.id, p.name);
  for (const l of lines) label.set(l.id, l.name);
  for (const b of bolos) label.set(b.id, [b.venue_name, b.city].filter(Boolean).join(', '));
  for (const f of perfs) label.set(f.id, [f.venue_name, f.performed_at?.slice(0, 10)].filter(Boolean).join(' · '));
  return rows.map((r) => {
    // A membership's container is the one its level names.
    const own = { project: r.project_id, line: r.line_id, bolo: r.bolo_id, performance: r.performance_id, workspace: null }[
      r.level
    ];
    return {
      id: r.id,
      level: r.level,
      user_id: r.user_id,
      preset: r.preset,
      name: names.get(r.user_id) ?? null,
      container: (own && label.get(own)) || null,
      facets: r.facets ?? [],
    };
  });
}

class Forbidden extends Error {}

function fail(err: unknown, route: string, requestId: string | null | undefined): Response {
  if (err instanceof Forbidden) return jsonNoStore({ error: 'forbidden' }, 403);
  return pgErrorResponse(err, { route, requestId }, { codes: CODES });
}

async function writeSetting(
  { env, jwt, ws }: Ctx,
  settings: readonly FacetSettingRow[],
  facetId: string,
  patch: { label?: string | null; active?: boolean; sort?: number },
): Promise<void> {
  if (settings.some((s) => s.facet_id === facetId)) {
    const r = await pgPatch(env, 'workspace_facet_setting', jwt, patch, {
      search: { workspace_id: `eq.${ws}`, facet_id: `eq.${facetId}`, select: 'facet_id' },
    });
    if (r.data.length === 0) throw new Forbidden();
  } else {
    await pgInsert(env, 'workspace_facet_setting', jwt, { workspace_id: ws, facet_id: facetId, ...patch }, {
      search: { select: 'facet_id' },
    });
  }
}

async function writeLevels({ env, jwt }: Ctx, facetId: string, from: ContainerLevel[], to: ContainerLevel[]) {
  const { add, remove } = levelDiff(from, to);
  for (const level of add) {
    await pgInsert(env, 'facet_level', jwt, { facet_id: facetId, level }, { search: { select: 'facet_id' } });
  }
  for (const level of remove) {
    const r = await pgDelete(env, 'facet_level', jwt, {
      search: { facet_id: `eq.${facetId}`, level: `eq.${level}`, select: 'facet_id' },
    });
    if (r.data.length === 0) throw new Forbidden();
  }
}

export const GET: RequestHandler = async ({ request, params, platform, locals }) => {
  const start = open(request, params, platform);
  if (start.error) return start.error;
  const { ctx } = start;
  try {
    const [admin, vocab, presets, presetFacets] = await Promise.all([
      isAdmin(ctx),
      vocabulary(ctx),
      pgGet<PresetRow>(ctx.env, 'access_preset', ctx.jwt, { search: { select: 'key,sort,container_verb,can_edit_meta' } }),
      pgGet<PresetFacetRow>(ctx.env, 'access_preset_facet', ctx.jwt, { search: { select: 'preset_key,facet_key,verb' } }),
    ]);
    return jsonNoStore({
      can_edit: admin,
      facets: vocab.facets,
      settings: vocab.settings,
      presets: presets.data,
      preset_facets: presetFacets.data,
      grants: admin ? await grants(ctx) : [],
    });
  } catch (err) {
    return fail(err, 'GET /api/workspaces/[id]/facets', locals.requestId);
  }
};

export const POST: RequestHandler = async ({ request, params, platform, locals }) => {
  const start = await begin(request, params, platform);
  if (start.error) return start.error;
  const { ctx, raw } = start;
  const parsed = v.safeParse(CreateSchema, raw);
  if (!parsed.success) return jsonNoStore({ error: 'invalid' }, 400);
  const label = parsed.output.label.trim();
  const levels = ownLevels(parsed.output.levels);
  const sub = jwtSubject(ctx.jwt);
  if (!sub) return jsonNoStore({ error: 'missing_authorization' }, 401);
  try {
    if (!(await isAdmin(ctx))) return jsonNoStore({ error: 'forbidden' }, 403);
    const vocab = await vocabulary(ctx);
    const problem = newFacetProblem(label, vocab.facets.map((f) => f.key));
    if (problem) return jsonNoStore({ error: problem }, 400);
    const { data } = await pgInsert<FacetRow>(
      ctx.env,
      'facet',
      ctx.jwt,
      {
        workspace_id: ctx.ws,
        key: tagKeyFromLabel(label),
        label,
        created_by: sub,
        sort: nextSort(settingsFacets(vocab.facets, vocab.settings, ctx.ws)),
      },
      { search: { select: 'id,workspace_id,key,label,labels,sort' } },
    );
    const facet = data[0];
    if (!facet) return jsonNoStore({ error: 'forbidden' }, 403);
    await writeLevels(ctx, facet.id, [], levels);
    return jsonNoStore({ facet: { ...facet, levels: levels.map((level) => ({ level })) } }, 201);
  } catch (err) {
    return fail(err, 'POST /api/workspaces/[id]/facets', locals.requestId);
  }
};

export const PATCH: RequestHandler = async ({ request, params, platform, locals }) => {
  const start = await begin(request, params, platform);
  if (start.error) return start.error;
  const { ctx, raw } = start;
  const parsed = v.safeParse(PatchSchema, raw);
  if (!parsed.success) return jsonNoStore({ error: 'invalid' }, 400);
  const { facet_id, label, active, levels } = parsed.output;
  try {
    if (!(await isAdmin(ctx))) return jsonNoStore({ error: 'forbidden' }, 403);
    const vocab = await vocabulary(ctx);
    const facet = settingsFacets(vocab.facets, vocab.settings, ctx.ws).find((f) => f.id === facet_id);
    if (!facet) return jsonNoStore({ error: 'not_found' }, 404);

    // Where a standard facet exists is Hour's table (structure-model § Facet).
    if (levels !== undefined && facet.standard) return jsonNoStore({ error: 'invalid' }, 400);
    // A standard facet is renamed in the setting; an own one in its row, and it
    // always has a name: there is no Hour's to go back to.
    if (label !== undefined && !facet.standard) {
      if (label === null) return jsonNoStore({ error: 'invalid' }, 400);
      const r = await pgPatch(ctx.env, 'facet', ctx.jwt, { label }, {
        search: { id: `eq.${facet_id}`, workspace_id: `eq.${ctx.ws}`, select: 'id' },
      });
      if (r.data.length === 0) throw new Forbidden();
    }
    const setting: { label?: string | null; active?: boolean } = {};
    if (active !== undefined) setting.active = active;
    if (label !== undefined && facet.standard) setting.label = label;
    if (Object.keys(setting).length > 0) await writeSetting(ctx, vocab.settings, facet_id, setting);
    if (levels !== undefined) await writeLevels(ctx, facet_id, ownLevels(facet.levels), ownLevels(levels));
    return jsonNoStore({ ok: true });
  } catch (err) {
    return fail(err, 'PATCH /api/workspaces/[id]/facets', locals.requestId);
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
    const current = new Map(settingsFacets(vocab.facets, vocab.settings, ctx.ws).map((f) => [f.id, f.sort]));
    if (order.some((id) => !current.has(id))) return jsonNoStore({ error: 'not_found' }, 404);
    await Promise.all(
      sortsOf(order)
        .filter(({ id, sort }) => current.get(id) !== sort)
        .map(({ id, sort }) => writeSetting(ctx, vocab.settings, id, { sort })),
    );
    return jsonNoStore({ ok: true });
  } catch (err) {
    return fail(err, 'PUT /api/workspaces/[id]/facets', locals.requestId);
  }
};
