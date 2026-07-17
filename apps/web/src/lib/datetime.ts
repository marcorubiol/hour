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
 * engagement.next_action_at, performance day fields and task.due_at all
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
 * timestamptz ISO ↔ <input type="datetime-local"> value, in the VIEWER's
 * timezone. Phase 0 caveat (documented in the edit dialog): times are
 * entered in the viewer's local zone; display is dual-timezone (D-PRE-10).
 */
export function isoToLocalInput(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function localInputToIso(value: string): string | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
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
