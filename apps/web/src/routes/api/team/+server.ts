/**
 * GET /api/team?workspace_ids=uuid,uuid,...
 *
 * The workspaces' active TEAM: distinct persons appearing in
 * `cast_member` ∪ `crew_assignment` ∪ a «voy» in `commitment_person`
 * (ADR-107; deduped per workspace), with the
 * person's name for the select label. Feeds the blackout dialog's person
 * picker (ADR-078 §5): the team, NOT the contact book — a workspace's
 * person table can hold hundreds of programmers who are not "us".
 *
 * Person embeds come from each workspace's own dossier and ride an inner
 * join, so deleted or RLS-hidden dossiers drop the row instead of yielding
 * a nameless entry.
 *
 * `project_ids` — the projects each person is on file for — is what makes
 * the person axis possible at all. A `date` row (rehearsal, travel, press)
 * carries NO people: there is no date↔person table, so the only honest way
 * to say whose rehearsal it is, is to infer it from the project's canonical
 * cast and mark the answer as an inference (`$lib/people`). This field is
 * that pool. One row per person per workspace still, so the field is
 * additive: the blackout picker sees exactly what it saw before.
 *
 * Auth: Bearer JWT required. RLS scopes rows (workspace membership) — and
 * the roster tables gate on `read:performance`, not on an edit permission,
 * so a performer assigned to a project can read the cast they are in.
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
  /** cast_member carries the project outright. */
  project_id?: string | null;
  /** crew_assignment reaches it through its performance. */
  performance?: { project_id: string | null } | null;
};

export type TeamItem = {
  person_id: string;
  workspace_id: string;
  slug: string;
  full_name: string;
  /** Projects this person is on file for, in this workspace. */
  project_ids: string[];
};

const TEAM_SELECT =
  'workspace_id,project_id,person:workspace_person!cast_member_workspace_person_fkey!inner(id:person_id,slug,full_name)';
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

  const makeSearch = (source: 'cast' | 'crew') => {
    const search = new URLSearchParams();
    search.set(
      'select',
      source === 'cast'
        ? TEAM_SELECT
        : // The performance embed is a LEFT join on purpose: a crew row whose
          // performance is hidden still proves the person is on this team, and
          // dropping them would quietly shrink the blackout picker. They just
          // arrive without that project in their list.
          'workspace_id,performance:performance_id(project_id),person:workspace_person!crew_assignment_workspace_person_fkey!inner(id:person_id,slug,full_name)',
    );
    search.set('workspace_id', `in.(${workspaceIds.join(',')})`);
    search.set('deleted_at', 'is.null');
    search.set('person.deleted_at', 'is.null');
    search.set('limit', BATCH_LIMIT);
    return search;
  };

  try {
    // ADR-107: whoever said «voy» to a performance or a date is on the team
    // too (somebody added from «quién va» has no cast row). The word adds
    // the person, never a project: `project_ids` is the pool inferences
    // draw from, and a «voy» to one rehearsal is not the cast.
    const goingSearch = new URLSearchParams({
      select: 'workspace_id,person_id',
      workspace_id: `in.(${workspaceIds.join(',')})`,
      state: 'eq.going',
      limit: BATCH_LIMIT,
    });
    const [cast, crew, going] = await Promise.all([
      pgGet<TeamSourceRow>(env, 'cast_member', jwt, { search: makeSearch('cast') }),
      pgGet<TeamSourceRow>(env, 'crew_assignment', jwt, { search: makeSearch('crew') }),
      pgGet<{ workspace_id: string; person_id: string }>(env, 'commitment_person', jwt, {
        search: goingSearch,
      }),
    ]);

    const seen = new Map<string, TeamItem>();
    const projects = new Map<string, Set<string>>();
    for (const row of [...cast.data, ...crew.data]) {
      if (!row.person) continue;
      const key = `${row.workspace_id}:${row.person.id}`;
      if (!seen.has(key)) {
        seen.set(key, {
          person_id: row.person.id,
          workspace_id: row.workspace_id,
          slug: row.person.slug,
          full_name: row.person.full_name,
          project_ids: [],
        });
        projects.set(key, new Set<string>());
      }
      // A person appears once per workspace but can arrive several times —
      // one row per project they are cast in, plus one per gig they crew. The
      // identity dedupes; the projects accumulate.
      const projectId = row.project_id ?? row.performance?.project_id ?? null;
      if (projectId) projects.get(key)!.add(projectId);
    }
    const missing = going.data.filter((g) => !seen.has(`${g.workspace_id}:${g.person_id}`));
    if (missing.length > 0) {
      const ids = [...new Set(missing.map((g) => g.person_id))];
      const dossiers = await pgGet<{ workspace_id: string; person_id: string; slug: string; full_name: string }>(
        env,
        'workspace_person',
        jwt,
        {
          search: new URLSearchParams({
            select: 'workspace_id,person_id,slug,full_name',
            workspace_id: `in.(${workspaceIds.join(',')})`,
            person_id: `in.(${ids.join(',')})`,
            deleted_at: 'is.null',
            limit: BATCH_LIMIT,
          }),
        },
      );
      for (const d of dossiers.data) {
        const key = `${d.workspace_id}:${d.person_id}`;
        if (seen.has(key) || !missing.some((g) => `${g.workspace_id}:${g.person_id}` === key)) continue;
        seen.set(key, {
          person_id: d.person_id,
          workspace_id: d.workspace_id,
          slug: d.slug,
          full_name: d.full_name,
          project_ids: [],
        });
      }
    }
    for (const [key, item] of seen) {
      item.project_ids = [...(projects.get(key) ?? [])].sort();
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
