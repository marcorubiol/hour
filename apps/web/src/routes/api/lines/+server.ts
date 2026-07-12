/**
 * GET /api/lines
 *
 * Lists lines accessible to the caller. Filter scope (any combination):
 *   - ?project_id=<uuid>           → single project
 *   - ?project_ids=uuid,uuid,...   → multi-project union
 *   - ?workspace_ids=uuid,uuid,... → all lines whose project is in these workspaces
 *   - (none)                       → all lines accessible by RLS
 *
 * If multiple filters supplied, they combine as an OR (union). LineList
 * passes the union of (explicitly-selected projects) ∪ (projects implied
 * by selected workspaces) when the SelectionStore has either kind active.
 *
 * Sort: last_navigated_at desc nullslast, updated_at desc fallback. Used by
 * LineList for "most recently used at top" ordering.
 *
 * Embed: project (id, slug, name, workspace_id) so sidebar can show
 * project context per line when multiple projects are in scope.
 *
 * RLS scopes by workspace membership (ADR-029). No `current_workspace_id`
 * claim needed.
 *
 * Auth: Bearer JWT required. RLS denies anon.
 */

import type { RequestHandler } from './$types';
import * as v from 'valibot';
import { extractBearer } from '$lib/auth';
import type { Tables } from '$lib/db-types';
import { LineModulesSchema, type ModuleKey } from '$lib/line-templates';
import { pgGet, pgPostRpc, PostgrestError, type SupabaseEnv } from '$lib/supabase';

const ALLOWED_STATUSES = ['any', 'open', 'closed', 'archived'] as const;

const ALLOWED_KINDS = [
  'any',
  'tour',
  'season',
  'phase',
  'circuit',
  'residency',
  'other',
  'creation',
  'campaign',
  'comms',
  'misc',
] as const;

// Parse comma-separated uuid list, drop invalid ones silently. Returns null
// if input is null/empty (caller treats absent as "no filter").
function parseUuidList(raw: string | null | undefined): string[] | null {
  if (!raw) return null;
  const list = raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .filter((s) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s));
  return list.length > 0 ? list : null;
}

const QuerySchema = v.object({
  project_id: v.optional(v.pipe(v.string(), v.uuid())),
  project_ids: v.optional(v.string()),
  workspace_ids: v.optional(v.string()),
  status: v.optional(v.picklist(ALLOWED_STATUSES), 'any'),
  kind: v.optional(v.picklist(ALLOWED_KINDS), 'any'),
  limit: v.optional(
    v.pipe(
      v.string(),
      v.transform((n) => Number(n)),
      v.number(),
      v.integer(),
      v.minValue(1),
      v.maxValue(200),
    ),
    '100',
  ),
});

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

type ProjectLite = {
  id: string;
  slug: string;
  name: string;
  workspace_id: string;
};

type LineItem = {
  id: string;
  slug: string | null;
  name: string;
  kind: string;
  status: string;
  territory: string | null;
  start_date: string | null;
  end_date: string | null;
  accent: string | null;
  description: string | null;
  modules: ModuleKey[] | null;
  project_id: string;
  workspace_id: string;
  updated_at: string;
  last_navigated_at: string | null;
  project: ProjectLite | null;
};

type LineRow = Tables<'line'>;

const CreateBodySchema = v.object({
  project_id: v.pipe(v.string(), v.uuid()),
  name: v.pipe(v.string(), v.trim(), v.minLength(1), v.maxLength(80)),
  accent: v.optional(v.pipe(v.string(), v.regex(/^[1-8]$/))),
  description: v.optional(v.pipe(v.string(), v.trim(), v.maxLength(280))),
  kind: v.optional(
    v.picklist([
      'tour',
      'season',
      'phase',
      'circuit',
      'residency',
      'other',
      'creation',
      'campaign',
      'comms',
      'misc',
    ]),
  ),
  // ADR-056: the template picker fixes the module set at creation.
  modules: v.optional(LineModulesSchema),
});

export const POST: RequestHandler = async ({ request, platform }) => {
  if (!platform?.env) return json({ error: 'platform_unavailable' }, 500);
  const env = platform.env as unknown as SupabaseEnv;

  const jwt = extractBearer(request);
  if (!jwt) return json({ error: 'missing_authorization' }, 401);

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return json({ error: 'invalid_body' }, 400);
  }
  const parsed = v.safeParse(CreateBodySchema, raw);
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

  const args: Record<string, unknown> = {
    p_project_id: parsed.output.project_id,
    p_name: parsed.output.name,
  };
  if (parsed.output.accent) args.p_accent = parsed.output.accent;
  if (parsed.output.description) args.p_description = parsed.output.description;
  if (parsed.output.kind) args.p_kind = parsed.output.kind;
  if (parsed.output.modules) args.p_modules = parsed.output.modules;

  try {
    const { data } = await pgPostRpc<LineRow>(env, 'create_line', jwt, args);
    const line = data[0];
    if (!line) return json({ error: 'rpc_empty_result' }, 502);
    return json({ line }, 201);
  } catch (err) {
    if (err instanceof PostgrestError) {
      const body = err.body;
      let status = 502;
      if (body.includes('22023')) status = 400;
      else if (body.includes('42501')) status = 403;
      return json({ error: 'rpc_error', status: err.status, detail: body }, status);
    }
    return json({ error: 'unexpected', detail: String(err) }, 500);
  }
};

export const GET: RequestHandler = async ({ request, url, platform }) => {
  if (!platform?.env) {
    return json({ error: 'platform_unavailable' }, 500);
  }
  const env = platform.env as unknown as SupabaseEnv;

  const jwt = extractBearer(request);
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
  const { project_id, project_ids, workspace_ids, status, kind, limit } =
    parsed.output;

  const projectIds = parseUuidList(project_ids);
  const workspaceIds = parseUuidList(workspace_ids);

  // Build the project_id filter as union: single project_id ∪ project_ids list
  const allProjectIds: string[] = [];
  if (project_id) allProjectIds.push(project_id);
  if (projectIds) allProjectIds.push(...projectIds);
  const uniqueProjectIds = Array.from(new Set(allProjectIds));

  const search = new URLSearchParams();
  search.set(
    'select',
    [
      'id,slug,name,kind,status,territory',
      'start_date,end_date,accent,description,modules',
      'project_id,workspace_id,updated_at,last_navigated_at',
      'project:project_id(id,slug,name,workspace_id)',
    ].join(','),
  );
  search.set('deleted_at', 'is.null');

  // Filter precedence: project_ids ∪ workspace_ids. If both supplied, combine
  // via PostgREST `or=()`. If only one, simpler `in.()`. If neither, no filter
  // (RLS still scopes to user's accessible workspaces).
  if (uniqueProjectIds.length > 0 && workspaceIds && workspaceIds.length > 0) {
    search.set(
      'or',
      `(project_id.in.(${uniqueProjectIds.join(',')}),workspace_id.in.(${workspaceIds.join(',')}))`,
    );
  } else if (uniqueProjectIds.length > 0) {
    search.set('project_id', `in.(${uniqueProjectIds.join(',')})`);
  } else if (workspaceIds && workspaceIds.length > 0) {
    search.set('workspace_id', `in.(${workspaceIds.join(',')})`);
  }

  if (status !== 'any') search.set('status', `eq.${status}`);
  if (kind !== 'any') search.set('kind', `eq.${kind}`);
  search.set('order', 'last_navigated_at.desc.nullslast,updated_at.desc');
  search.set('limit', String(limit));

  try {
    const { data } = await pgGet<LineItem>(env, 'line', jwt, { search });
    return json({ items: data });
  } catch (err) {
    if (err instanceof PostgrestError) {
      const upstream = err.status === 401 || err.status === 403 ? err.status : 502;
      return json(
        { error: 'postgrest_error', status: err.status, detail: err.body },
        upstream,
      );
    }
    return json({ error: 'unexpected', detail: String(err) }, 500);
  }
};
