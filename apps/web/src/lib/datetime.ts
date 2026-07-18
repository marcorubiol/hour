/**
 * Dual-timezone display (D-PRE-10): every timestamptz renders in the
 * venue's timezone first, with the viewer's local wall time alongside
 * when it differs. Pure functions — the caller supplies both zones.
 */

import * as v from 'valibot';

/**
 * The date-only API contract: "YYYY-MM-DD that is a real calendar day".
 * isoDate is regex-only (2026-02-31 passes it), so the round-trip check
 * keeps impossible dates from reaching Postgres as a 5xx. One home —
 * conversation.next_action_at, performance day fields and task.due_at all
 * consume it. (Valibot runs later pipe actions even when isoDate already
 * failed, so the Invalid-Date guard sits before toISOString().)
 */
export const realIsoDate = v.pipe(
  v.string(),
  v.isoDate(),
  v.check((s) => {
    const d = new Date(`${s}T00:00:00Z`);
    return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
  }, 'Not a real calendar date'),
);

/**
 * The timestamp API contract: "a string Date can actually parse". One home
 * for every timestamptz write field (date.starts_at/ends_at consume it;
 * the performance timeslots predate it with a module-local copy).
 */
export const realIsoInstant = v.pipe(
  v.string(),
  v.check((s) => !Number.isNaN(new Date(s).getTime()), 'Not a valid timestamp'),
);

export interface DualTime {
  /** Wall time in the primary (venue) zone, HH:mm. */
  primary: string;
  /** ISO day the instant falls on in the primary zone. */
  primaryDay: string;
  /** Viewer wall time when it differs from primary, else null. */
  secondary: string | null;
  /** ISO day in the viewer zone (only when secondary is set). */
  secondaryDay: string | null;
}

/**
 * Human day label from an ISO date (or timestamp — only the date part is
 * read). UTC-anchored: a plain date must never shift a day through the
 * viewer's zone.
 */
export function dayLabel(iso: string, style: 'short' | 'long' = 'short'): string {
  return new Date(`${iso.slice(0, 10)}T00:00:00Z`).toLocaleDateString('en-GB', {
    weekday: style,
    day: '2-digit',
    month: style,
    year: 'numeric',
    timeZone: 'UTC',
  });
}

/**
 * "09 Jul" — day + month, no weekday/year. Same UTC-anchored contract as
 * dayLabel. For tight metadata columns (next-action dates, agenda rows).
 */
export function dayMonth(iso: string): string {
  return new Date(`${iso.slice(0, 10)}T00:00:00Z`).toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'short',
    timeZone: 'UTC',
  });
}

/**
 * "09 Jul" for a timestamptz, in the VIEWER's zone (wall-clock display —
 * schedules, activity rows). Not for date-only contracts: those must use
 * the UTC-anchored dayMonth/dayLabel above.
 */
export function dayMonthTs(iso: string): string {
  return new Date(iso).toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'short',
  });
}

/**
 * "09 Jul 2026" — no weekday. Same UTC-anchored contract as dayLabel.
 */
export function dayMonthYear(iso: string): string {
  return new Date(`${iso.slice(0, 10)}T00:00:00Z`).toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

/**
 * Wall-clock parts of an instant in a zone ("2026-07-17", "20:30:00").
 * en-CA date order + h23 keep the parts locale-stable.
 */
function wallParts(atMs: number, timeZone: string): Record<string, string> {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(atMs));
  const bag: Record<string, string> = {};
  for (const p of parts) if (p.type !== 'literal') bag[p.type] = p.value;
  return bag;
}

/** Zone's UTC offset at an instant, in ms (CEST → +7 200 000). */
function tzOffsetMs(atMs: number, timeZone: string): number {
  const base = Math.floor(atMs / 1000) * 1000; // parts are second-precise
  const w = wallParts(base, timeZone);
  const asUtc = Date.UTC(
    Number(w.year),
    Number(w.month) - 1,
    Number(w.day),
    Number(w.hour),
    Number(w.minute),
    Number(w.second),
  );
  return asUtc - base;
}

/**
 * "YYYY-MM-DDTHH:mm" typed as wall time IN `timeZone` → ISO instant.
 * The timezone-rule entry contract (screen-data-spec § Timezone rule):
 * contracts speak venue-local, so a datetime-local value must be
 * interpreted in the venue's zone, never the browser's.
 *
 * Guess-and-refine: the offset depends on the instant and the instant on
 * the offset; two passes converge everywhere except across a DST jump,
 * where the result is still deterministic and roundtrip-safe. The pick
 * follows the offset sampled at the wall string read as a UTC instant:
 * zones EAST of UTC (Madrid, London) resolve a nonexistent wall time
 * forward and an ambiguous one to the LATER occurrence; zones WEST of
 * UTC (the Americas) resolve the other way (backward / earlier). Both
 * directions are pinned in datetime.test.ts.
 */
export function wallClockToInstant(wallClock: string, timeZone: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(wallClock);
  if (!m) return null;
  const wallUtc = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] ?? '0'));
  if (Number.isNaN(wallUtc)) return null;
  // Date.UTC rolls impossible components over (month 13, day 32, 25:00 …)
  // instead of failing — same guard style as realIsoDate: the parts must
  // survive the round-trip untouched.
  const chk = new Date(wallUtc);
  if (
    chk.getUTCFullYear() !== +m[1] ||
    chk.getUTCMonth() + 1 !== +m[2] ||
    chk.getUTCDate() !== +m[3] ||
    chk.getUTCHours() !== +m[4] ||
    chk.getUTCMinutes() !== +m[5]
  ) {
    return null;
  }
  let t = wallUtc - tzOffsetMs(wallUtc, timeZone);
  t = wallUtc - tzOffsetMs(t, timeZone);
  return new Date(t).toISOString();
}

/**
 * ISO instant → "YYYY-MM-DDTHH:mm" wall time in `timeZone`, the value an
 * <input type="datetime-local"> shows. Inverse of wallClockToInstant —
 * the roundtrip is drift-free for every wall time that exists.
 */
export function instantToWallClock(iso: string | null, timeZone: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const w = wallParts(d.getTime(), timeZone);
  return `${w.year}-${w.month}-${w.day}T${w.hour}:${w.minute}`;
}

export function timeInTz(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(iso));
}

function dayInTz(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(iso));
}

/**
 * Venue-first dual time. `venueTz` falls back to `viewerTz` when the venue
 * has no timezone on record (then there is nothing to contrast and
 * `secondary` is null).
 */
export function dualTime(
  iso: string,
  venueTz: string | null | undefined,
  viewerTz: string,
): DualTime {
  const primaryTz = venueTz || viewerTz;
  const primary = timeInTz(iso, primaryTz);
  const primaryDay = dayInTz(iso, primaryTz);

  if (primaryTz === viewerTz) {
    return { primary, primaryDay, secondary: null, secondaryDay: null };
  }

  const secondary = timeInTz(iso, viewerTz);
  const secondaryDay = dayInTz(iso, viewerTz);
  if (secondary === primary && secondaryDay === primaryDay) {
    return { primary, primaryDay, secondary: null, secondaryDay: null };
  }
  return { primary, primaryDay, secondary, secondaryDay };
}
