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
import { createQuery, keepPreviousData, type QueryClient } from '@tanstack/svelte-query';
import { toStore } from 'svelte/store';
import { fetchJSON } from '$lib/api';
import { addDaysIso, addMonths, monthSpanWeeks, type PlannerView } from '$lib/planner';
import { teamQueryOptions } from '$lib/nav-queries';
import type { AvailabilityItem } from '$lib/availability';
import type { DateEvent, NoteEvent, PerformanceEvent } from '$lib/month-events';
import type { TeamItem } from '$lib/people';

/** Canonical in $lib/people; re-exported so existing importers keep working. */
export type { TeamItem };
export type DecisionPerfItem = PerformanceEvent & { hold_notice_days?: number | null };

/**
 * GRACEFUL ABSENCE, BUT A CANCELLED FETCH IS NOT AN ABSENT FEED.
 * Every Planner feed degrades to `{ items: [], absent: true }` when its
 * endpoint fails (a pre-migration DB, contract § Graceful absence), and lets
 * `Unauthorized` through so the session bounce happens. The catch also caught
 * TanStack's own cancellation: opening the Month or the Agenda aborts the
 * fetches of the window it leaves, and each abort printed «feed absent» in the
 * console on every load (seen 2026-11-18 at 390 and 1440), burying a real
 * absence among false ones and answering a cancelled query with data that
 * hides the blackout entry points. An aborted signal rethrows, so the query
 * library sees the cancellation it asked for.
 */
export function absentFeed<T>(
  label: string,
  err: unknown,
  signal: AbortSignal,
): { items: T[]; absent: true } {
  if (signal.aborted) throw err;
  if (err instanceof Error && err.message === 'Unauthorized') throw err;
  console.warn(`[calendar] ${label} feed absent:`, err);
  return { items: [] as T[], absent: true };
}

/**
 * The season's blocks (ADR-117): the Desk's Planner door reads them, so its
 * «choques» weigh the absences of its twelve weeks.
 * No workspace filter, graceful absence: the other blackout feeds' contract.
 */
export function seasonAvailabilityQueryOptions(from: string, to: string, enabled = true) {
  return {
    queryKey: ['planner-season-availability', { from, to }] as const,
    enabled,
    queryFn: async ({ signal }: { signal: AbortSignal }) => {
      try {
        return await fetchJSON<{ items: AvailabilityItem[]; absent?: boolean }>(
          `/api/availability?from=${from}&to=${to}&limit=500`,
          signal,
        );
      } catch (err) {
        return absentFeed<AvailabilityItem>('season availability', err, signal);
      }
    },
  };
}

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
          `/api/performances?status=any&rosters=1&notice=1&missing=1&${feedParams(filterIds, from, t)}`,
        (r) => r.performed_at.slice(0, 10),
        f,
        signal,
      ),
      pagedFeed<DateEvent>(
        // Same ±1-day pad as the live feed (tz bucketing at the edges).
        (from) => `/api/dates?spans=1&${feedParams(filterIds, addDaysIso(from, -1), addDaysIso(t, 1))}`,
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

/** A window of the book under a scope: what its four reads are keyed by. */
export interface AgendaFeedKey {
  from: string;
  to: string;
  unresolved: boolean;
  projectIds: string[];
  workspaceIds: string[];
}

/**
 * The Agenda's four reads for one window, key and fetch, with no `enabled`:
 * the page adds its own, and the frame's warm-up (`$lib/lens-warm`) asks for
 * the same keys before the Planner is opened, so its first paint finds them.
 */
export function agendaFeedOptions(k: AgendaFeedKey) {
  return {
    performances: {
      queryKey: ['planner-agenda-performances', k] as const,
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        pagedFeed<PerformanceEvent>(
          (from) => `/api/performances?status=any&rosters=1&notice=1&missing=1&${feedParams(k, from, k.to)}`,
          (p) => p.performed_at.slice(0, 10),
          k.from,
          signal,
        ),
    },
    dates: {
      queryKey: ['planner-agenda-dates', k] as const,
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        pagedFeed<DateEvent>(
          // Same ±1-day pad as the grid dates feed (tz bucketing at edges).
          (from) => `/api/dates?spans=1&${feedParams(k, addDaysIso(from, -1), addDaysIso(k.to, 1))}`,
          (d) => d.starts_at.slice(0, 10),
          k.from,
          signal,
        ),
    },
    availability: {
      queryKey: ['planner-agenda-availability', { from: k.from, to: k.to }] as const,
      queryFn: async ({ signal }: { signal: AbortSignal }) => {
        try {
          return await fetchJSON<{ items: AvailabilityItem[]; absent?: boolean }>(
            `/api/availability?from=${k.from}&to=${k.to}&limit=500`,
            signal,
          );
        } catch (err) {
          return absentFeed<AvailabilityItem>('agenda availability', err, signal);
        }
      },
    },
    notes: {
      queryKey: ['planner-agenda-notes', { from: k.from, to: k.to }] as const,
      queryFn: async ({ signal }: { signal: AbortSignal }) => {
        try {
          return await fetchJSON<{ items: NoteEvent[]; absent?: boolean }>(`/api/notes?from=${k.from}&to=${k.to}`, signal);
        } catch (err) {
          return absentFeed<NoteEvent>('notes', err, signal);
        }
      },
    },
  };
}

/**
 * The window the Agenda opens on with no day in the address: from today to
 * the end of the month after this one. The page seeds its book with it and
 * the warm-up asks for it; one rule, or the keys would not meet.
 */
export function agendaSeedWindow(now: Date, todayIso: string): { from: string; end: { year: number; month: number }; to: string } {
  const end = addMonths(now.getFullYear(), now.getMonth() + 1, 0);
  return { from: todayIso, end, to: agendaWindowEnd(end) };
}

/** The last day of the book when it ends in `end`'s month. */
export function agendaWindowEnd(end: { year: number; month: number }): string {
  const next = addMonths(end.year, end.month, 1);
  return addDaysIso(`${next.year}-${String(next.month).padStart(2, '0')}-01`, -1);
}

/** Months the Month's paper loads at once when it opens or jumps (ADR-209). */
export const MONTH_SPAN = 3;

/**
 * The window the Month opens on with no month in the address: this month and
 * the two after it, widened to whole weeks. The page seeds its paper with it
 * and the warm-up asks for it; one rule, or the keys would not meet.
 */
export function monthSeedWindow(now: Date): {
  mesFrom: { year: number; month: number };
  mesTo: { year: number; month: number };
  from: string;
  to: string;
} {
  const mesFrom = { year: now.getFullYear(), month: now.getMonth() + 1 };
  const mesTo = addMonths(mesFrom.year, mesFrom.month, MONTH_SPAN - 1);
  const weeks = monthSpanWeeks(mesFrom, mesTo);
  return { mesFrom, mesTo, from: weeks[0][0], to: weeks[weeks.length - 1][6] };
}

/**
 * The Month's (and the Day's) three reads over one grid window, as key and
 * reader, for the same reason as `agendaFeedOptions`.
 */
export function gridFeedOptions(k: AgendaFeedKey) {
  return {
    performances: {
      queryKey: ['planner-performances', k] as const,
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        pagedFeed<PerformanceEvent>(
          (from) => `/api/performances?status=any&rosters=1&notice=1&${feedParams(k, from, k.to)}`,
          (p) => p.performed_at.slice(0, 10),
          k.from,
          signal,
        ),
    },
    // The dates window is padded ±1 day: `date` rows are timestamptz and get
    // bucketed into their venue's (or the viewer's) day, which can fall
    // outside the UTC-bounded fetch window at the grid edges. Off-grid
    // buckets simply find no cell.
    dates: {
      queryKey: ['planner-dates', k] as const,
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        pagedFeed<DateEvent>(
          (from) => `/api/dates?spans=1&${feedParams(k, addDaysIso(from, -1), addDaysIso(k.to, 1))}`,
          (d) => d.starts_at.slice(0, 10),
          k.from,
          signal,
        ),
    },
    availability: {
      queryKey: ['planner-availability', { from: k.from, to: k.to }] as const,
      queryFn: async ({ signal }: { signal: AbortSignal }) => {
        try {
          return await fetchJSON<{ items: AvailabilityItem[]; absent?: boolean }>(
            `/api/availability?from=${k.from}&to=${k.to}&limit=500`,
            signal,
          );
        } catch (err) {
          return absentFeed<AvailabilityItem>('availability', err, signal);
        }
      },
    },
  };
}

/**
 * The decisions window (ADR-080 §4): every hold from today to today+90d
 * under the scope, whatever the drawing. Key and reader, shared with the
 * warm-up.
 */
export function decisionsFeedOptions(
  k: { unresolved: boolean; projectIds: string[]; workspaceIds: string[] },
  todayIso: string,
) {
  const decisionsTo = addDaysIso(todayIso, DECISIONS_WINDOW_DAYS);
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
    queryFn: async ({ signal }: { signal: AbortSignal }): Promise<{ items: DecisionPerfItem[]; absent?: boolean }> => {
      try {
        // The API caps `limit` at 200 — sized for a one-month grid,
        // while this window spans 90 days across the whole scope. Page
        // with a day cursor (rows arrive performed_at.asc; the boundary
        // day is re-fetched and deduped) so the queue and the strip's
        // "per decidir" never under-report silently (ADR-080 §1/§6:
        // every figure maps to fetched rows — ALL of them).
        const seen = new Set<string>();
        const items: DecisionPerfItem[] = [];
        let from = todayIso;
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
        return absentFeed<DecisionPerfItem>('decisions', err, signal);
      }
    },
  };
}

interface PlannerFeedInputs {
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
  /** A day opened in place (a phone's Month or Agenda, ADR-249): its notes
      are read as the Day view's are. */
  dayOpen?: () => boolean;
  /** Viewer-tz day key for "today" — constant for the page's lifetime. */
  todayIso: string;
}

/** Views that read a window of their own instead of the month grid's. */
function onOwnWindow(view: PlannerView): boolean {
  return view === 'agenda' || view === 'board';
}

export function createPlannerFeeds(inputs: PlannerFeedInputs) {
  // ── Event feeds ──────────────────────────────────────────────────────
  const feedKey = $derived({
    from: inputs.gridFrom(),
    to: inputs.gridTo(),
    unresolved: inputs.scopeUnresolved(),
    ...inputs.filterIds(),
  });

  // Agenda has its own multi-month feed (below); don't double-fetch the grid
  // window while it is showing. THE MONTH GROWS AS YOU SCROLL (ADR-209): the
  // window it had stays on the paper while the wider one arrives.
  const perfOptions = toStore(() => {
    const k = feedKey;
    return {
      ...gridFeedOptions(k).performances,
      enabled: !onOwnWindow(inputs.view()) && !k.unresolved,
      placeholderData: keepPreviousData,
    };
  });
  const datesOptions = toStore(() => {
    const k = feedKey;
    return {
      ...gridFeedOptions(k).dates,
      enabled: !onOwnWindow(inputs.view()) && !k.unresolved,
      placeholderData: keepPreviousData,
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
      ...gridFeedOptions(k).availability,
      enabled: !onOwnWindow(inputs.view()) && !k.unresolved,
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
    return { ...decisionsFeedOptions(k, inputs.todayIso), enabled: !k.unresolved };
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
      ...agendaFeedOptions(k).performances,
      enabled: (inputs.view() === 'agenda' || inputs.view() === 'board') && !k.unresolved,
    };
  });
  const agendaDatesOptions = toStore(() => {
    const k = agendaFeedKey;
    return {
      ...agendaFeedOptions(k).dates,
      enabled: (inputs.view() === 'agenda' || inputs.view() === 'board') && !k.unresolved,
    };
  });
  const agendaAvailabilityOptions = toStore(() => {
    const k = agendaFeedKey;
    return {
      ...agendaFeedOptions(k).availability,
      enabled: (inputs.view() === 'agenda' || inputs.view() === 'board') && !k.unresolved,
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
      ...agendaFeedOptions(k).notes,
      enabled: inputs.view() === 'agenda',
    };
  });

  // The Day's post-its — one day, mine, same graceful absence as the
  // agenda's margin (a pre-migration DB hides the writer, never errors).
  const dayNotesOptions = toStore(() => {
    const day = inputs.selectedDay();
    return {
      queryKey: ['planner-day-notes', day] as const,
      enabled: inputs.view() === 'day' || Boolean(inputs.dayOpen?.()),
      queryFn: async ({ signal }: { signal: AbortSignal }) => {
        try {
          return await fetchJSON<{ items: NoteEvent[]; absent?: boolean }>(
            `/api/notes?from=${day}&to=${day}`,
            signal,
          );
        } catch (err) {
          return absentFeed<NoteEvent>('day notes', err, signal);
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
