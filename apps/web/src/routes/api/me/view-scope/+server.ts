/**
 * «Lo mío / Todo» in a space (ADR-151): what the caller's own surfaces (Hoy,
 * Ahora, the pulse) and the Planner show there.
 *
 * PUT { workspace_id, view_scope: 'mine' | 'all' | null } → `set_my_view_scope`,
 * the caller's own workspace membership only; null returns to the default of
 * their access package. A space they are not in answers 404 without saying more.
 *
 * The read rides on GET /api/workspaces (`view_scope` on each item).
 */
import type { RequestHandler } from './$types';
import * as v from 'valibot';
import { extractAccessToken } from '$lib/auth';
import { pgPostRpc, type SupabaseEnv } from '$lib/supabase';
import { pgErrorResponse } from '$lib/server/errors';
import { jsonNoStore, UUID_RE } from '$lib/server/http';

const PutSchema = v.object({
  workspace_id: v.pipe(v.string(), v.regex(UUID_RE)),
  view_scope: v.nullable(v.picklist(['mine', 'all'])),
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
  const { workspace_id, view_scope } = parsed.output;
  try {
    await pgPostRpc(env, 'set_my_view_scope', jwt, { p_workspace_id: workspace_id, p_scope: view_scope });
    return jsonNoStore({ workspace_id, view_scope });
  } catch (err) {
    return pgErrorResponse(
      err,
      { route: 'PUT /api/me/view-scope', requestId: locals.requestId },
      { codes: { '42501': { status: 404, error: 'not_found' }, '22023': { status: 400, error: 'invalid_body' } } },
    );
  }
};
