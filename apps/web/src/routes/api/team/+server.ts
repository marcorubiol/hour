/**
 * GET /api/team?workspace_ids=uuid,uuid,...
 *
 * The workspaces' active TEAM: distinct persons appearing in
 * `cast_member` ∪ `crew_assignment` (deduped per workspace), with the
 * person's name for the select label. Feeds the blackout dialog's person
 * picker (ADR-078 §5): the team, NOT the contact book — a workspace's
 * person table can hold hundreds of programmers who are not "us".
 *
 * Person embeds ride an inner join filtered on person.deleted_at, so
 * deleted or RLS-hidden persons drop the row instead of yielding a
 * nameless entry.
 *
 * Auth: Bearer JWT required. RLS scopes rows (workspace membership).
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

type TeamSourceRow = {
  workspace_id: string;
  person: { id: string; slug: string; full_name: string };
};

export type TeamItem = {
  person_id: string;
  workspace_id: string;
  slug: string;
  full_name: string;
};

const TEAM_SELECT = 'workspace_id,person:person_id!inner(id,slug,full_name)';
const BATCH_LIMIT = '10000';

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

  const makeSearch = () => {
    const search = new URLSearchParams();
    search.set('select', TEAM_SELECT);
    search.set('workspace_id', `in.(${workspaceIds.join(',')})`);
    search.set('deleted_at', 'is.null');
    search.set('person.deleted_at', 'is.null');
    search.set('limit', BATCH_LIMIT);
    return search;
  };

  try {
    const [cast, crew] = await Promise.all([
      pgGet<TeamSourceRow>(env, 'cast_member', jwt, { search: makeSearch() }),
      pgGet<TeamSourceRow>(env, 'crew_assignment', jwt, { search: makeSearch() }),
    ]);

    const seen = new Map<string, TeamItem>();
    for (const row of [...cast.data, ...crew.data]) {
      if (!row.person) continue;
      const key = `${row.workspace_id}:${row.person.id}`;
      if (!seen.has(key)) {
        seen.set(key, {
          person_id: row.person.id,
          workspace_id: row.workspace_id,
          slug: row.person.slug,
          full_name: row.person.full_name,
        });
      }
    }
    const items = [...seen.values()].sort((a, b) => a.full_name.localeCompare(b.full_name));
    return json({ items });
  } catch (err) {
    return pgErrorResponse(
      err,
      { route: 'GET /api/team', requestId: locals.requestId },
      { passUpstream: [401, 403] },
    );
  }
};
