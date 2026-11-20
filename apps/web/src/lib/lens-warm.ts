/**
 * THE OTHER SECTIONS' DATA IS ON THE DEVICE BEFORE THE FIRST TAP (20-11-2026).
 *
 * Opening Hoy read only what Hoy draws. The first tap on the Planner, on
 * Conversaciones or on Cuentas then asked for that section's own reads and
 * showed «cargando» while they came, every morning again for the Planner,
 * whose book is keyed by today. Now the frame asks for them itself, a moment
 * after the section on screen has painted: one read at a time, so it never
 * competes with what is on screen, and not at all on a line that asks to save
 * data or is too slow to spare it.
 *
 * NOTHING HERE HAS A KEY OF ITS OWN. Every read comes from the same builder
 * the section uses (`agendaFeedOptions`, `conversationFeedQueryOptions`,
 * `scopeExpensesQueryOptions`, `planAccessQueryOptions`), under the scope the
 * pins give: a warm-up under another key would be a request thrown away. What
 * is warmed is what each section paints first; the rest still arrives when the
 * section opens. The device cache keeps the answers as any other
 * (`CACHE_SCHEMA` is untouched: same keys, same shapes).
 */
import type { QueryClient, QueryKey } from '@tanstack/svelte-query';
import { scopeExpensesQueryOptions } from './bolo-queries';
import { conversationFeedQueryOptions } from './conversation-feed-query';
import { TEAM } from './conversation-tags';
import { planAccessQueryOptions } from './plan-create';
import type { PlannerView } from './planner';
import { agendaFeedOptions, agendaSeedWindow } from './planner-feeds.svelte';

/** An answer newer than this is not asked for again by the warm-up. */
export const WARM_FRESH_MS = 5 * 60_000;

interface WarmRead {
  queryKey: QueryKey;
  queryFn: (ctx: { signal: AbortSignal }) => Promise<unknown>;
}

export interface LensWarmInput {
  /** The sections worth warming: on in the spaces on screen, and not the one on screen. */
  planner: boolean;
  conversations: boolean;
  /** Cuentas only on an explicit «yes» to reading money. */
  books: boolean;
  /** The scope's filter, as every section builds it from the pins. */
  filterIds: { projectIds: string[]; workspaceIds: string[] };
  /** The drawing the Planner opens in for this person; null is the Agenda. */
  plannerView: PlannerView | null;
  now: Date;
  /** Today in the viewer's zone. */
  todayIso: string;
}

/** What to read, in order: the section most likely to be opened next first. */
export function lensWarmReads(input: LensWarmInput): WarmRead[] {
  const reads: WarmRead[] = [];
  if (input.planner) {
    const view = input.plannerView ?? 'agenda';
    // The Agenda and the Board read the book's window; the Month and the Day
    // read their own, which depends on where the person left them.
    if (view === 'agenda' || view === 'board') {
      const { from, to } = agendaSeedWindow(input.now, input.todayIso);
      const feeds = agendaFeedOptions({ from, to, unresolved: false, ...input.filterIds });
      reads.push(feeds.performances, feeds.dates, feeds.availability);
      if (view === 'agenda') reads.push(feeds.notes);
    }
    reads.push(planAccessQueryOptions());
  }
  if (input.conversations) {
    reads.push(conversationFeedQueryOptions(input.filterIds), conversationFeedQueryOptions(input.filterIds, { tag: TEAM }));
  }
  if (input.books) reads.push(scopeExpensesQueryOptions(input.filterIds));
  return reads;
}

/** A line that asks to save data, or too slow to spare any: the warm-up stays out. */
export function lineSparesData(nav: { onLine?: boolean; connection?: { saveData?: boolean; effectiveType?: string } } | undefined): boolean {
  if (!nav) return true;
  if (nav.onLine === false) return false;
  const c = nav.connection;
  if (!c) return true;
  return !c.saveData && c.effectiveType !== 'slow-2g' && c.effectiveType !== '2g';
}

/**
 * Ask for each read in turn. A read that fails leaves nothing behind (an
 * error kept under the key would greet the section when it opens); one
 * already fresh is skipped. Stops as soon as `cancelled` says so.
 */
export async function warmLenses(client: QueryClient, reads: readonly WarmRead[], cancelled: () => boolean): Promise<void> {
  for (const read of reads) {
    if (cancelled()) return;
    const had = client.getQueryState(read.queryKey)?.status === 'success';
    try {
      await client.fetchQuery({ queryKey: read.queryKey, queryFn: read.queryFn, staleTime: WARM_FRESH_MS, retry: false });
    } catch {
      if (!had) client.removeQueries({ queryKey: read.queryKey, exact: true });
    }
  }
}
