/**
 * HOY, THE THREE BLOCKS (ADR-202, ADR-203): the day, what comes («Coming up»)
 * and what waits. Pure and clock-free; the page fetches, these decide.
 *
 * - THE SCOPE NARROWS EVERYTHING (ADR-202 § 13, tarea 145): the pulse's rows
 *   too, so the day, its piece, what comes and the rail's pulse follow it.
 *   The rows are read unscoped (`createPulseFeeds`) and narrowed here, which
 *   is what lets Hoy count what of yours today stays outside (§ 14, ADR-203
 *   § 8) without a second read.
 * - WHAT COMES is a strip of day tiles: one tile per day with something, two
 *   things a tile and «+N», two weeks or ten tiles at most (§ 6).
 * - WHAT WAITS opens with one pill per kind and its figure, and under them
 *   the rows of most weight: three on a normal day, five on a day with
 *   nothing, none on a gig day nor in calm (§ 7, ADR-203 § 5 and § 9).
 */
import { inScope, type ResolvedScope } from './nav';
import { perfWorkspaceId, type DateEvent, type PerformanceEvent } from './month-events';
import { agendaPoints, agendaRows } from './day-agenda';
import type { PulseInputRows, PulseNext } from './pulse';
import type { DeskItem } from './desk-feed';

/** Does a pulse row fall inside the scope (container pins only, `inScope`)? */
export function pulseRowInScope(scope: ResolvedScope, row: PerformanceEvent | DateEvent): boolean {
  return inScope(scope, { workspaceId: perfWorkspaceId(row), lineId: row.line_id ?? null, projectId: row.project?.id ?? null });
}

/** The pulse's rows narrowed to the scope; unscoped, the same object. */
export function scopePulseInput<T extends Pick<PulseInputRows, 'performances' | 'dates'>>(input: T, scope: ResolvedScope): T {
  if (scope.isEmpty) return input;
  return {
    ...input,
    performances: input.performances.filter((p) => pulseRowInScope(scope, p)),
    dates: input.dates.filter((d) => pulseRowInScope(scope, d)),
  };
}

/**
 * «1 más hoy fuera de MaMeMi» (ADR-202 § 14): today's rows of yours that the
 * scope leaves out. Yours is the person axis's word (`attribution` other than
 * `no`, ADR-147), not the space's «todo» (ADR-151), which would count the
 * whole company. Each row once, gone by or not: it is still today's.
 */
export function outsideToday(input: PulseInputRows, scope: ResolvedScope, today: string): number {
  if (scope.isEmpty) return 0;
  return agendaRows(agendaPoints(input, today)).filter((ref) => ref.attribution !== 'no' && !pulseRowInScope(scope, ref.row))
    .length;
}

/** How far «Coming up» reaches, and how much it draws (ADR-202 § 6). */
export const COMING_DAYS = 14;
export const COMING_TILES = 10;
export const COMING_PER_TILE = 2;

export interface ComingTile {
  day: string;
  /** At most `COMING_PER_TILE`, in the pulse's order. */
  items: PulseNext[];
  /** What the tile does not draw: its «+N». */
  more: number;
}

const dayDiff = (day: string, today: string) =>
  Math.round((Date.parse(`${day}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000);

/**
 * The tiles of «Coming up»: the days after today with something, within two
 * weeks, ten at most. `coming` is the pulse's own order (`upcoming`), so a
 * tile, the piece and the rail never disagree about what comes first.
 */
export function comingTiles(coming: readonly PulseNext[], today: string): ComingTile[] {
  const tiles: ComingTile[] = [];
  const byDay = new Map<string, PulseNext[]>();
  for (const x of coming) {
    const n = dayDiff(x.day, today);
    if (n < 1 || n > COMING_DAYS) continue;
    const list = byDay.get(x.day);
    if (list) list.push(x);
    else byDay.set(x.day, [x]);
  }
  for (const day of [...byDay.keys()].sort()) {
    if (tiles.length >= COMING_TILES) break;
    const all = byDay.get(day)!;
    tiles.push({ day, items: all.slice(0, COMING_PER_TILE), more: Math.max(0, all.length - COMING_PER_TILE) });
  }
  return tiles;
}

/** The first thing after today, however far: what the hollow piece names (ADR-202 § 3). */
export function nextAfterToday(coming: readonly PulseNext[], today: string): PulseNext | null {
  return coming.find((x) => x.day > today) ?? null;
}

/** The kinds «Te espera» counts in its pills, in the order they are drawn. */
export type WaitingKind = 'calls' | 'replies' | 'tasks' | 'money' | 'decisions';
const KIND_ORDER: readonly WaitingKind[] = ['calls', 'replies', 'tasks', 'money', 'decisions'];

export function waitingKind(i: Pick<DeskItem, 'concern' | 'verbKey'>): WaitingKind {
  if (i.concern === 'conversation') return i.verbKey === 'reply' ? 'replies' : 'calls';
  if (i.concern === 'task') return 'tasks';
  if (i.concern === 'money') return 'money';
  return 'decisions';
}

/** One pill per kind with something, and its figure (ADR-202 § 7). */
export function waitingPills(items: readonly Pick<DeskItem, 'concern' | 'verbKey'>[]): { kind: WaitingKind; n: number }[] {
  const counts = new Map<WaitingKind, number>();
  for (const i of items) {
    const k = waitingKind(i);
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  return KIND_ORDER.filter((k) => counts.has(k)).map((kind) => ({ kind, n: counts.get(kind)! }));
}

/**
 * How many rows «Te espera» draws under its pills: none in calm (ADR-203
 * § 5) nor on a gig day (§ 9), five on a day with nothing, three otherwise.
 */
export function waitingRowCount(day: { calm: boolean; gig: boolean; empty: boolean }): number {
  if (day.calm || day.gig) return 0;
  return day.empty ? 5 : 3;
}
