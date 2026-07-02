/**
 * Dual-timezone display (D-PRE-10): every timestamptz renders in the
 * venue's timezone first, with the viewer's local wall time alongside
 * when it differs. Pure functions — the caller supplies both zones.
 */

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
