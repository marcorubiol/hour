/**
 * GET /api/dates/labels?workspace_ids=uuid,uuid,...
 *
 * Distinct non-null `custom_fields->>'label'` values across the given
 * workspaces' date rows — the autocomplete corpus for the "Altres" free
 * label (ADR-078 §8). The label vocabulary IS the usage history: no
 * vocabulary table, no management surface; dedup happens here (PostgREST
 * has no DISTINCT) over a cheap two-column scan.
 *
 * Auth: Bearer JWT required. RLS scopes rows.
 */

import type { RequestHandler } from './$types';
import * as v from 'valibot';
import { extractAccessToken } from '$lib/auth';
import { pgGet, type SupabaseEnv } from '$lib/supabase';
import { pgErrorResponse } from '$lib/server/errors';

const QuerySchema = v.object({
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
    return json({ error: 'invalid_query' }, 400);
  }
  const workspaceIds = parseUuidList(parsed.output.workspace_ids);
  if (workspaceIds.length === 0) {
    return json({ error: 'invalid_query', hint: 'Pass workspace_ids.' }, 400);
  }

  const search = new URLSearchParams();
  search.set('select', 'label:custom_fields->>label');
  search.set('workspace_id', `in.(${workspaceIds.join(',')})`);
  search.set('deleted_at', 'is.null');
  search.set('custom_fields->>label', 'not.is.null');
  search.set('limit', '2000');

  try {
    const { data } = await pgGet<{ label: string | null }>(env, 'date', jwt, { search });
    const labels = [
      ...new Set(data.map((r) => r.label).filter((l): l is string => Boolean(l))),
    ].sort((a, b) => a.localeCompare(b));
    return json({ labels });
  } catch (err) {
    return pgErrorResponse(
      err,
      { route: 'GET /api/dates/labels', requestId: locals.requestId },
      { passUpstream: [401, 403] },
    );
  }
};
