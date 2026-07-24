/**
 * Planner event feeds — the query-construction layer of /h/planner.
 *
 * `createPlannerFeeds` builds every TanStack query the planner reads:
 * the single-month grid feeds (performances, dates, availability), the
 * cross-workspace team feed, the 90-day decisions window and the
 * multi-month agenda feeds. It MUST be called synchronously from the
 * page's component init so the query-client context resolves, and every
 * reactive input arrives as a GETTER — the option builders call them
 * inside `toStore`, so the queries keep tracking the page's `$state`/
 * `$derived` across the module boundary.
 */
import { createQuery } from '@tanstack/svelte-query';
import { toStore } from 'svelte/store';
import { fetchJSON } from '$lib/api';
import { addDaysIso, type PlannerView } from '$lib/planner';
import type { AvailabilityItem } from '$lib/availability';
import type { DateEvent, PerformanceEvent } from '$lib/month-events';

export type TeamItem = {
  person_id: string;
  workspace_id: string;
  slug: string;
  full_name: string;
};
export type DecisionPerfItem = PerformanceEvent & { hold_notice_days?: number | null };

// The API's hard cap on ?limit (maxValue in its QuerySchema) — one page.
const FEED_LIMIT = 200;

// ── Decisions window (ADR-080 §4) — cross-month: holds live in
// [today, today+90d], not just the visible month. ─────────────────────
const DECISIONS_WINDOW_DAYS = 90;

function feedParams(
  k: { projectIds: string[]; workspaceIds: string[] },
  from: string,
  to: string,
): string {
  const params = new URLSearchParams();
  params.set('from', from);
  params.set('to', to);
  if (k.projectIds.length > 0) params.set('project_ids', k.projectIds.join(','));
  if (k.workspaceIds.length > 0) params.set('workspace_ids', k.workspaceIds.join(','));
  params.set('limit', String(FEED_LIMIT));
  return params.toString();
}

// Both agenda row feeds page past the API's 200-row cap with the same
// day-cursor loop the decisions window uses — `pagedFeed` factors it out.
async function pagedFeed<T extends { id: string }>(
  urlFor: (from: string) => string,
  cursorDay: (row: T) => string,
  from: string,
  signal: AbortSignal,
): Promise<{ items: T[] }> {
  const seen = new Set<string>();
  const items: T[] = [];
  let cursor = from;
  for (;;) {
    const batch = await fetchJSON<{ items: T[] }>(urlFor(cursor), signal);
    for (const it of batch.items) {
      if (!seen.has(it.id)) {
        seen.add(it.id);
        items.push(it);
      }
    }
    if (batch.items.length < FEED_LIMIT) break;
    const lastDay = cursorDay(batch.items[batch.items.length - 1]);
    // A single day carrying a full page cannot advance the cursor — stop.
    if (lastDay === cursor) break;
    cursor = lastDay;
  }
  return { items };
}

export interface PlannerFeedInputs {
  /** Active projection — the agenda swaps the grid feeds for its own. */
  view: () => PlannerView;
  /** Month-grid window (first/last visible cell, ISO days). */
  gridFrom: () => string;
  gridTo: () => string;
  /** Agenda book window (multi-month, independent of the grid). */
  agendaFrom: () => string;
  agendaTo: () => string;
  /** Pins exist but their caches haven't resolved ids yet — hold feeds. */
  scopeUnresolved: () => boolean;
  /** Scope filter the endpoints understand (project_ids ∪ workspace_ids). */
  filterIds: () => { projectIds: string[]; workspaceIds: string[] };
  /** Every visible workspace id — the team feed's fan-out. */
  teamWorkspaceIds: () => string[];
  /** Viewer-tz day key for "today" — constant for the page's lifetime. */
  todayIso: string;
}

export function createPlannerFeeds(inputs: PlannerFeedInputs) {
  const decisionsTo = addDaysIso(inputs.todayIso, DECISIONS_WINDOW_DAYS);

  // ── Event feeds ──────────────────────────────────────────────────────
  const feedKey = $derived({
    from: inputs.gridFrom(),
    to: inputs.gridTo(),
    unresolved: inputs.scopeUnresolved(),
    ...inputs.filterIds(),
  });

  const perfOptions = toStore(() => {
    const k = feedKey;
    return {
      queryKey: ['planner-performances', k] as const,
      // Agenda has its own multi-month feed (below); don't double-fetch the
      // grid window while it is showing.
      enabled: inputs.view() !== 'agenda' && !k.unresolved,
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        fetchJSON<{ items: PerformanceEvent[] }>(
          `/api/performances?status=any&rosters=1&${feedParams(k, k.from, k.to)}`,
          signal,
        ),
    };
  });
  // The dates window is padded ±1 day: `date` rows are timestamptz and get
  // bucketed into their venue's (or the viewer's) day, which can fall
  // outside the UTC-bounded fetch window at the grid edges. Off-grid
  // buckets simply find no cell.
  const datesOptions = toStore(() => {
    const k = feedKey;
    return {
      queryKey: ['planner-dates', k] as const,
      enabled: inputs.view() !== 'agenda' && !k.unresolved,
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        fetchJSON<{ items: DateEvent[] }>(
          `/api/dates?${feedParams(k, addDaysIso(k.from, -1), addDaysIso(k.to, 1))}`,
          signal,
        ),
    };
  });
  // Blackouts — NO workspace filter: the engine wants every block RLS lets
  // through (a shared person's block from another space still collides,
  // ADR-078 §5). Graceful absence (contract §6): a pre-migration DB 502s —
  // render no blackouts, surface nothing. The `absent` marker is what
  // hides the blackout-creation entry points (no write UI over a missing
  // table).
  const availabilityOptions = toStore(() => {
    const k = feedKey;
    return {
      queryKey: ['planner-availability', { from: k.from, to: k.to }] as const,
      enabled: inputs.view() !== 'agenda' && !k.unresolved,
      queryFn: async ({ signal }: { signal: AbortSignal }) => {
        try {
          return await fetchJSON<{ items: AvailabilityItem[]; absent?: boolean }>(
            `/api/availability?from=${k.from}&to=${k.to}&limit=500`,
            signal,
          );
        } catch (err) {
          if (err instanceof Error && err.message === 'Unauthorized') throw err;
          console.warn('[calendar] availability feed absent:', err);
          return { items: [] as AvailabilityItem[], absent: true };
        }
      },
    };
  });
  // Team of every visible workspace — person names for clash cards and
  // rail labels. Works against the live DB today; still fails quiet.
  const teamOptions = toStore(() => {
    const ids = inputs.teamWorkspaceIds();
    return {
      queryKey: ['planner-team', ids] as const,
      enabled: ids.length > 0,
      queryFn: async ({ signal }: { signal: AbortSignal }) => {
        try {
          return await fetchJSON<{ items: TeamItem[]; absent?: boolean }>(
            `/api/team?workspace_ids=${ids.join(',')}`,
            signal,
          );
        } catch (err) {
          if (err instanceof Error && err.message === 'Unauthorized') throw err;
          console.warn('[calendar] team feed absent:', err);
          return { items: [] as TeamItem[], absent: true };
        }
      },
    };
  });

  // ── Decisions window (ADR-080 §4) — same scope filter as the month
  // feed; ?notice=1 opts into hold_notice_days (ADR-080 §2) and is what
  // exposes this fetch to a pre-migration DB — so it degrades to `absent`
  // (contract § Graceful absence: band + decision segments of the pulse
  // simply stay off, zero errors surfaced). ─────────────────────────────
  const decisionsPerfOptions = toStore(() => {
    const k = feedKey;
    return {
      // Same family as the month feed on purpose: one optimistic write
      // (setQueriesData over the prefix) and one invalidate reach both.
      queryKey: [
        'calendar-performances',
        {
          window: 'decisions',
          unresolved: k.unresolved,
          projectIds: k.projectIds,
          workspaceIds: k.workspaceIds,
        },
      ] as const,
      enabled: !k.unresolved,
      queryFn: async ({
        signal,
      }: {
        signal: AbortSignal;
      }): Promise<{ items: DecisionPerfItem[]; absent?: boolean }> => {
        try {
          // The API caps `limit` at 200 — sized for a one-month grid,
          // while this window spans 90 days across the whole scope. Page
          // with a day cursor (rows arrive performed_at.asc; the boundary
          // day is re-fetched and deduped) so the queue and the pulse's
          // "per decidir" never under-report silently (ADR-080 §1/§6:
          // every figure maps to fetched rows — ALL of them).
          const seen = new Set<string>();
          const items: DecisionPerfItem[] = [];
          let from = inputs.todayIso;
          for (;;) {
            const batch = await fetchJSON<{ items: DecisionPerfItem[] }>(
              `/api/performances?status=any&rosters=1&notice=1&${feedParams(k, from, decisionsTo)}`,
              signal,
            );
            for (const it of batch.items) {
              if (!seen.has(it.id)) {
                seen.add(it.id);
                items.push(it);
              }
            }
            if (batch.items.length < FEED_LIMIT) break;
            const lastDay = batch.items[batch.items.length - 1].performed_at.slice(0, 10);
            // A single day carrying a full page cannot advance the cursor
            // — stop rather than loop (implausible at this scale).
            if (lastDay === from) break;
            from = lastDay;
          }
          return { items };
        } catch (err) {
          if (err instanceof Error && err.message === 'Unauthorized') throw err;
          console.warn('[calendar] decisions feed absent:', err);
          return { items: [] as DecisionPerfItem[], absent: true };
        }
      },
    };
  });
  // No availability feed for this window: blackouts only ever yield
  // single-event severities, which decisionsFor cannot consume (pairs
  // only) — it doesn't take them as input.

  // ── Agenda feed (multi-month) ─────────────────────────────────────────
  // The agenda book spans many months, so it owns its OWN window instead of
  // the single-month grid feeds above (which stay untouched for Month/
  // Carrils).
  const agendaFeedKey = $derived({
    from: inputs.agendaFrom(),
    to: inputs.agendaTo(),
    unresolved: inputs.scopeUnresolved(),
    ...inputs.filterIds(),
  });
  const agendaPerfOptions = toStore(() => {
    const k = agendaFeedKey;
    return {
      queryKey: ['planner-agenda-performances', k] as const,
      enabled: inputs.view() === 'agenda' && !k.unresolved,
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        pagedFeed<PerformanceEvent>(
          (from) => `/api/performances?status=any&rosters=1&${feedParams(k, from, k.to)}`,
          (p) => p.performed_at.slice(0, 10),
          k.from,
          signal,
        ),
    };
  });
  const agendaDatesOptions = toStore(() => {
    const k = agendaFeedKey;
    return {
      queryKey: ['planner-agenda-dates', k] as const,
      enabled: inputs.view() === 'agenda' && !k.unresolved,
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        pagedFeed<DateEvent>(
          // Same ±1-day pad as the grid dates feed (tz bucketing at edges).
          (from) => `/api/dates?${feedParams(k, addDaysIso(from, -1), addDaysIso(k.to, 1))}`,
          (d) => d.starts_at.slice(0, 10),
          k.from,
          signal,
        ),
    };
  });
  const agendaAvailabilityOptions = toStore(() => {
    const k = agendaFeedKey;
    return {
      queryKey: ['planner-agenda-availability', { from: k.from, to: k.to }] as const,
      enabled: inputs.view() === 'agenda' && !k.unresolved,
      queryFn: async ({ signal }: { signal: AbortSignal }) => {
        try {
          return await fetchJSON<{ items: AvailabilityItem[]; absent?: boolean }>(
            `/api/availability?from=${k.from}&to=${k.to}&limit=500`,
            signal,
          );
        } catch (err) {
          if (err instanceof Error && err.message === 'Unauthorized') throw err;
          console.warn('[calendar] agenda availability feed absent:', err);
          return { items: [] as AvailabilityItem[], absent: true };
        }
      },
    };
  });

  return {
    perfQuery: createQuery(perfOptions),
    datesQuery: createQuery(datesOptions),
    availabilityQuery: createQuery(availabilityOptions),
    teamQuery: createQuery(teamOptions),
    decisionsPerfQuery: createQuery(decisionsPerfOptions),
    agendaPerfQuery: createQuery(agendaPerfOptions),
    agendaDatesQuery: createQuery(agendaDatesOptions),
    agendaAvailabilityQuery: createQuery(agendaAvailabilityOptions),
  };
}
