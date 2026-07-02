/**
 * Road sheet public share links (ADR-047, D6). A share pins a performance
 * + a public role; the token opens `/public/roadsheet/:token` with no
 * account. Management is RPC-only — `roadsheet_share` is deny-all even
 * for authenticated, so the token never travels through PostgREST table
 * reads; both RPCs gate on `edit:show`.
 *
 * GET  → active shares for the performance (token included: the operator
 *        needs it to build/copy the URL — it is not a secret FROM them).
 * POST → { role: venue|performer|tech_manager } → 201 with the new share.
 */

import type { RequestHandler } from './$types';
import * as v from 'valibot';
import { extractBearer } from '$lib/auth';
import { resolvePerformanceId } from '$lib/server/performance-bundle';
import { pgPostRpc, PostgrestError, type SupabaseEnv } from '$lib/supabase';

const BodySchema = v.object({
  role: v.picklist(['venue', 'performer', 'tech_manager']),
});

type ShareRow = {
  id: string;
  token: string;
  role: string;
  created_at: string;
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

function mapShare(s: ShareRow) {
  return { id: s.id, token: s.token, role: s.role, created_at: s.created_at };
}

function mapError(err: unknown): Response {
  if (err instanceof PostgrestError) {
    // Both "performance not found" and "edit:show required" surface as
    // 42501 from the RPC — indistinguishable by design.
    if (err.code === '42501') return json({ error: 'forbidden_or_not_found' }, 403);
    if (err.code === '22023') return json({ error: 'invalid_input', detail: err.body }, 400);
    const upstream = err.status === 401 ? 401 : 502;
    return json({ error: 'postgrest_error', status: err.status, detail: err.body }, upstream);
  }
  return json({ error: 'unexpected', detail: String(err) }, 500);
}

export const GET: RequestHandler = async ({ request, params, url, platform }) => {
  if (!platform?.env) return json({ error: 'platform_unavailable' }, 500);
  const env = platform.env as unknown as SupabaseEnv;

  const jwt = extractBearer(request);
  if (!jwt) return json({ error: 'missing_authorization' }, 401);

  try {
    const id = await resolvePerformanceId(env, jwt, params.key, url.searchParams.get('ws'));
    if (!id) return json({ error: 'not_found' }, 404);

    const { data } = await pgPostRpc<ShareRow>(env, 'list_roadsheet_shares', jwt, {
      p_performance_id: id,
    });
    return json({ items: data.filter(Boolean).map(mapShare) });
  } catch (err) {
    return mapError(err);
  }
};

export const POST: RequestHandler = async ({ request, params, url, platform }) => {
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
  const parsed = v.safeParse(BodySchema, raw);
  if (!parsed.success) {
    return json({ error: 'invalid_body', hint: 'role ∈ venue | performer | tech_manager.' }, 400);
  }

  try {
    const id = await resolvePerformanceId(env, jwt, params.key, url.searchParams.get('ws'));
    if (!id) return json({ error: 'not_found' }, 404);

    const { data } = await pgPostRpc<ShareRow>(env, 'create_roadsheet_share', jwt, {
      p_performance_id: id,
      p_role: parsed.output.role,
    });
    if (data.length === 0 || !data[0]) return json({ error: 'create_failed' }, 502);
    return json({ share: mapShare(data[0]) }, 201);
  } catch (err) {
    return mapError(err);
  }
};
