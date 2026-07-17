/**
 * GET /api/tasks — task rows for the Desk feed and the Tasks line module
 * (ADR-068). Filter by workspace_ids/project_ids (union) and/or a single
 * line_id / performance_id / engagement_id; no filter = everything RLS
 * lets the caller see (the Desk feed's shape, same as /api/lines).
 *
 * POST /api/tasks — create a task against at most one parent, or free at
 * workspace level. Goes through the `create_task` RPC: the direct INSERT
 * is claim-bound — same pattern as every create_*. Member-gated (tasks are
 * workspace-scoped, not has_permission — see the migration header).
 *
 * Auth: Bearer JWT required.
 */

import type { RequestHandler } from './$types';
import * as v from 'valibot';
import { extractAccessToken } from '$lib/auth';
import { TASK_STATUSES, TASK_SELECT, TaskCreateSchema, type TaskItem } from '$lib/task';
import { pgGet, pgPostRpc, type SupabaseEnv } from '$lib/supabase';
import { pgErrorResponse } from '$lib/server/errors';

const QuerySchema = v.object({
  workspace_ids: v.optional(v.string()),
  project_ids: v.optional(v.string()),
  line_id: v.optional(v.pipe(v.string(), v.uuid())),
  performance_id: v.optional(v.pipe(v.string(), v.uuid())),
  engagement_id: v.optional(v.pipe(v.string(), v.uuid())),
  status: v.optional(v.union([v.literal('any'), v.picklist(TASK_STATUSES)]), 'open'),
  limit: v.optional(
    v.pipe(
      v.string(),
      v.transform((n) => Number(n)),
      v.number(),
      v.integer(),
      v.minValue(1),
      v.maxValue(500),
    ),
    '200',
  ),
});

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

function parseUuidList(raw: string | undefined): string[] {
  if (!raw) return [];
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  return [...new Set(raw.split(',').map((s) => s.trim()).filter((s) => UUID.test(s)))];
}

export const GET: RequestHandler = async ({ request, url, platform, locals }) => {
  if (!platform?.env) return json({ error: 'platform_unavailable' }, 500);
  const env = platform.env as unknown as SupabaseEnv;

  const jwt = extractAccessToken(request);
  if (!jwt) return json({ error: 'missing_authorization' }, 401);

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
  const { workspace_ids, project_ids, line_id, performance_id, engagement_id, status, limit } =
    parsed.output;
  const workspaceIds = parseUuidList(workspace_ids);
  const projectIds = parseUuidList(project_ids);

  const search = new URLSearchParams();
  search.set('select', TASK_SELECT);
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
  if (performance_id) search.set('performance_id', `eq.${performance_id}`);
  if (engagement_id) search.set('engagement_id', `eq.${engagement_id}`);
  if (status !== 'any') search.set('status', `eq.${status}`);
  search.set('deleted_at', 'is.null');
  search.set('order', 'due_at.asc.nullslast,created_at.desc');
  search.set('limit', String(limit));

  try {
    const { data } = await pgGet<TaskItem>(env, 'task', jwt, { search });
    return json({ items: data });
  } catch (err) {
    return pgErrorResponse(
      err,
      { route: 'GET /api/tasks', requestId: locals.requestId },
      { passUpstream: [401, 403] },
    );
  }
};

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
  const parsed = v.safeParse(TaskCreateSchema, raw);
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

  const parents = [
    input.project_id,
    input.line_id,
    input.performance_id,
    input.engagement_id,
  ].filter(Boolean).length;
  if (parents > 1) {
    return json(
      {
        error: 'invalid_body',
        hint: 'Send at most one of project_id / line_id / performance_id / engagement_id.',
      },
      400,
    );
  }
  if (parents === 0 && !input.workspace_id) {
    return json(
      { error: 'invalid_body', hint: 'A task with no parent needs workspace_id.' },
      400,
    );
  }

  try {
    const { data } = await pgPostRpc<TaskItem>(env, 'create_task', jwt, {
      p_title: input.title,
      p_note: input.note ?? null,
      p_due_at: input.due_at ?? null,
      p_from_at: input.from_at ?? null,
      p_lead_days: input.lead_days ?? null,
      p_workspace_id: parents === 0 ? input.workspace_id : null,
      p_project_id: input.project_id ?? null,
      p_line_id: input.line_id ?? null,
      p_performance_id: input.performance_id ?? null,
      p_engagement_id: input.engagement_id ?? null,
    });
    if (data.length === 0 || !data[0]) return json({ error: 'create_failed' }, 502);
    return json({ task: data[0] }, 201);
  } catch (err) {
    return pgErrorResponse(
      err,
      { route: 'POST /api/tasks', requestId: locals.requestId },
      {
        codes: {
          '22023': { status: 400, error: 'invalid_input' },
          '42501': { status: 403, error: 'forbidden' },
        },
      },
    );
  }
};
