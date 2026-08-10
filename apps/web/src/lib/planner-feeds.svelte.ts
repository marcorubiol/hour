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
import { createQuery, type QueryClient } from '@tanstack/svelte-query';
import { toStore } from 'svelte/store';
import { fetchJSON } from '$lib/api';
import { addDaysIso, type PlannerView } from '$lib/planner';
import { teamQueryOptions } from '$lib/nav-queries';
import type { AvailabilityItem } from '$lib/availability';
import type { DateEvent, NoteEvent, PerformanceEvent } from '$lib/month-events';
import type { TeamItem } from '$lib/people';

/** Canonical in $lib/people; re-exported so existing importers keep working. */
export type { TeamItem };
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

/**
 * Pre-seed the agenda caches for a WINDOW ABOUT TO EXIST (2026-08-03).
 *
 * The probes JUMP the window — back to where history begins, forward over
 * gaps to the next planned month — and a window change renders at once
 * while its feed refetches, so the jumped-to months flashed EMPTY, the
 * book dimmed, and the rows popped in under the reader a beat later:
 * three visual hits that read as an error. Fetching just the missing
 * stretch and seeding the coming window's keys means the window only
 * moves once its rows are in hand — one render, fully formed, `isLoading`
 * never true (the query wakes up already fed), and the background refetch
 * confirms silently. Availability bands still arrive on their own beat:
 * additive lines, not layout.
 */
export async function primeAgendaWindow(
  queryClient: QueryClient,
  args: {
    newFrom: string;
    newTo: string;
    oldFrom: string;
    oldTo: string;
    unresolved: boolean;
    filterIds: { projectIds: string[]; workspaceIds: string[] };
  },
): Promise<void> {
  const { newFrom, newTo, oldFrom, oldTo, unresolved, filterIds } = args;
  const stretches: Array<[string, string]> = [];
  if (newFrom < oldFrom) stretches.push([newFrom, addDaysIso(oldFrom, -1)]);
  if (newTo > oldTo) stretches.push([addDaysIso(oldTo, 1), newTo]);
  if (stretches.length === 0) return;

  const signal = new AbortController().signal;
  const perfs: PerformanceEvent[] = [];
  const dates: DateEvent[] = [];
  const notes: NoteEvent[] = [];
  for (const [f, t] of stretches) {
    const [p, d, n] = await Promise.all([
      pagedFeed<PerformanceEvent>(
        (from) =>
          `/api/performances?status=any&rosters=1&notice=1&${feedParams(filterIds, from, t)}`,
        (r) => r.performed_at.slice(0, 10),
        f,
        signal,
      ),
      pagedFeed<DateEvent>(
        // Same ±1-day pad as the live feed (tz bucketing at the edges).
        (from) => `/api/dates?${feedParams(filterIds, addDaysIso(from, -1), addDaysIso(t, 1))}`,
        (r) => r.starts_at.slice(0, 10),
        f,
        signal,
      ),
      fetchJSON<{ items: NoteEvent[] }>(`/api/notes?from=${f}&to=${t}`, signal).catch(() => ({
        items: [] as NoteEvent[],
      })),
    ]);
    perfs.push(...p.items);
    dates.push(...d.items);
    notes.push(...n.items);
  }

  const merge = <T extends { id: string }>(a: T[], b: T[]): T[] => {
    const seen = new Set<string>();
    const out: T[] = [];
    for (const it of [...a, ...b]) {
      if (!seen.has(it.id)) {
        seen.add(it.id);
        out.push(it);
      }
    }
    return out;
  };
  const oldKey = { from: oldFrom, to: oldTo, unresolved, ...filterIds };
  const newKey = { from: newFrom, to: newTo, unresolved, ...filterIds };
  const curP =
    queryClient.getQueryData<{ items: PerformanceEvent[] }>([
      'planner-agenda-performances',
      oldKey,
    ])?.items ?? [];
  const curD =
    queryClient.getQueryData<{ items: DateEvent[] }>(['planner-agenda-dates', oldKey])?.items ??
    [];
  const curN =
    queryClient.getQueryData<{ items: NoteEvent[] }>([
      'planner-agenda-notes',
      { from: oldFrom, to: oldTo },
    ])?.items ?? [];
  queryClient.setQueryData(['planner-agenda-performances', newKey], { items: merge(curP, perfs) });
  queryClient.setQueryData(['planner-agenda-dates', newKey], { items: merge(curD, dates) });
  queryClient.setQueryData(['planner-agenda-notes', { from: newFrom, to: newTo }], {
    items: merge(curN, notes),
  });
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
  /** The Day view's selected day — its notes band reads exactly one day. */
  selectedDay: () => string;
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
      enabled: inputs.view() !== 'agenda' && inputs.view() !== 'board' && !k.unresolved,
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        fetchJSON<{ items: PerformanceEvent[] }>(
          `/api/performances?status=any&rosters=1&notice=1&${feedParams(k, k.from, k.to)}`,
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
      enabled: inputs.view() !== 'agenda' && inputs.view() !== 'board' && !k.unresolved,
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
      enabled: inputs.view() !== 'agenda' && inputs.view() !== 'board' && !k.unresolved,
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
  // Team of every visible workspace — person names for clash cards and rail
  // labels, and the project pool the person axis infers from. One builder in
  // $lib/nav-queries, shared with the shell and the blackout dialog.
  const teamOptions = toStore(() => teamQueryOptions(inputs.teamWorkspaceIds()));

  // ── Decisions window (ADR-080 §4) — same scope filter as the month
  // feed; ?notice=1 opts into hold_notice_days (ADR-080 §2) and is what
  // exposes this fetch to a pre-migration DB — so it degrades to `absent`
  // (contract § Graceful absence: band + decision segments of the stats strip
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
          // day is re-fetched and deduped) so the queue and the strip's
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
      enabled: (inputs.view() === 'agenda' || inputs.view() === 'board') && !k.unresolved,
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        pagedFeed<PerformanceEvent>(
          (from) => `/api/performances?status=any&rosters=1&notice=1&${feedParams(k, from, k.to)}`,
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
      enabled: (inputs.view() === 'agenda' || inputs.view() === 'board') && !k.unresolved,
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
      enabled: (inputs.view() === 'agenda' || inputs.view() === 'board') && !k.unresolved,
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

  // My post-its across the book's window (ADR-093). NO scope filter, on
  // purpose: the pins narrow the company's calendar, and a note is not the
  // company's — it is the author's marginalia, and hiding your own note
  // because a project fell out of scope reads as losing it. Graceful
  // absence (contract §6): a pre-migration DB 404s the feed — the margin
  // reads empty and the `absent` marker hides the writer.
  const agendaNotesOptions = toStore(() => {
    const k = agendaFeedKey;
    return {
      queryKey: ['planner-agenda-notes', { from: k.from, to: k.to }] as const,
      enabled: inputs.view() === 'agenda',
      queryFn: async ({ signal }: { signal: AbortSignal }) => {
        try {
          return await fetchJSON<{ items: NoteEvent[]; absent?: boolean }>(
            `/api/notes?from=${k.from}&to=${k.to}`,
            signal,
          );
        } catch (err) {
          if (err instanceof Error && err.message === 'Unauthorized') throw err;
          console.warn('[calendar] notes feed absent:', err);
          return { items: [] as NoteEvent[], absent: true };
        }
      },
    };
  });

  // The Day's post-its — one day, mine, same graceful absence as the
  // agenda's margin (a pre-migration DB hides the writer, never errors).
  const dayNotesOptions = toStore(() => {
    const day = inputs.selectedDay();
    return {
      queryKey: ['planner-day-notes', day] as const,
      enabled: inputs.view() === 'day',
      queryFn: async ({ signal }: { signal: AbortSignal }) => {
        try {
          return await fetchJSON<{ items: NoteEvent[]; absent?: boolean }>(
            `/api/notes?from=${day}&to=${day}`,
            signal,
          );
        } catch (err) {
          if (err instanceof Error && err.message === 'Unauthorized') throw err;
          console.warn('[calendar] day notes feed absent:', err);
          return { items: [] as NoteEvent[], absent: true };
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
    agendaNotesQuery: createQuery(agendaNotesOptions),
    dayNotesQuery: createQuery(dayNotesOptions),
  };
}
