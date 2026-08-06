/**
 * The agenda book's structure: MONTH > WEEK > DAY, every level a door
 * (Marco, 2026-08-03).
 *
 * The month is the master container. It used to be a divider printed when
 * the day-walk happened to visit the 1st — and a fully-free ISO week that
 * straddles a month boundary consumed that day inside its collapse, so an
 * empty May lost its chapter head and hung its weeks under April. Seen on
 * screen 2026-08-03. Grouping by month FIRST makes that impossible: a week
 * band now lives inside one month and shows only its days OF that month —
 * a straddling week prints once per month it touches, like a paper diary
 * repeats the week number at the month turn.
 *
 * Defaults, overridable per key by the reader (session state, never DB):
 *   · an EMPTY month arrives collapsed — past and future alike, so two
 *     years of quiet history prepend as chapter heads, not as 850px each;
 *   · an empty week arrives collapsed (its band already says the fact) —
 *     EXCEPT inside a month the reader opened by hand: they asked to see
 *     the month, not a second row of doors, so its weeks unfold with it
 *     (each still individually closable);
 *   · an OPEN week prints every day it has, empty ones included — the
 *     run-of-quiet-days line died here, its job inherited by the collapsed
 *     week above it;
 *   · whatever holds TODAY never auto-collapses: a day you can be sent to
 *     has to exist (the law the run collapse once broke).
 *
 * Pure on purpose: the diary hands in its per-day facts and its override
 * maps, and this function is the single answer to "what does the book
 * draw" — which makes the ghost-divider class of bug an executable
 * assertion instead of a screenshot.
 */

import { isoWeek } from '$lib/planner';

/** What one day contributes to the shape of its week and month. */
export type AgendaDayStats = {
  /**
   * No calendar rows — a night the trade can still sell (what the tally
   * counts). Distinct from QUIET: a day with only a note or a clash is
   * still a free night, but it is not quiet — see `marked`.
   */
  free: boolean;
  /** Something non-calendar marks it (a clash, a note) — it keeps its
      containers from auto-collapsing, or the reader's own writing hides. */
  marked: boolean;
  /** Confirmed performances. */
  firm: number;
  /** Holds + proposals. */
  held: number;
};

export type AgendaChunk =
  | {
      t: 'month';
      key: string;
      /** First span day of the month — what the divider labels. */
      day: string;
      /** 'YYYY-MM' — the override key, and the `data-month` scroll target. */
      mk: string;
      collapsed: boolean;
      firm: number;
      held: number;
      free: number;
    }
  | {
      t: 'week';
      key: string;
      n: number;
      /** This month's segment of the week — a straddler splits at the turn. */
      from: string;
      to: string;
      firm: number;
      held: number;
      free: number;
      open: boolean;
    }
  | { t: 'day'; key: string; day: string };

export interface AgendaChunkInputs {
  /** Ordered ISO days across the whole span. */
  days: string[];
  todayIso: string;
  dayStats: (day: string) => AgendaDayStats;
  /** Reader toggles: key → open. Absent key = the default for that level. */
  monthOverride?: ReadonlyMap<string, boolean>;
  weekOverride?: ReadonlyMap<string, boolean>;
}

/**
 * How many EMPTY months sit at the tail of the span — the fact that stops
 * the forward auto-load. Collapsed chapters are ~36px each, so a sentinel
 * that keeps firing turns the future into a treadmill of quiet months; the
 * book should stop growing where the plan stops instead. Today's month
 * counts as content even when quiet: the reader lives there.
 */
export function emptyTailMonths(
  days: string[],
  todayIso: string,
  dayStats: (day: string) => AgendaDayStats,
): number {
  let tail = 0;
  let i = days.length - 1;
  while (i >= 0) {
    const mk = days[i].slice(0, 7);
    let monthEmpty = true;
    while (i >= 0 && days[i].slice(0, 7) === mk) {
      const s = dayStats(days[i]);
      if (!s.free || s.marked) monthEmpty = false;
      i--;
    }
    if (!monthEmpty || mk === todayIso.slice(0, 7)) break;
    tail++;
  }
  return tail;
}

export function agendaChunks({
  days,
  todayIso,
  dayStats,
  monthOverride,
  weekOverride,
}: AgendaChunkInputs): AgendaChunk[] {
  const out: AgendaChunk[] = [];
  let i = 0;
  while (i < days.length) {
    const mk = days[i].slice(0, 7);
    let j = i;
    while (j < days.length && days[j].slice(0, 7) === mk) j++;
    const span = days.slice(i, j);

    let firm = 0;
    let held = 0;
    let free = 0;
    let empty = true;
    for (const d of span) {
      const s = dayStats(d);
      if (!s.free || s.marked) empty = false;
      if (s.free) free++;
      firm += s.firm;
      held += s.held;
    }
    const holdsToday = span[0] <= todayIso && todayIso <= span[span.length - 1];
    // Opened BY HAND is stronger than opened by default: it also unfolds
    // the weeks below (the reader asked for the month, not for more doors).
    const forcedOpen = monthOverride?.get(mk) === true;
    const monthOpen = monthOverride?.get(mk) ?? !(empty && !holdsToday);
    out.push({
      t: 'month',
      key: `m${span[0]}`,
      day: span[0],
      mk,
      collapsed: !monthOpen,
      firm,
      held,
      free,
    });
    if (!monthOpen) {
      i = j;
      continue;
    }

    let w = 0;
    while (w < span.length) {
      const n = isoWeek(span[w]);
      let x = w;
      while (x < span.length && isoWeek(span[x]) === n) x++;
      const seg = span.slice(w, x);

      let wfirm = 0;
      let wheld = 0;
      let wfree = 0;
      let wempty = true;
      for (const d of seg) {
        const s = dayStats(d);
        if (!s.free || s.marked) wempty = false;
        if (s.free) wfree++;
        wfirm += s.firm;
        wheld += s.held;
      }
      const wkey = `w${seg[0]}`;
      const wToday = seg[0] <= todayIso && todayIso <= seg[seg.length - 1];
      const open = weekOverride?.get(wkey) ?? (forcedOpen || !(wempty && !wToday));
      out.push({
        t: 'week',
        key: wkey,
        n,
        from: seg[0],
        to: seg[seg.length - 1],
        firm: wfirm,
        held: wheld,
        free: wfree,
        open,
      });
      if (open) for (const d of seg) out.push({ t: 'day', key: d, day: d });
      w = x;
    }
    i = j;
  }
  return out;
}
