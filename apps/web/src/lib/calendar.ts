/**
 * Calendar month math — pure helpers for the Calendar lens.
 *
 * The grid is calendar-abstract (whole ISO days, Monday-first weeks);
 * timezone only enters when bucketing a timestamptz into a day, via
 * `dayKeyInTz`. Keep every function pure — the page supplies "today".
 */

export interface CalendarDay {
  /** ISO date, YYYY-MM-DD. */
  iso: string;
  /** False for leading/trailing days that pad the first/last week. */
  inMonth: boolean;
}

function isoOf(utc: Date): string {
  return utc.toISOString().slice(0, 10);
}

/**
 * Monday-first week grid covering the given month (1-12). Always returns
 * complete weeks — leading/trailing days belong to the neighbour months
 * and carry `inMonth: false`.
 */
export function monthGrid(year: number, month: number): CalendarDay[][] {
  const first = new Date(Date.UTC(year, month - 1, 1));
  // getUTCDay: 0=Sunday..6=Saturday → Monday-first offset 0..6.
  const lead = (first.getUTCDay() + 6) % 7;
  const start = new Date(Date.UTC(year, month - 1, 1 - lead));

  const weeks: CalendarDay[][] = [];
  const cursor = new Date(start);
  do {
    const week: CalendarDay[] = [];
    for (let i = 0; i < 7; i++) {
      week.push({
        iso: isoOf(cursor),
        inMonth: cursor.getUTCMonth() === month - 1,
      });
      cursor.setUTCDate(cursor.getUTCDate() + 1);
    }
    weeks.push(week);
  } while (cursor.getUTCMonth() === month - 1);
  return weeks;
}

/** Month arithmetic that survives year boundaries. Month is 1-12. */
export function addMonths(
  year: number,
  month: number,
  delta: number,
): { year: number; month: number } {
  const zero = year * 12 + (month - 1) + delta;
  return { year: Math.floor(zero / 12), month: (((zero % 12) + 12) % 12) + 1 };
}

/** ISO date ± n days (UTC math — plain dates never touch a timezone). */
export function addDaysIso(iso: string, delta: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}

/**
 * Bucket a timestamptz into the ISO day it falls on in `timeZone`.
 * en-CA formats as YYYY-MM-DD natively.
 */
export function dayKeyInTz(isoTimestamp: string, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(isoTimestamp));
}
