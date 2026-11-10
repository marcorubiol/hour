/**
 * The Planner drawing the caller opens in, in a space (ADR-192, task 129).
 *
 * PUT { workspace_id, planner_view: 'agenda' | 'month' | 'board' | 'overview' | null }
 * → `set_my_planner_view`, the caller's own workspace membership only; null
 * returns to the default, the season overview. A space they are not in
 * answers 404 without saying more. The Planner writes it when a drawing is
 * chosen in its bar; there is no setting of its own.
 *
 * The read rides on GET /api/workspaces (`planner_view` on each item).
 */
import type { RequestHandler } from './$types';
import * as v from 'valibot';
import { extractAccessToken } from '$lib/auth';
import { pgPostRpc, type SupabaseEnv } from '$lib/supabase';
import { pgErrorResponse } from '$lib/server/errors';
import { jsonNoStore, UUID_RE } from '$lib/server/http';

const PutSchema = v.object({
  workspace_id: v.pipe(v.string(), v.regex(UUID_RE)),
  planner_view: v.nullable(v.picklist(['overview', 'agenda', 'month', 'board'])),
});

export const PUT: RequestHandler = async ({ request, platform, locals }) => {
  if (!platform?.env) return jsonNoStore({ error: 'platform_unavailable' }, 500);
  const env = platform.env as unknown as SupabaseEnv;
  const jwt = extractAccessToken(request);
  if (!jwt) return jsonNoStore({ error: 'missing_authorization' }, 401);
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return jsonNoStore({ error: 'invalid_body' }, 400);
  }
  const parsed = v.safeParse(PutSchema, raw);
  if (!parsed.success) return jsonNoStore({ error: 'invalid_body' }, 400);
  const { workspace_id, planner_view } = parsed.output;
  try {
    await pgPostRpc(env, 'set_my_planner_view', jwt, { p_workspace_id: workspace_id, p_view: planner_view });
    return jsonNoStore({ workspace_id, planner_view });
  } catch (err) {
    return pgErrorResponse(
      err,
      { route: 'PUT /api/me/planner-view', requestId: locals.requestId },
      { codes: { '42501': { status: 404, error: 'not_found' }, '22023': { status: 400, error: 'invalid_body' } } },
    );
  }
};
