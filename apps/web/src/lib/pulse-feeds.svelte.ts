/**
 * The pulse's feeds (ADR-096), out of the rail so the Desk's «lo siguiente»
 * (ADR-117) reads the SAME rows from the SAME cache: one truth about what
 * comes next, drawn twice, never fetched twice.
 *
 * Today forward for performances (with rosters: the person axis needs them),
 * dates from two weeks back (a residency that began last week is still on),
 * and the person axis — team and availability — only for a login that IS a
 * person. Call it synchronously from component init; `today` is a getter so
 * the keys follow the clock across midnight.
 */
import { createQuery } from '@tanstack/svelte-query';
import { fromStore, toStore } from 'svelte/store';
import { fetchJSON } from '$lib/api';
import { dualTime } from '$lib/datetime';
import {
  dateSlip,
  performanceSlip,
  type DateEvent,
  type PerformanceEvent,
  type Slip,
  type SlipContext,
  type SlipKind,
} from '$lib/month-events';
import { meQueryOptions, teamQueryOptions, workspacesQueryOptions } from '$lib/nav-queries';
import { buildPersonAttribution } from '$lib/people';
import { plannerDayHref } from '$lib/planner';
import type { PulseRef } from '$lib/pulse';
import type { AvailabilityItem } from '$lib/availability';
import type { NavWorkspace } from '$lib/nav';

const DAY_MS = 86_400_000;

/** A failed side feed reads as empty; only a lost session propagates. */
async function soft<T>(load: () => Promise<{ items: T[] }>): Promise<{ items: T[] }> {
  try {
    return await load();
  } catch (err) {
    if (err instanceof Error && err.message === 'Unauthorized') throw err;
    return { items: [] };
  }
}

export function createPulseFeeds(today: () => string) {
  /** `/api/dates` filters on the row's START, so the window reaches back:
      two weeks covers a residency or a tour leg. */
  const datesFrom = () =>
    new Date(Date.parse(`${today()}T00:00:00Z`) - 14 * DAY_MS).toISOString().slice(0, 10);

  const me = fromStore(createQuery(meQueryOptions()));
  const ws = fromStore(createQuery(workspacesQueryOptions()));
  const personId = $derived(me.current.data?.person_id ?? null);
  const workspaces = $derived<NavWorkspace[]>(ws.current.data?.items ?? []);

  // Its own key: the hall shares `['today-performances']` without rosters,
  // and widening that URL would make every surface pay for the axis.
  const perf = fromStore(
    createQuery(
      toStore(() => ({
        queryKey: ['pulse-performances', today()] as const,
        staleTime: 5 * 60_000,
        queryFn: ({ signal }: { signal: AbortSignal }) =>
          fetchJSON<{ items: PerformanceEvent[] }>(
            `/api/performances?status=any&from=${today()}&limit=200&rosters=1`,
            signal,
          ),
      })),
    ),
  );
  const dates = fromStore(
    createQuery(
      toStore(() => ({
        queryKey: ['pulse-dates', datesFrom()] as const,
        staleTime: 5 * 60_000,
        queryFn: ({ signal }: { signal: AbortSignal }) =>
          soft(() => fetchJSON<{ items: DateEvent[] }>(`/api/dates?from=${datesFrom()}&limit=200`, signal)),
      })),
    ),
  );
  const team = fromStore(
    createQuery(
      toStore(() =>
        teamQueryOptions(
          workspaces.map((w) => w.id),
          { enabled: Boolean(personId) },
        ),
      ),
    ),
  );
  const blocks = fromStore(
    createQuery(
      toStore(() => ({
        queryKey: ['pulse-availability', datesFrom()] as const,
        enabled: Boolean(personId),
        staleTime: 5 * 60_000,
        queryFn: ({ signal }: { signal: AbortSignal }) =>
          soft(() =>
            fetchJSON<{ items: AvailabilityItem[] }>(`/api/availability?from=${datesFrom()}&limit=500`, signal),
          ),
      })),
    ),
  );

  const axis = $derived(
    buildPersonAttribution({
      pinnedPersonIds: personId ? [personId] : [],
      team: team.current.data?.items ?? [],
      blocks: blocks.current.data?.items ?? [],
    }),
  );

  return {
    get personId() {
      return personId;
    },
    get workspaces() {
      return workspaces;
    },
    get performances(): PerformanceEvent[] {
      return perf.current.data?.items ?? [];
    },
    get dates(): DateEvent[] {
      return dates.current.data?.items ?? [];
    },
    get axis() {
      return axis;
    },
    /** Nothing has landed yet: draw the frame, claim nothing. */
    get settled() {
      return perf.current.isSuccess && dates.current.isSuccess;
    },
    get errored() {
      return perf.current.isError;
    },
    /** The axis has its inputs: until then it is inactive and would let every
        show speak, so a surface that names YOUR shows waits for this. */
    get axisSettled() {
      return !personId || (team.current.isSuccess && blocks.current.isSuccess);
    },
  };
}

/** The slip context every pulse drawing uses: the planner's clock, venue-first. */
export function pulseSlipContext(
  workspaces: readonly NavWorkspace[],
  viewerTz: string,
  kindLabel: (kind: SlipKind) => string,
): SlipContext {
  return {
    workspaceSlug: workspaces[0]?.slug ?? '',
    workspaceSlugById: new Map(workspaces.map((w) => [w.id, w.slug])),
    workspaceTzById: new Map(workspaces.map((w) => [w.id, w.timezone])),
    workspaceModeById: new Map(workspaces.map((w) => [w.id, w.booking_mode ?? 'simple'])),
    viewerTz,
    kindLabel,
    dualTime,
  };
}

/**
 * The slip of a pulse row.
 *
 * A DATE HAS NO PAGE, BUT IT HAS A DAY: `dateSlip` returns `href: null`
 * correctly (on the month and the diary a date opens its edit dialog, and
 * those views own that dialog). The rail and the Desk do not, so a date sends
 * you to the day that holds it, a real address the Planner already answers.
 */
export function pulseSlip(ref: PulseRef, day: string, ctx: SlipContext): Slip {
  if (ref.of === 'performance') return performanceSlip(ref.row as PerformanceEvent, ctx);
  return { ...dateSlip(ref.row as DateEvent, ctx), href: plannerDayHref('day', day) };
}
