/**
 * GET /api/conversations
 *
 * Lists conversations, with the linked person and project embedded. RLS
 * decides visibility.
 *
 * Each row carries `last_turn` (its last directional email, message or call),
 * so the list can say whose turn it is (ADR-117), and, for the page only, its
 * bolos without money (`conversations_bolos`, ADR-138 § 3) and the last
 * mailout it received (plan de la lista § 3).
 *
 * Two paths:
 *   · plain (a project or line module: `line_id`, `season`, or nothing that
 *     derives): PostgREST, ordered by next step, as before;
 *   · the lens (`orden`, `etiqueta` or any derived filter: `turno`, `temp`,
 *     `temporada`, `relacion`, `linea`, `envio`+`r`): one source,
 *     `conversation_feed` in list mode (plan de la lista, fase 3), filters with
 *     the rules of `$lib/conversation-overview` written in SQL, orders by
 *     `orden` (the block filters te toca and temperatura keep their block's
 *     order, ADR-118 § 7), counts and cuts the page; only the page is read in
 *     full. The Worker's derived read (`loadOverviewRows`) is the panel's.
 *
 * Auth: Bearer JWT required. RLS denies anon.
 */

import type { RequestHandler } from './$types';
import * as v from 'valibot';
import { extractAccessToken } from '$lib/auth';
import {
  CONVERSATION_SELECT,
  CONVERSATION_STATUSES,
  ConversationCreateSchema,
  conversationCreateProblem,
  existingConversationId,
  normalizeConversationItem,
  type ConversationDbItem,
  type ConversationItem,
} from '$lib/conversation';
import { PostgrestError, pgGet, pgPostRpc, type SupabaseEnv } from '$lib/supabase';
import { pgErrorResponse } from '$lib/server/errors';
import { TURN_EMBEDS, setLastTurnEmbed, setScope } from '$lib/server/conversation-overview';
import { loadListPage, loadRowExtras } from '$lib/server/conversation-list';
import { MAILOUT_PICKS, hasListFilter, parseLinea, type ListFilter } from '$lib/conversation-overview';
import { ORDERS, type Orden } from '$lib/conversation-order';
import { RELATIONS } from '$lib/conversation-relation';
import { json } from '$lib/server/http';
import { TAG_KEY_RE } from '$lib/conversation-tags';
import { MATCHING_MAX } from '$lib/conversation-bulk';

const QuerySchema = v.object({
  status: v.optional(
    v.union([v.literal('any'), v.picklist(CONVERSATION_STATUSES)]),
    'contacted',
  ),
  project_ids: v.optional(v.string()),
  workspace_ids: v.optional(v.string()),
  line_id: v.optional(v.pipe(v.string(), v.uuid())),
  q: v.optional(v.pipe(v.string(), v.trim(), v.maxLength(120))),
  season: v.optional(v.string(), 'any'),
  turno: v.optional(v.picklist(['nuestro', 'suyo'])),
  temp: v.optional(v.picklist(['caliente', 'fria', 'ronda', 'parada', 'sin-fecha'])),
  temporada: v.optional(v.literal('actual')),
  // ADR-135: one line (its id, or `sin` for the ones without); with
  // `temporada`, one line of the season. Alone since the list's filter row.
  linea: v.optional(v.string()),
  // ADR-126 § 9 and the list's Envío filter: the recipients of a mailout.
  envio: v.optional(v.pipe(v.string(), v.uuid())),
  r: v.optional(v.picklist(MAILOUT_PICKS)),
  // ADR-138: one derived relation.
  relacion: v.optional(v.picklist(RELATIONS)),
  // ADR-138 fase 2: el chip de la lente, la clave de una etiqueta (sin ninguna se lee `sales`).
  etiqueta: v.optional(v.pipe(v.string(), v.regex(TAG_KEY_RE))),
  // Plan de la lista § 4: the lens's order.
  orden: v.optional(v.picklist(ORDERS)),
  line_ids: v.optional(v.string()),
  // «Seleccionar las N que coinciden» (plan de la lista § 6.2): the ids of the
  // whole filter, in its order, without reading the rows (at most MATCHING_MAX).
  ids_only: v.optional(v.literal('1')),
  limit: v.optional(
    v.pipe(
      v.string(),
      v.transform((n) => Number(n)),
      v.number(),
      v.integer(),
      v.minValue(1),
      v.maxValue(100),
    ),
    '50',
  ),
  offset: v.optional(
    v.pipe(
      v.string(),
      v.transform((n) => Number(n)),
      v.number(),
      v.integer(),
      v.minValue(0),
    ),
    '0',
  ),
});

export const GET: RequestHandler = async ({ request, url, platform, locals }) => {
  if (!platform?.env) {
    return json({ error: 'platform_unavailable' }, 500);
  }
  const env = platform.env as unknown as SupabaseEnv;

  const jwt = extractAccessToken(request);
  if (!jwt) {
    return json(
      {
        error: 'missing_authorization',
        hint: 'Send Authorization: Bearer <supabase_jwt>.',
      },
      401,
    );
  }

  const rawParams = Object.fromEntries(url.searchParams.entries());
  const parsed = v.safeParse(QuerySchema, rawParams);
  if (!parsed.success) {
    return json(
      {
        error: 'invalid_query',
        issues: parsed.issues.map((i) => ({
          path: i.path?.map((p) => p.key).join('.'),
          message: i.message,
        })),
      },
      400,
    );
  }
  const { status, project_ids, workspace_ids, line_id, q, season, limit, offset, turno, temp, temporada, linea, line_ids, envio, r, relacion, etiqueta, orden, ids_only } =
    parsed.output;
  const idsOnly = ids_only === '1';

  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const parseIds = (raw?: string) =>
    raw
      ? [...new Set(raw.split(',').map((x) => x.trim()).filter((x) => UUID.test(x)))]
      : [];
  const projectIds = parseIds(project_ids);
  const workspaceIds = parseIds(workspace_ids);

  const search = new URLSearchParams();
  // A project is filtered by id (`project_ids`), never by slug: a slug only
  // names a project inside its workspace (ADR-024). The free-text search
  // runs over the organization and every contact (ADR-102) through the
  // `conversation_search` RPC, which returns conversation rows: the same
  // embeds, filters and order apply.
  search.set('select', `${CONVERSATION_SELECT},${TURN_EMBEDS}`);
  const qTrim = q?.trim() ?? '';
  if (qTrim) search.set('p_q', qTrim);

  setScope(search, projectIds, workspaceIds);
  if (line_id) search.set('line_id', `eq.${line_id}`);
  search.set('deleted_at', 'is.null');

  if (status !== 'any') search.set('status', `eq.${status}`);
  if (season !== 'any') search.set('custom_fields->>season', `eq.${season}`);

  setLastTurnEmbed(search);

  const listFilter: ListFilter = {
    relacion,
    turno,
    temp,
    temporada: temporada === 'actual' || undefined,
    linea: parseLinea(linea),
    ...(envio ? { envio, r: r ?? 'todos' } : {}),
  };
  if (hasListFilter(listFilter) || etiqueta || orden) {
    // The derived filters only exist for the global lens: project and line
    // modules keep their own params (line_id, season).
    if (line_id || season !== 'any') {
      return json(
        { error: 'invalid_query', hint: 'turno/temp/temporada/linea/envio/relacion/etiqueta/orden go with project_ids/workspace_ids only.' },
        400,
      );
    }
    try {
      return json(
        await lensPage(env, jwt, search.get('select')!, {
          projectIds,
          workspaceIds,
          lineIds: parseIds(line_ids),
          status: status === 'any' ? undefined : status,
          q: qTrim,
          filter: listFilter,
          etiqueta,
          orden: orden ?? 'pide',
          limit,
          offset,
          idsOnly,
        }),
      );
    } catch (err) {
      return pgErrorResponse(err, { route: 'GET /api/conversations', requestId: locals.requestId }, { passUpstream: [401, 403] });
    }
  }

  search.set('order', 'next_action_at.asc.nullslast,updated_at.desc');
  if (idsOnly) {
    search.set('select', 'id,project_id');
    for (const k of [...search.keys()]) if (k.startsWith('last_turn.') || k.startsWith('last_in.')) search.delete(k);
    search.set('limit', String(MATCHING_MAX));
    try {
      const { data, total } = await pgGet<{ id: string; project_id: string }>(env, qTrim ? 'rpc/conversation_search' : 'conversation', jwt, {
        search,
        exactCount: true,
      });
      return json({ total: total ?? data.length, items: data.map((r) => ({ id: r.id, project_id: r.project_id })) });
    } catch (err) {
      return pgErrorResponse(err, { route: 'GET /api/conversations', requestId: locals.requestId }, { passUpstream: [401, 403] });
    }
  }
  search.set('limit', String(limit));
  search.set('offset', String(offset));

  try {
    const { data, total } = await pgGet<ConversationDbItem>(env, qTrim ? 'rpc/conversation_search' : 'conversation', jwt, {
      search,
      exactCount: true,
    });

    return json({
      total: total ?? data.length,
      limit,
      offset,
      status,
      season,
      items: await withExtras(env, jwt, data.map((r) => normalizeConversationItem(r))),
    });
  } catch (err) {
    return pgErrorResponse(
      err,
      { route: 'GET /api/conversations', requestId: locals.requestId },
      { passUpstream: [401, 403] },
    );
  }
};

/**
 * A page of the lens: `conversation_feed` in list mode filters, orders, counts
 * and cuts the window in one call (plan de la lista, fase 3); then the page's
 * rows are read in full (at most `limit` ids, RLS again) in the RPC's order.
 * The scope is no longer read here: `loadOverviewRows` is the panel's.
 */
async function lensPage(
  env: SupabaseEnv,
  jwt: string,
  select: string,
  o: {
    projectIds: string[];
    workspaceIds: string[];
    lineIds: string[];
    status?: (typeof CONVERSATION_STATUSES)[number];
    q: string;
    filter: ListFilter;
    etiqueta?: string;
    orden: Orden;
    limit: number;
    offset: number;
    idsOnly?: boolean;
  },
) {
  const page = await loadListPage(env, jwt, {
    projectIds: o.projectIds,
    workspaceIds: o.workspaceIds,
    tag: o.etiqueta ?? null,
    q: o.q || null,
    status: o.status,
    filter: o.filter,
    lineIds: o.lineIds,
    orden: o.orden,
    limit: o.limit,
    offset: o.offset,
    idsOnly: o.idsOnly,
  });
  if (o.idsOnly) {
    return { total: page.total, items: page.items.slice(0, MATCHING_MAX).map((r) => ({ id: r.id, project_id: r.project_id })) };
  }
  const unread = new Map(page.items.map((r) => [r.id, r.unread_count ?? 0]));
  const items = await readPage(env, jwt, select, page.items.map((r) => r.id));
  return {
    total: page.total,
    limit: o.limit,
    offset: o.offset,
    status: o.status ?? 'any',
    season: 'any',
    orden: o.orden,
    items: await withExtras(env, jwt, items.map((it) => ({ ...it, unread_count: unread.get(it.id) ?? 0 }))),
  };
}

/** The rows of a page (at most `limit` ids) read in full, in the order of `ids`. */
async function readPage(env: SupabaseEnv, jwt: string, select: string, ids: string[]) {
  if (ids.length === 0) return [];
  const search = new URLSearchParams({ select, id: `in.(${ids.join(',')})` });
  setLastTurnEmbed(search);
  const order = new Map(ids.map((id, i) => [id, i]));
  const { data } = await pgGet<ConversationDbItem>(env, 'conversation', jwt, { search });
  return data.sort((a, b) => order.get(a.id)! - order.get(b.id)!).map((r) => normalizeConversationItem(r));
}

/** The page's bolos and last mailout, one read each (plan de la lista § 8). */
async function withExtras(env: SupabaseEnv, jwt: string, items: ConversationItem[]): Promise<ConversationItem[]> {
  const { bolos, mailouts } = await loadRowExtras(env, jwt, items.map((i) => i.id));
  return items.map((it) => ({
    ...it,
    ...(bolos ? { bolos: bolos.get(it.id) ?? [] } : {}),
    last_mailout: mailouts.get(it.id) ?? null,
  }));
}

/**
 * POST /api/conversations — capture a contact/conversation (ADR-051).
 *
 * Body: ConversationCreateSchema — project_id plus the organization
 * (`organization_id` or `organization`) and/or the person (`person_id` or
 * `person`, the primary contact). ADR-102: the conversation is with the
 * organization; with only a person it is theirs, or one named after them. Goes through the `create_conversation` RPC
 * (SECURITY DEFINER): the direct INSERT is claim-bound — sixth case of
 * the pattern. Gated on has_permission(project, 'edit:conversation').
 *
 * 409 conversation_exists (+ `conversation_id` when the clash is the
 * organization's, so the UI can open it): the organization, or until the
 * contract the person, already has a conversation in this project that the
 * caller can see (shared, or private to the caller) — the UI
 * links to it instead of silently merging. Someone else's private one never
 * counts and is never hinted at (20261011500000): the caller gets their own.
 */
export const POST: RequestHandler = async ({ request, platform, locals }) => {
  if (!platform?.env) return json({ error: 'platform_unavailable' }, 500);
  const env = platform.env as unknown as SupabaseEnv;

  const jwt = extractAccessToken(request);
  if (!jwt) return json({ error: 'missing_authorization' }, 401);

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return json({ error: 'invalid_body' }, 400);
  }
  const parsed = v.safeParse(ConversationCreateSchema, raw);
  if (!parsed.success) {
    return json(
      {
        error: 'invalid_body',
        issues: parsed.issues.map((i) => ({
          path: i.path?.map((p) => p.key).join('.'),
          message: i.message,
        })),
      },
      400,
    );
  }
  const input = parsed.output;

  const problem = conversationCreateProblem(input);
  if (problem) return json({ error: 'invalid_body', hint: problem }, 400);

  try {
    const { data } = await pgPostRpc<Record<string, unknown>>(env, 'create_conversation', jwt, {
      p_project_id: input.project_id,
      p_person_id: input.person_id ?? null,
      p_full_name: input.person?.full_name ?? null,
      p_email: input.person?.email ?? null,
      p_phone: input.person?.phone ?? null,
      p_organization_id: input.organization_id ?? null,
      p_organization_name: input.organization?.name ?? input.person?.organization_name ?? null,
      p_title: input.person?.title ?? null,
      p_status: input.status,
      p_role: input.role ?? null,
      p_next_action_at: input.next_action_at ?? null,
      p_next_action_note: input.next_action_note ?? null,
      p_line_id: input.line_id ?? null,
    });
    const conversation = data[0];
    if (!conversation) return json({ error: 'create_failed' }, 502);
    // ADR-138 fase 2: its tags. The conversation already exists: a failure
    // here does not undo it, the answer says so (`tagged: false`).
    let tagged = true;
    if (input.tag_ids && input.tag_ids.length > 0) {
      try {
        await pgPostRpc(env, 'set_conversation_tags', jwt, {
          p_conversation_id: conversation.id,
          p_tag_ids: input.tag_ids,
        });
      } catch {
        tagged = false;
      }
    }
    // ADR-102 phase 4: the row no longer names a person. The primary
    // contact's id lets a multi-project capture link the same person again.
    let primaryPersonId: string | null = null;
    if (input.person_id || input.person) {
      const { data: primary } = await pgGet<{ person_id: string }>(env, 'conversation_contact', jwt, {
        search: { select: 'person_id', conversation_id: `eq.${conversation.id}`, is_primary: 'eq.true' },
      });
      primaryPersonId = primary[0]?.person_id ?? null;
    }
    return json({ conversation, primary_person_id: primaryPersonId, tagged }, 201);
  } catch (err) {
    const existing = err instanceof PostgrestError && err.code === '23505' ? existingConversationId(err.body) : null;
    if (existing) {
      return json(
        {
          error: 'conversation_exists',
          hint: 'This organization already has a conversation in this project.',
          conversation_id: existing,
        },
        409,
      );
    }
    return pgErrorResponse(
      err,
      { route: 'POST /api/conversations', requestId: locals.requestId },
      {
        codes: {
          '22023': { status: 400, error: 'invalid_input' },
          '42501': { status: 403, error: 'forbidden' },
          '23505': {
            status: 409,
            error: 'conversation_exists',
            hint: 'This person already has a conversation in this project.',
          },
        },
      },
    );
  }
};
