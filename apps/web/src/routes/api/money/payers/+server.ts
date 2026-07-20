/** GET /api/money/payers — relevant conversation people the caller may invoice. */

import type { RequestHandler } from './$types';
import * as v from 'valibot';
import { extractAccessToken } from '$lib/auth';
import type { MoneyPayer } from '$lib/money';
import { pgPostRpc, type SupabaseEnv } from '$lib/supabase';
import { pgErrorResponse } from '$lib/server/errors';

const QuerySchema = v.object({
  project_ids: v.optional(v.string()),
  workspace_ids: v.optional(v.string()),
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
  return [...new Set(raw.split(',').map((value) => value.trim()).filter((value) => UUID.test(value)))];
}

export const GET: RequestHandler = async ({ request, url, platform, locals }) => {
  if (!platform?.env) return json({ error: 'platform_unavailable' }, 500);
  const env = platform.env as unknown as SupabaseEnv;
  const jwt = extractAccessToken(request);
  if (!jwt) return json({ error: 'missing_authorization' }, 401);

  const parsed = v.safeParse(QuerySchema, Object.fromEntries(url.searchParams.entries()));
  if (!parsed.success) return json({ error: 'invalid_query' }, 400);
  const projectIds = parseUuidList(parsed.output.project_ids);
  const workspaceIds = parseUuidList(parsed.output.workspace_ids);

  try {
    const { data } = await pgPostRpc<MoneyPayer>(env, 'list_money_payers', jwt, {
      p_project_ids: projectIds.length > 0 ? projectIds : null,
      p_workspace_ids: workspaceIds.length > 0 ? workspaceIds : null,
      p_limit: 500,
    });
    return json({ items: data });
  } catch (err) {
    return pgErrorResponse(
      err,
      { route: 'GET /api/money/payers', requestId: locals.requestId },
      { passUpstream: [401, 403] },
    );
  }
};
