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
 * Auth: Bearer JWT required. RLS denies anon.
 */

import type { RequestHandler } from './$types';
import * as v from 'valibot';
import { extractAccessToken } from '$lib/auth';
import {
  CONVERSATION_SELECT,
  CONVERSATION_STATUSES,
  ConversationCreateSchema,
  normalizeConversationItem,
  type ConversationDbItem,
} from '$lib/conversation';
import { pgGet, pgPostRpc, type SupabaseEnv } from '$lib/supabase';
import { pgErrorResponse } from '$lib/server/errors';

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

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

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
  const { status, project_slug, project_ids, workspace_ids, line_id, q, season, limit, offset } =
    parsed.output;

  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const parseIds = (raw?: string) =>
    raw
      ? [...new Set(raw.split(',').map((x) => x.trim()).filter((x) => UUID.test(x)))]
      : [];
  const projectIds = parseIds(project_ids);
  const workspaceIds = parseIds(workspace_ids);

  const search = new URLSearchParams();
  // !inner joins: project when filtering by its slug; person when the
  // free-text search runs over its columns.
  let select = CONVERSATION_SELECT;
  if (project_slug) {
    select = select.replace('project:project_id(', 'project:project_id!inner(');
  }
  if (q) {
    select = select.replace(
      'person:workspace_person!conversation_workspace_person_fkey(',
      'person:workspace_person!conversation_workspace_person_fkey!inner(',
    );
  }
  search.set('select', select);

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

  if (q) {
    // Escape PostgREST pattern/logic chars, then substring-match fields in
    // this workspace's dossier. Organization search moves to the dedicated
    // organization projection rather than reading a global person field.
    const safe = q.replace(/[%_*(),.]/g, ' ').trim();
    if (safe) {
      search.set(
        'person.or',
        `(full_name.ilike.*${safe}*,email.ilike.*${safe}*)`,
      );
    }
  }

  if (status !== 'any') search.set('status', `eq.${status}`);
  if (season !== 'any') search.set('custom_fields->>season', `eq.${season}`);

  search.set('order', 'next_action_at.asc.nullslast,updated_at.desc');
  search.set('limit', String(limit));
  search.set('offset', String(offset));

  try {
    const { data, total } = await pgGet<ConversationDbItem>(env, 'conversation', jwt, {
      search,
      exactCount: true,
    });

    return json({
      total: total ?? data.length,
      limit,
      offset,
      status,
      season,
      items: data.map(normalizeConversationItem),
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
 * POST /api/conversations — capture a contact/conversation (ADR-051).
 *
 * Body: ConversationCreateSchema — project_id plus EXACTLY ONE of
 * `person_id` (existing person) or `person` (inline fields; the RPC
 * find-or-creates on email). Goes through the `create_conversation` RPC
 * (SECURITY DEFINER): the direct INSERT is claim-bound — sixth case of
 * the pattern. Gated on has_permission(project, 'edit:conversation').
 *
 * 409 conversation_exists: the (workspace, project, person) pair already
 * has a conversation — the UI links to it instead of silently merging.
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

  if (Boolean(input.person_id) === Boolean(input.person)) {
    return json(
      { error: 'invalid_body', hint: 'Send exactly one of person_id or person.' },
      400,
    );
  }

  try {
    const { data } = await pgPostRpc<Record<string, unknown>>(env, 'create_conversation', jwt, {
      p_project_id: input.project_id,
      p_person_id: input.person_id ?? null,
      p_full_name: input.person?.full_name ?? null,
      p_email: input.person?.email ?? null,
      p_phone: input.person?.phone ?? null,
      p_organization_name: input.person?.organization_name ?? null,
      p_title: input.person?.title ?? null,
      p_status: input.status,
      p_role: input.role ?? null,
      p_next_action_at: input.next_action_at ?? null,
      p_next_action_note: input.next_action_note ?? null,
      p_line_id: input.line_id ?? null,
    });
    if (data.length === 0 || !data[0]) return json({ error: 'create_failed' }, 502);
    return json({ conversation: data[0] }, 201);
  } catch (err) {
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
