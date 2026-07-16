/**
 * Workspace alias requests (ADR-067).
 *
 * POST — owner/admin of a workspace requests a pretty URL alias.
 *        Validation (format + reserved + availability vs live slugs AND
 *        aliases) lives in the request_workspace_alias RPC; a fresh request
 *        supersedes the workspace's previous pending one.
 * GET  — list requests. RLS scopes rows: members see their own workspace's
 *        requests, the platform admin sees all. `?status=pending` filters.
 *
 * Auth: Bearer JWT required. All writes go through SECURITY DEFINER RPCs.
 */

import type { RequestHandler } from './$types';
import * as v from 'valibot';
import { extractAccessToken } from '$lib/auth';
import { pgGet, pgPostRpc, type SupabaseEnv } from '$lib/supabase';
import { pgErrorResponse } from '$lib/server/errors';

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

export type AliasRequestRow = {
  id: string;
  workspace_id: string;
  workspace_name: string;
  alias: string;
  status: 'pending' | 'approved' | 'rejected' | 'superseded';
  requested_by: string;
  created_at: string;
  decided_at: string | null;
  decided_by: string | null;
};

const CreateBodySchema = v.object({
  workspace_id: v.pipe(v.string(), v.uuid()),
  alias: v.pipe(v.string(), v.trim(), v.minLength(1), v.maxLength(64)),
});

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

  try {
    const { data } = await pgPostRpc<AliasRequestRow>(env, 'request_workspace_alias', jwt, {
      p_workspace_id: parsed.output.workspace_id,
      p_alias: parsed.output.alias,
    });
    const request_ = data[0];
    if (!request_) return json({ error: 'rpc_empty_result' }, 502);
    return json({ request: request_ }, 201);
  } catch (err) {
    // 22023 = invalid alias / reserved word, 23505 = taken, 42501 = not owner/admin
    return pgErrorResponse(
      err,
      { route: 'POST /api/workspaces/alias-requests', requestId: locals.requestId },
      {
        codes: {
          '22023': { status: 400, error: 'invalid_alias' },
          '23505': { status: 409, error: 'alias_taken' },
          '42501': { status: 403, error: 'forbidden' },
        },
        passUpstream: [],
      },
    );
  }
};

const QuerySchema = v.object({
  status: v.optional(
    v.picklist(['pending', 'approved', 'rejected', 'superseded'] as const),
  ),
});

export const GET: RequestHandler = async ({ request, url, platform, locals }) => {
  if (!platform?.env) return json({ error: 'platform_unavailable' }, 500);
  const env = platform.env as unknown as SupabaseEnv;

  const jwt = extractAccessToken(request);
  if (!jwt) return json({ error: 'missing_authorization' }, 401);

  const parsed = v.safeParse(QuerySchema, Object.fromEntries(url.searchParams.entries()));
  if (!parsed.success) return json({ error: 'invalid_query' }, 400);

  const search = new URLSearchParams();
  search.set('select', 'id,workspace_id,workspace_name,alias,status,requested_by,created_at,decided_at,decided_by');
  search.set('order', 'created_at.desc');
  search.set('limit', '100');
  if (parsed.output.status) search.set('status', `eq.${parsed.output.status}`);

  try {
    const { data } = await pgGet<AliasRequestRow>(env, 'workspace_alias_request', jwt, { search });
    return json({ items: data });
  } catch (err) {
    return pgErrorResponse(
      err,
      { route: 'GET /api/workspaces/alias-requests', requestId: locals.requestId },
      { passUpstream: [401, 403] },
    );
  }
};
