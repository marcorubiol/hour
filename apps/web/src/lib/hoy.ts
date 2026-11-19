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
 *   things a tile and «+N», two weeks or ten tiles at most (§ 6); four on a
 *   phone (ADR-205), then the door to the Planner.
 * - WHAT WAITS opens with one pill per kind and its figure, and under them
 *   the rows of most weight: three on a normal day, five on a day with
 *   nothing, none on a gig day nor in calm (§ 7, ADR-203 § 5 and § 9).
 */
import { inScope, type ResolvedScope } from './nav';
import { perfWorkspaceId, type DateEvent, type PerformanceEvent } from './month-events';
import type { Preparation } from './preparation';
import { isUrgentMissing, missingSoon, type PerformanceMissing } from './record-missing';
import { agendaPoints, agendaRows, type AgendaPoint, type DayAgenda } from './day-agenda';
import type { PulseInputRows, PulseNext } from './pulse';
import type { DeskItem } from './desk-feed';
import { localeDayMonthNear, localeWeekdayLong, localeWeekdayShort } from './datetime';
import { t, type Locale } from './i18n';

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

/**
 * Do the day's rows inside the piece say their city? Only when the day goes
 * through more than one: with one city, the piece's line under the title
 * already says it, and at 390 «qué · sala · ciudad» broke in two. `cities`
 * are the rows' own cities (a leg is a route, not a city: it does not count);
 * empty ones are left out, and «Girona» and «girona » are one city.
 */
export function rowsSayCity(cities: readonly (string | null | undefined)[]): boolean {
  const seen = new Set(cities.map((c) => (c ?? '').trim().toLocaleLowerCase()).filter(Boolean));
  return seen.size > 1;
}

/**
 * TWO OR MORE PERFORMANCES TODAY (ADR-207): the piece picks none of them.
 * `shows` are each performance at its own hour, in time order; `oneProject`,
 * whether they all belong to one (the headline names it, else counts them);
 * `hours`, what the headline draws on the right: every hour with two, the
 * first and the last with more. `on` is the performance you are in, at its
 * own hour (its load-in or soundcheck is not «on»); `ahead`, the next
 * performance to start; `begun`, whether any already did («first in» or
 * «next in»). Dates do not count: a rehearsal beside two
 * shows leaves them two. Null with fewer than two.
 */
export interface ShowsDay {
  shows: AgendaPoint[];
  oneProject: boolean;
  hours: AgendaPoint[];
  on: AgendaPoint | null;
  ahead: AgendaPoint | null;
  begun: boolean;
}

export function showsDay(a: DayAgenda): ShowsDay | null {
  const shows = a.points.filter((p) => p.own);
  if (shows.length < 2) return null;
  const projects = new Set(shows.map((p) => p.ref.row.project?.id ?? null));
  const timed = shows.filter((p) => p.at !== null);
  // Only the performance itself is on: its load-in or soundcheck is not (Marco, 14-11).
  const cur = a.current !== null ? a.points[a.current] : null;
  const on = cur?.own ? cur : null;
  const begun = shows.some((p) => p === on || a.past[a.points.indexOf(p)]);
  return {
    shows,
    oneProject: projects.size === 1 && !projects.has(null),
    hours: timed.length > 2 ? [timed[0], timed[timed.length - 1]] : timed,
    on,
    ahead: shows.find((p) => !a.past[a.points.indexOf(p)] && p !== on) ?? null,
    begun,
  };
}

/**
 * The performance the piece's actions (Map, Sheet, the facts, the board) are
 * about. One today: the focus when it is one, else the day's main event.
 * Several (ADR-207): the one on now or the next to start, else the last.
 */
export function piecePerformance(a: DayAgenda): AgendaPoint | null {
  const shows = a.points.filter((p) => p.own);
  if (shows.length > 1) {
    const alive = new Set(a.points.filter((p, i) => !a.past[i] && p.ref.of === 'performance').map((p) => p.ref.id));
    return shows.find((p) => alive.has(p.ref.id)) ?? shows[shows.length - 1];
  }
  const focus = a.focus !== null ? a.points[a.focus] : null;
  return focus?.ref.of === 'performance' ? focus : (a.points.find((p) => p.main) ?? null);
}

/** How far «Coming up» reaches, and how much it draws (ADR-202 § 6). */
export const COMING_DAYS = 14;
export const COMING_TILES = 10;
/** On a phone, four day tiles and then «Planner →» (ADR-205). */
export const COMING_TILES_PHONE = 4;
export const COMING_PER_TILE = 2;

export interface ComingTile {
  day: string;
  /** At most `COMING_PER_TILE`, in the pulse's order. */
  items: PulseNext[];
  /** What the tile does not draw: its «+N». */
  more: number;
  /** Some performance of the day still has something open (ADR-211 § 3,
      amended by the lista de preparación): `open` counts them, hidden items
      too; `missing` is `open > 0`. */
  missing: boolean;
  open: number;
  /** The first open thing with hurry (a hold's deadline, an unshared road
      sheet), the only thing the tile paints in amber; null says none. */
  urgent: PerformanceMissing | null;
}

const dayDiff = (day: string, today: string) =>
  Math.round((Date.parse(`${day}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000);

/**
 * The tiles of «Coming up»: the days after today with something, within two
 * weeks, `max` at most (ten on a desktop, four on a phone, ADR-205). What
 * falls past `max` is not lost: the strip's last tile, «Planner →», is its
 * door. `coming` is the pulse's own order (`upcoming`), so a tile, the piece
 * and the rail never disagree about what comes first.
 */
export function comingTiles(
  coming: readonly PulseNext[],
  today: string,
  max = COMING_TILES,
  /** The preparation list of a project (ADR-221); none says «everything». */
  listOf?: (projectId: string) => Preparation | undefined,
): ComingTile[] {
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
    if (tiles.length >= max) break;
    const all = byDay.get(day)!;
    const gaps = all.flatMap((x) => {
      if (x.ref.of !== 'performance') return [];
      const row = x.ref.row as PerformanceEvent;
      return missingSoon(row, today, row.project?.id ? listOf?.(row.project.id) : undefined);
    });
    tiles.push({
      day,
      items: all.slice(0, COMING_PER_TILE),
      more: Math.max(0, all.length - COMING_PER_TILE),
      missing: gaps.length > 0,
      open: gaps.length,
      urgent: gaps.find(isUrgentMissing) ?? null,
    });
  }
  return tiles;
}

/** The first thing after today, however far: what the hollow piece names (ADR-202 § 3). */
export function nextAfterToday(coming: readonly PulseNext[], today: string): PulseNext | null {
  return coming.find((x) => x.day > today) ?? null;
}

/**
 * When the hollow piece's next thing is: «mañana», «martes» within the week,
 * «jue 19 nov» further, and the year when it is not near (`localeDayMonthNear`).
 */
export function nextWhen(day: string, today: string, locale: Locale): string {
  const days = Math.round((Date.parse(`${day}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000);
  if (days <= 1) return t('desk.next_tomorrow', locale);
  if (days < 7) return localeWeekdayLong(day, locale);
  return `${localeWeekdayShort(day, locale)} ${localeDayMonthNear(day, today, locale)}`;
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
