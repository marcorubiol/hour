/**
 * Shared TanStack query options for the nav data (workspaces + projects +
 * all lines) consumed by the shell ⌘K palette, the scope strip, and the
 * Today/Calendar/Money lenses. Reusing the exact same query keys means every
 * consumer reads one warm cache instead of refetching.
 */

import { fetchJSON } from './api';
import type { NavWorkspace, RawLine, RawProject } from './nav';
import type { TeamItem } from './people';
import type { PerformanceEvent } from './month-events';
import type { AvailabilityItem } from './availability';

/**
 * Nav data (workspaces/projects/lines) changes rarely and its create/edit
 * mutations already invalidate these keys explicitly — so the shell doesn't
 * need the global 30s staleTime, which makes every window refocus refetch all
 * three over RLS'd PostgREST. A 5-minute floor removes that steady background
 * traffic without losing freshness on real changes.
 */
const NAV_STALE_TIME = 5 * 60_000;

export function workspacesQueryOptions() {
  return {
    queryKey: ['workspaces'] as const,
    queryFn: ({ signal }: { signal: AbortSignal }) =>
      fetchJSON<{ items: NavWorkspace[] }>('/api/workspaces', signal),
    staleTime: NAV_STALE_TIME,
  };
}

/** Same key + fetch the project/line detail pages and the create-project
 *  dialog already use — one warm cache across the app. */
export function activeProjectsQueryOptions() {
  return {
    queryKey: ['projects', { status: 'active' }] as const,
    queryFn: ({ signal }: { signal: AbortSignal }) =>
      fetchJSON<{ items: RawProject[] }>('/api/projects?status=active', signal),
    staleTime: NAV_STALE_TIME,
  };
}

export function allLinesQueryOptions() {
  return {
    queryKey: ['lines', 'all'] as const,
    queryFn: ({ signal }: { signal: AbortSignal }) =>
      fetchJSON<{ items: RawLine[] }>('/api/lines?status=any', signal),
    staleTime: NAV_STALE_TIME,
  };
}

/**
 * The team of the given workspaces — the person axis' only name source, and
 * the blackout dialog's person picker.
 *
 * The key was already shared by the planner feed and that dialog, but the
 * query FUNCTION and the row type were copy-pasted into both (one of them
 * carrying a comment admitting it). One warm cache deserves one writer:
 * `project_ids` reached every consumer the moment this became the only place
 * that builds the request.
 *
 * Graceful absence (contract §6): a pre-migration or permission-shy answer
 * comes back `absent` with no rows instead of throwing, so the surfaces that
 * draw people simply stay off. `Unauthorized` still throws — that one is the
 * session, not the feature.
 */
export function teamQueryOptions(workspaceIds: string[], opts?: { enabled?: boolean }) {
  return {
    queryKey: ['planner-team', workspaceIds] as const,
    enabled: (opts?.enabled ?? true) && workspaceIds.length > 0,
    // Nav-shaped, like the other three: rosters change rarely, and a surface
    // that opens on a keystroke cannot afford to start its fetch then.
    staleTime: NAV_STALE_TIME,
    queryFn: async ({ signal }: { signal: AbortSignal }) => {
      try {
        return await fetchJSON<{ items: TeamItem[]; absent?: boolean }>(
          `/api/team?workspace_ids=${workspaceIds.join(',')}`,
          signal,
        );
      } catch (err) {
        if (err instanceof Error && err.message === 'Unauthorized') throw err;
        console.warn('[nav] team feed absent:', err);
        return { items: [] as TeamItem[], absent: true };
      }
    },
  };
}

/** One workspace that holds my dossier — where I exist as a person. */
export type MyDossier = {
  workspace_id: string;
  slug: string;
  full_name: string;
  profile_sync_enabled: boolean;
  profile_shared_fields: string[];
};

/**
 * Which PERSON the signed-in login is (`user_profile.person_id`) and where it
 * has a dossier. `person_id: null` is a normal answer — a login that has
 * never shared its profile is not linked to a person, and the affordances
 * that need one (pin myself, appear in a cast) hide rather than break.
 *
 * Invalidate `['me']` after sharing or unsharing.
 */
export function meQueryOptions() {
  return {
    queryKey: ['me'] as const,
    queryFn: ({ signal }: { signal: AbortSignal }) =>
      fetchJSON<{ person_id: string | null; full_name: string; dossiers: MyDossier[] }>(
        '/api/me',
        signal,
      ),
    staleTime: NAV_STALE_TIME,
  };
}

/**
 * The person axis's feeds, shared by the rail pulse and the Hall so both name
 * the same show (ADR-096: the pulse speaks for you). Today forward with
 * rosters; the availability window reaches back two weeks, like the dates
 * feed, so a block that began earlier still gates today.
 */
export function pulsePerformancesQueryOptions(today: string) {
  return {
    queryKey: ['pulse-performances', today] as const,
    staleTime: 5 * 60_000,
    queryFn: ({ signal }: { signal: AbortSignal }) =>
      fetchJSON<{ items: PerformanceEvent[] }>(
        `/api/performances?status=any&from=${today}&limit=200&rosters=1`,
        signal,
      ),
  };
}

/** Two weeks before `today`: the window the pulse's dates and blocks read. */
export function pulseWindowFrom(today: string): string {
  return new Date(Date.parse(`${today}T00:00:00Z`) - 14 * 86_400_000).toISOString().slice(0, 10);
}

export function pulseAvailabilityQueryOptions(from: string, opts?: { enabled?: boolean }) {
  return {
    queryKey: ['pulse-availability', from] as const,
    enabled: opts?.enabled ?? true,
    staleTime: 5 * 60_000,
    queryFn: async ({ signal }: { signal: AbortSignal }) => {
      try {
        return await fetchJSON<{ items: AvailabilityItem[] }>(
          `/api/availability?from=${from}&limit=500`,
          signal,
        );
      } catch (err) {
        if (err instanceof Error && err.message === 'Unauthorized') throw err;
        return { items: [] as AvailabilityItem[] };
      }
    },
  };
}
