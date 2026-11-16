/**
 * The Agenda's structure (ADR-211 § 1), pure and tested: what the list draws,
 * in order, from the days of its span. The component hands it the facts of
 * each day; it hands back the lines.
 *
 * ONLY DAYS WITH SOMETHING. No week bands, no month doors, no empty days: a
 * day gets a row when something is on it that is not a trip; a trip is a
 * LEG, a line between two days; a free run of three nights or more is one
 * line at its first night (`gapWindows`, the Month's rule). The week is a
 * stronger rule above the first row of a new week, nothing more; the month
 * turn is its name. «Semana» is said nowhere.
 */
import { mondayOf } from './season';

export type AgendaItem =
  /** The month turn: its name, between the last row of one and the first of the next. */
  | { t: 'month'; key: string; day: string }
  /** «4 noches libres», at the first night of the run. */
  | { t: 'free'; key: string; day: string; nights: number }
  /** A trip leaving on `day`, as a line between days. */
  | { t: 'leg'; key: string; day: string; id: string }
  /** A day with something; `weekTurn` draws the rule of a new week above it. */
  | { t: 'day'; key: string; day: string; weekTurn: boolean };

export interface AgendaInputs {
  /** Ordered ISO days across the span. */
  days: readonly string[];
  /** Whether the day gets a row: something on it that is not a trip. */
  kept: (day: string) => boolean;
  /** The ids of the trips that leave on the day, in their order. */
  legs: (day: string) => readonly string[];
  /** The free runs to name, from `gapWindows`. */
  gaps: readonly { from: string; nights: number }[];
}

export function agendaItems({ days, kept, legs, gaps }: AgendaInputs): AgendaItem[] {
  const gapAt = new Map(gaps.map((g) => [g.from, g.nights]));
  const out: AgendaItem[] = [];
  let month = '';
  let week = '';
  for (const day of days) {
    const nights = gapAt.get(day);
    const trips = legs(day);
    const row = kept(day);
    if (nights === undefined && trips.length === 0 && !row) continue;
    const mk = day.slice(0, 7);
    // The turn of the month is its name; it is already the strongest break,
    // so the week's rule is not drawn under it.
    const turned = month !== '' && mk !== month;
    if (turned) out.push({ t: 'month', key: `m:${mk}`, day });
    month = mk;
    if (nights !== undefined) out.push({ t: 'free', key: `f:${day}`, day, nights });
    for (const id of trips) out.push({ t: 'leg', key: `l:${id}`, day, id });
    if (row) {
      const wk = mondayOf(day);
      out.push({ t: 'day', key: `d:${day}`, day, weekTurn: week !== '' && wk !== week && !turned });
      week = wk;
    }
  }
  return out;
}

/**
 * The plan stops here: the span's last month is after today's and holds
 * nothing. It turns the forward auto-load off, so the list does not grow
 * a treadmill of quiet months (the page then looks ahead once).
 */
export function quietTail(days: readonly string[], todayIso: string, busy: (day: string) => boolean): boolean {
  const last = days.at(-1);
  if (!last || last.slice(0, 7) <= todayIso.slice(0, 7)) return false;
  const mk = last.slice(0, 7);
  return !days.some((d) => d.slice(0, 7) === mk && busy(d));
}
