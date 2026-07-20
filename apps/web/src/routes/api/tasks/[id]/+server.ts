/**
 * PATCH /api/tasks/:id — edit a task's fields (title, note, due date,
 * open/done). Direct PostgREST PATCH: task_update RLS is member-gated and
 * NOT claim-bound, and the row stays SELECT-visible after a field edit
 * (ADR-048 only bites soft-deletes). Whitelisted by TaskPatchSchema — the
 * parent FKs are not in it (immutable by DB trigger anyway).
 *
 * DELETE /api/tasks/:id — soft-delete via the `delete_task` RPC (ADR-048
 * rule: task has no DELETE policy and a deleted_at PATCH would 42501 by
 * construction).
 *
 * Auth: Bearer JWT required.
 */

import type { RequestHandler } from './$types';
import * as v from 'valibot';
import { extractAccessToken } from '$lib/auth';
import {
  TASK_SELECT,
  TaskPatchSchema,
  normalizeTaskItem,
  type TaskDbItem,
} from '$lib/task';
import { pgPatch, pgPostRpc, type SupabaseEnv } from '$lib/supabase';
import { pgErrorResponse } from '$lib/server/errors';

const IdSchema = v.pipe(v.string(), v.uuid());

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

export const PATCH: RequestHandler = async ({ request, params, platform, locals }) => {
  if (!platform?.env) return json({ error: 'platform_unavailable' }, 500);
  const env = platform.env as unknown as SupabaseEnv;

  const jwt = extractAccessToken(request);
  if (!jwt) return json({ error: 'missing_authorization' }, 401);

  const idParsed = v.safeParse(IdSchema, params.id);
  if (!idParsed.success) return json({ error: 'invalid_id' }, 400);

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return json({ error: 'invalid_body' }, 400);
  }

  const parsed = v.safeParse(TaskPatchSchema, raw);
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
  const patch = parsed.output;
  if (Object.keys(patch).length === 0) {
    return json({ error: 'empty_patch' }, 400);
  }

  const search = new URLSearchParams();
  search.set('id', `eq.${idParsed.output}`);
  search.set('deleted_at', 'is.null');
  search.set('select', TASK_SELECT);

  try {
    const { data } = await pgPatch<TaskDbItem>(env, 'task', jwt, patch, { search });
    if (data.length === 0) return json({ error: 'not_found' }, 404);
    return json({ task: normalizeTaskItem(data[0]) });
  } catch (err) {
    return pgErrorResponse(
      err,
      { route: 'PATCH /api/tasks/[id]', requestId: locals.requestId },
      {
        codes: { '23514': { status: 400, error: 'constraint_violation' } },
        passUpstream: [401, 403],
      },
    );
  }
};

export const DELETE: RequestHandler = async ({ request, params, platform, locals }) => {
  if (!platform?.env) return json({ error: 'platform_unavailable' }, 500);
  const env = platform.env as unknown as SupabaseEnv;

  const jwt = extractAccessToken(request);
  if (!jwt) return json({ error: 'missing_authorization' }, 401);

  const idParsed = v.safeParse(IdSchema, params.id);
  if (!idParsed.success) return json({ error: 'invalid_id' }, 400);

  try {
    await pgPostRpc(env, 'delete_task', jwt, { p_task_id: idParsed.output });
    return new Response(null, { status: 204 });
  } catch (err) {
    return pgErrorResponse(
      err,
      { route: 'DELETE /api/tasks/[id]', requestId: locals.requestId },
      { codes: { '42501': { status: 404, error: 'not_found' } } },
    );
  }
};
