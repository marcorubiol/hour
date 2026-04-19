/**
 * GET /api/prospects
 *
 * Thin wrapper over the `prospect_list` SQL function. All heavy lifting
 * (joins, tag aggregation, pagination total via window) lives in the RPC so
 * this route stays small and easy to review.
 *
 * Query params (all optional):
 *   status         contact_project_status (default: prospect)
 *   project_slug   project slug (default: difusion-2026-27)
 *   limit          1..100 (default: 50)
 *   offset         >= 0   (default: 0)
 *
 * Auth: Bearer JWT required. RLS + `current_org_id()` decide what is visible.
 */

import type { APIRoute } from 'astro';
import { extractBearer } from '../../lib/auth.ts';
import type { Enum, RpcArgs, RpcReturn } from '../../lib/db-types.ts';
import { pgPostRpc, PostgrestError, type SupabaseEnv } from '../../lib/supabase.ts';

export const prerender = false;

// Enum values come straight from the generated types.
const ALLOWED_STATUSES: ReadonlyArray<Enum<'contact_project_status'>> = [
  'prospect',
  'contacted',
  'proposal_sent',
  'negotiating',
  'booked',
  'confirmed',
  'done',
  'lost',
];
const ALLOWED_STATUSES_SET = new Set<string>(ALLOWED_STATUSES);

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

type RpcRow = RpcReturn<'prospect_list'>[number];

export const GET: APIRoute = async ({ request, locals, url }) => {
  const env = (locals as unknown as { runtime: { env: SupabaseEnv } }).runtime.env;

  const jwt = extractBearer(request);
  if (!jwt) {
    return json(
      { error: 'missing_authorization', hint: 'Send Authorization: Bearer <supabase_jwt>.' },
      401,
    );
  }

  const rawStatus = url.searchParams.get('status') ?? 'prospect';
  if (!ALLOWED_STATUSES_SET.has(rawStatus)) {
    return json({ error: 'invalid_status', allowed: [...ALLOWED_STATUSES] }, 400);
  }
  const status = rawStatus as Enum<'contact_project_status'>;
  const projectSlug = url.searchParams.get('project_slug') ?? 'difusion-2026-27';
  const limit = Math.min(Math.max(Number(url.searchParams.get('limit') ?? 50), 1), 100);
  const offset = Math.max(Number(url.searchParams.get('offset') ?? 0), 0);

  try {
    const args: RpcArgs<'prospect_list'> = {
      p_project_slug: projectSlug,
      p_status: status,
      p_limit: limit,
      p_offset: offset,
    };
    const { data } = await pgPostRpc<RpcRow>(env, 'prospect_list', jwt, args);

    const total = data[0]?.total_count ?? 0;
    const items = data.map(({ total_count: _t, ...rest }) => rest);

    return json({ total, limit, offset, project_slug: projectSlug, status, items });
  } catch (err) {
    if (err instanceof PostgrestError) {
      const upstream = err.status === 401 || err.status === 403 ? err.status : 502;
      return json({ error: 'postgrest_error', status: err.status, detail: err.body }, upstream);
    }
    return json({ error: 'unexpected', detail: String(err) }, 500);
  }
};
