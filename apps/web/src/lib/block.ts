/**
 * Multi-day block — the day RULE (ADR-084 §1, design "Hour Block Create").
 *
 * A block is never enumerated by hand. You give a span (`from`–`to`) and a
 * weekday rule ("weekdays only", "Tue + Thu"), and the rule does the work:
 * five weeks of rehearsals becomes 25 days in three clicks instead of 25
 * checkboxes. Individual strays are then PUNCHED OUT as exceptions rather
 * than by breaking the span into pieces — a bank holiday in week three is an
 * exception to one rule, not three separate blocks.
 *
 * Pure string date math, no Date-in-local-timezone anywhere: an ISO day is a
 * label, not an instant, and the day a rehearsal falls on must not shift
 * because the browser sits in another zone.
 */

import { addDaysIso } from './planner';

export type BlockRule = {
  /** ISO day, inclusive. */
  from: string;
  /** ISO day, inclusive. */
  to: string;
  /** JS getDay() numbers: 0 = Sunday … 6 = Saturday. Empty = no days. */
  weekdays: number[];
  /** ISO days inside the span that the rule would include but you removed. */
  exceptions?: string[];
};

/** One day is just a date — below this there is no block to speak of. */
export const BLOCK_MIN_DAYS = 2;
/** A block is a week or a season of rehearsals, not a year. Mirrors the RPC. */
export const BLOCK_MAX_DAYS = 92;

/** Monday-first display order, as JS getDay() numbers. */
export const WEEKDAY_ORDER = [1, 2, 3, 4, 5, 6, 0] as const;

/**
 * The weekday of an ISO day, read in UTC. `new Date('2026-03-09').getDay()`
 * answers in the browser's zone and can be off by one west of Greenwich —
 * which would silently drop every Monday for a user in São Paulo.
 */
export function weekdayOf(iso: string): number {
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/**
 * The days the rule resolves to, in order. Returns [] for an inverted or
 * empty span — an unanswerable rule produces nothing rather than guessing.
 */
export function blockDays(rule: BlockRule): string[] {
  const from = rule.from?.slice(0, 10);
  const to = rule.to?.slice(0, 10);
  if (!from || !to || to < from) return [];
  const skip = new Set(rule.exceptions ?? []);
  const wanted = new Set(rule.weekdays);
  if (wanted.size === 0) return [];

  const out: string[] = [];
  let day = from;
  // Hard stop well past the cap: a malformed span must not spin forever.
  for (let guard = 0; day <= to && guard < 400; guard++) {
    if (wanted.has(weekdayOf(day)) && !skip.has(day)) out.push(day);
    day = addDaysIso(day, 1);
  }
  return out;
}

export type BlockLimit = 'ok' | 'too_few' | 'too_many';

/** Which guardrail, if any, this many days trips. */
export function blockLimit(count: number): BlockLimit {
  if (count > BLOCK_MAX_DAYS) return 'too_many';
  if (count < BLOCK_MIN_DAYS) return 'too_few';
  return 'ok';
}

/**
 * Group the days into calendar weeks (Monday-first) for the review glance.
 * Returns one entry per week that carries at least one day, so a rule with a
 * fortnight gap shows the gap as a missing row rather than an empty one.
 */
export function blockWeeks(days: string[]): { monday: string; days: string[] }[] {
  const byMonday = new Map<string, string[]>();
  for (const d of days) {
    const back = (weekdayOf(d) + 6) % 7; // Monday = 0
    const monday = addDaysIso(d, -back);
    (byMonday.get(monday) ?? byMonday.set(monday, []).get(monday)!).push(d);
  }
  return [...byMonday.entries()]
    .sort((a, b) => (a[0] < b[0] ? -1 : 1))
    .map(([monday, ds]) => ({ monday, days: ds }));
}
