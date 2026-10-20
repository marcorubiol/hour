/**
 * GET /api/conversations
 *
 * Lists conversations in the current workspace, with the linked person and
 * project embedded. RLS + the `current_workspace_id` claim decide visibility —
 * this endpoint is a thin PostgREST wrapper, no RPC needed.
 *
 * Anti-CRM vocabulary (reset v2 enum, 2026-04-19): status defaults to
 * `contacted`. Pass `status=any` to disable status filtering.
 *
 * Each row carries `last_turn` (its last directional email, message or call),
 * so the list can say whose turn it is (ADR-117). The dashboard filters
 * (`turno=nuestro|suyo`, `temp=caliente|fria|ronda|parada`, `temporada=actual`, `relacion=…` (ADR-138), with
 * `line_ids` for the season and `linea` for one of its lines) are derived, not columns: the scope is read and
 * filtered with `$lib/conversation-overview` (the same rules as the blocks),
 * in the block's order, and only the page is read in full.
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
} from '$lib/conversation';
import { PostgrestError, pgGet, pgPostRpc, type SupabaseEnv } from '$lib/supabase';
import { pgErrorResponse } from '$lib/server/errors';
import { TURN_EMBEDS, loadOverviewRows, mailoutPickIds, setLastTurnEmbed, setScope } from '$lib/server/conversation-overview';
import { applyListFilter, hasListFilter, parseLinea, type ListFilter } from '$lib/conversation-overview';
import { RELATIONS } from '$lib/conversation-relation';
import { json } from '$lib/server/http';
import { TAG_KEY_RE, filterByChip } from '$lib/conversation-tags';
import { loadTaggedIds } from '$lib/server/conversation-overview';

const QuerySchema = v.object({
  status: v.optional(
    v.union([v.literal('any'), v.picklist(CONVERSATION_STATUSES)]),
    'contacted',
  ),
  project_slug: v.optional(v.pipe(v.string(), v.minLength(1))),
  project_ids: v.optional(v.string()),
  workspace_ids: v.optional(v.string()),
  line_id: v.optional(v.pipe(v.string(), v.uuid())),
  q: v.optional(v.pipe(v.string(), v.trim(), v.maxLength(120))),
  season: v.optional(v.string(), 'any'),
  turno: v.optional(v.picklist(['nuestro', 'suyo'])),
  temp: v.optional(v.picklist(['caliente', 'fria', 'ronda', 'parada', 'sin-fecha'])),
  temporada: v.optional(v.literal('actual')),
  // ADR-135: one line of the season (its id, or `sin` for the ones without).
  linea: v.optional(v.string()),
  // ADR-126 § 9: the recipients of a mailout behind one of its figures.
  envio: v.optional(v.pipe(v.string(), v.uuid())),
  r: v.optional(v.picklist(['respuestas', 'rebotes'])),
  // ADR-138: one derived relation.
  relacion: v.optional(v.picklist(RELATIONS)),
  // ADR-138 fase 2: el chip de la lente, la clave de una etiqueta (sin ninguna se lee `sales`).
  etiqueta: v.optional(v.pipe(v.string(), v.regex(TAG_KEY_RE))),
  line_ids: v.optional(v.string()),
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
  const { status, project_slug, project_ids, workspace_ids, line_id, q, season, limit, offset, turno, temp, temporada, linea, line_ids, envio, r, relacion, etiqueta } =
    parsed.output;

  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const parseIds = (raw?: string) =>
    raw
      ? [...new Set(raw.split(',').map((x) => x.trim()).filter((x) => UUID.test(x)))]
      : [];
  const projectIds = parseIds(project_ids);
  const workspaceIds = parseIds(workspace_ids);

  const search = new URLSearchParams();
  // !inner join on project when filtering by its slug. The free-text search
  // runs over the organization and every contact (ADR-102) through the
  // `conversation_search` RPC, which returns conversation rows: the same
  // embeds, filters and order apply.
  let select = `${CONVERSATION_SELECT},${TURN_EMBEDS}`;
  if (project_slug) {
    select = select.replace('project:project_id(', 'project:project_id!inner(');
  }
  search.set('select', select);
  const qTrim = q?.trim() ?? '';
  if (qTrim) search.set('p_q', qTrim);

  if (project_slug) search.set('project.slug', `eq.${project_slug}`);
  if (projectIds.length > 0 && workspaceIds.length > 0) {
    search.set(
      'or',
      `(project_id.in.(${projectIds.join(',')}),workspace_id.in.(${workspaceIds.join(',')}))`,
    );
  } else if (projectIds.length > 0) {
    search.set('project_id', `in.(${projectIds.join(',')})`);
  } else if (workspaceIds.length > 0) {
    search.set('workspace_id', `in.(${workspaceIds.join(',')})`);
  }
  if (line_id) search.set('line_id', `eq.${line_id}`);
  search.set('deleted_at', 'is.null');

  if (status !== 'any') search.set('status', `eq.${status}`);
  if (season !== 'any') search.set('custom_fields->>season', `eq.${season}`);

  setLastTurnEmbed(search);

  const listFilter = {
    relacion,
    turno,
    temp,
    temporada: temporada === 'actual' || undefined,
    linea: temporada === 'actual' ? parseLinea(linea) : undefined,
    ...(envio && r ? { envio, r } : {}),
  };
  if (hasListFilter(listFilter) || etiqueta) {
    // The derived filters only exist for the global lens: project and line
    // modules keep their own params (project_slug, line_id, season).
    if (project_slug || line_id || season !== 'any') return json({ error: 'invalid_query', hint: 'turno/temp/temporada/envio/relacion/etiqueta go with project_ids/workspace_ids only.' }, 400);
  }
  if (!hasListFilter(listFilter) && etiqueta) {
    // A tag alone: the scope's ids with their tags, in the list's order; then
    // the page in full. Untagged rows read as `sales` (`tagKeysOf`).
    try {
      const base = new URLSearchParams(search);
      base.delete('select');
      // The turn embeds are not in the light select: their filters go too.
      for (const k of [...base.keys()]) if (k.startsWith('last_turn.') || k.startsWith('last_in.')) base.delete(k);
      const matched = filterByChip(await loadTaggedIds(env, jwt, base, qTrim ? 'rpc/conversation_search' : 'conversation'), etiqueta);
      const ids = matched.slice(offset, offset + limit).map((m) => m.id);
      return json({ total: matched.length, limit, offset, status, season, items: await readPage(env, jwt, search.get('select')!, ids) });
    } catch (err) {
      return pgErrorResponse(err, { route: 'GET /api/conversations', requestId: locals.requestId }, { passUpstream: [401, 403] });
    }
  }
  if (hasListFilter(listFilter)) {
    try {
      return json(
        await filteredPage(env, jwt, search, {
          projectIds,
          workspaceIds,
          lineIds: parseIds(line_ids),
          status: status === 'any' ? undefined : status,
          q: qTrim,
          filter: listFilter,
          etiqueta,
          limit,
          offset,
        }),
      );
    } catch (err) {
      return pgErrorResponse(err, { route: 'GET /api/conversations', requestId: locals.requestId }, { passUpstream: [401, 403] });
    }
  }

  search.set('order', 'next_action_at.asc.nullslast,updated_at.desc');
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
      items: data.map((r) => normalizeConversationItem(r)),
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
 * A page of a derived filter: the scope's rows filtered and ordered by the
 * dashboard rules, then the page's rows read in full (at most `limit` ids).
 * A search narrows the set through the same RPC as the plain list.
 */
async function filteredPage(
  env: SupabaseEnv,
  jwt: string,
  pageSearch: URLSearchParams,
  o: {
    projectIds: string[];
    workspaceIds: string[];
    lineIds: string[];
    status?: (typeof CONVERSATION_STATUSES)[number];
    q: string;
    filter: ListFilter;
    etiqueta?: string;
    limit: number;
    offset: number;
  },
) {
  const rows = await loadOverviewRows(env, jwt, { projectIds: o.projectIds, workspaceIds: o.workspaceIds, status: o.status });
  let matched = applyListFilter(o.etiqueta ? filterByChip(rows, o.etiqueta) : rows, o.filter, new Date(), o.lineIds);
  if (o.filter.envio && o.filter.r) {
    const ids = await mailoutPickIds(env, jwt, o.filter.envio, o.filter.r, rows);
    matched = matched.filter((r) => ids.has(r.id));
  }
  if (o.q) {
    const search = new URLSearchParams({ select: 'id', p_q: o.q, deleted_at: 'is.null', limit: '5000' });
    setScope(search, o.projectIds, o.workspaceIds);
    const { data } = await pgGet<{ id: string }>(env, 'rpc/conversation_search', jwt, { search });
    const hits = new Set(data.map((r) => r.id));
    matched = matched.filter((r) => hits.has(r.id));
  }
  const ids = matched.slice(o.offset, o.offset + o.limit).map((r) => r.id);
  return {
    total: matched.length,
    limit: o.limit,
    offset: o.offset,
    status: o.status ?? 'any',
    season: 'any',
    items: await readPage(env, jwt, pageSearch.get('select')!, ids),
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
