/**
 * POST /api/lines/visit
 *
 * Touches the `last_navigated_at` of a line to `now()`. Called by the line
 * detail page when mounted, so LineList can sort "most recently used at
 * top" in its filter view.
 *
 * Backed by RPC `touch_line_visit(p_line_id uuid)` (SECURITY DEFINER with
 * `is_workspace_member()` check inside). Phase 0 tracks globally per-line,
 * not per-user — junction table can come in 0.5+ if per-user history is
 * needed.
 *
 * Body: `{ line_id: string }`
 * Returns: 204 on success, 400 invalid body, 401 missing JWT, 403 if RPC
 * rejects, 5xx on upstream errors.
 */

import type { RequestHandler } from './$types';
import * as v from 'valibot';
import { extractAccessToken } from '$lib/auth';
import { pgPostRpc, type SupabaseEnv } from '$lib/supabase';
import { pgErrorResponse } from '$lib/server/errors';

const BodySchema = v.object({
  line_id: v.pipe(v.string(), v.uuid()),
});

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

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
  const parsed = v.safeParse(BodySchema, raw);
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
  const { line_id } = parsed.output;

  try {
    await pgPostRpc(env, 'touch_line_visit', jwt, { p_line_id: line_id });
    return new Response(null, { status: 204 });
  } catch (err) {
    return pgErrorResponse(
      err,
      { route: 'POST /api/lines/visit', requestId: locals.requestId },
      {
        codes: {
          '42501': { status: 403, error: 'rpc_error' },
        },
        passUpstream: [],
      },
    );
  }
};
