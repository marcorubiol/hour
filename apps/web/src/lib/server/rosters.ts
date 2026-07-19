/**
 * Batched roster resolution for the month performances fetch (calendar v2,
 * ADR-072 §1): who is on each gig, as person ids. Three set-based queries
 * (cast_member by project, cast_override + crew_assignment by performance)
 * instead of N detail bundles, then the same pure combination rule the
 * detail page uses — `rosterPersonIds` in $lib/planner — so month view
 * and detail can never disagree.
 *
 * RLS scopes every query: rosters only contain people the caller's
 * memberships let them see. A performance whose team tables are RLS-hidden
 * comes back with an empty roster — `conflictsFor()` treats that as
 * "no team data" and degrades to 'possible' severity, honestly.
 */

import { rosterPersonIds } from '$lib/planner';
import { pgGet, type SupabaseEnv } from '$lib/supabase';

/**
 * Batch ceiling for the three team queries. A month of performances stays
 * far below it; if a batch ever hits the ceiling the tail would silently
 * drop, so keep it comfortably above reality (200 gigs × a large company).
 */
const BATCH_LIMIT = '10000';

function inList(ids: string[]): string {
  return `in.(${ids.join(',')})`;
}

/**
 * Resolve person_ids[] for a batch of performances. Returns a map keyed by
 * performance id; every requested performance gets an entry (possibly
 * empty). Throws PostgrestError on upstream failures — callers map it.
 */
export async function fetchPerformanceRosters(
  env: SupabaseEnv,
  jwt: string,
  performances: Array<{ id: string; project_id: string }>,
): Promise<Record<string, string[]>> {
  const rosters: Record<string, string[]> = {};
  if (performances.length === 0) return rosters;

  const performanceIds = [...new Set(performances.map((p) => p.id))];
  const projectIds = [...new Set(performances.map((p) => p.project_id))];

  const castSearch = new URLSearchParams();
  castSearch.set('select', 'project_id,person_id');
  castSearch.set('project_id', inList(projectIds));
  castSearch.set('deleted_at', 'is.null');
  castSearch.set('limit', BATCH_LIMIT);

  const overrideSearch = new URLSearchParams();
  overrideSearch.set('select', 'performance_id,person_id,replaces_person_id');
  overrideSearch.set('performance_id', inList(performanceIds));
  overrideSearch.set('deleted_at', 'is.null');
  overrideSearch.set('limit', BATCH_LIMIT);

  const crewSearch = new URLSearchParams();
  crewSearch.set('select', 'performance_id,person_id');
  crewSearch.set('performance_id', inList(performanceIds));
  crewSearch.set('deleted_at', 'is.null');
  crewSearch.set('limit', BATCH_LIMIT);

  const [cast, overrides, crew] = await Promise.all([
    pgGet<{ project_id: string; person_id: string }>(env, 'cast_member', jwt, {
      search: castSearch,
    }),
    pgGet<{ performance_id: string; person_id: string; replaces_person_id: string | null }>(
      env,
      'cast_override',
      jwt,
      { search: overrideSearch },
    ),
    pgGet<{ performance_id: string; person_id: string }>(env, 'crew_assignment', jwt, {
      search: crewSearch,
    }),
  ]);

  const castByProject = new Map<string, string[]>();
  for (const row of cast.data) {
    const list = castByProject.get(row.project_id);
    if (list) list.push(row.person_id);
    else castByProject.set(row.project_id, [row.person_id]);
  }

  const overridesByPerformance = new Map<
    string,
    Array<{ person_id: string; replaces_person_id: string | null }>
  >();
  for (const row of overrides.data) {
    const entry = { person_id: row.person_id, replaces_person_id: row.replaces_person_id };
    const list = overridesByPerformance.get(row.performance_id);
    if (list) list.push(entry);
    else overridesByPerformance.set(row.performance_id, [entry]);
  }

  const crewByPerformance = new Map<string, string[]>();
  for (const row of crew.data) {
    const list = crewByPerformance.get(row.performance_id);
    if (list) list.push(row.person_id);
    else crewByPerformance.set(row.performance_id, [row.person_id]);
  }

  for (const p of performances) {
    rosters[p.id] = rosterPersonIds({
      cast: castByProject.get(p.project_id) ?? [],
      overrides: overridesByPerformance.get(p.id) ?? [],
      crew: crewByPerformance.get(p.id) ?? [],
    });
  }
  return rosters;
}
