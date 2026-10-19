/**
 * The facts of a date's vistazo (ADR-139 p1): what it is called, when, and
 * where, read from the row the Planner already draws. Pure: the words
 * (kind, status) are the caller's.
 *
 * The name follows the Planner's card (`dateSlip`): a title wins, then the
 * venue, then where a trip goes. A trip is named by its two ends when it
 * has them («Barcelona → Sevilla»), because that is what a trip is.
 */

import { dateDayKey, dateSpanDays, type DateEvent } from './month-events';
import { hourMark, timeInTz } from './datetime';

export interface DateFacts {
  /** The name, or null when only the kind can name it. */
  name: string | null;
  /** First and last day, YYYY-MM-DD; the same day for a one-day date. */
  first: string;
  last: string;
  /** The hours on the date's clock («10h», «14h30»); null when all day. */
  start: string | null;
  end: string | null;
  /** Where, when it is not already the name. */
  place: string | null;
  /** A trip's two ends, as written (or the destination alone). */
  trip: { from: string | null; to: string | null } | null;
}

/** `tz`: the zone a venue-less date is read in (the space's, else the reader's). */
export function dateFacts(d: DateEvent, tz: string): DateFacts {
  const zone = d.venue?.timezone || tz;
  const days = dateSpanDays(d, zone);
  const first = days[0] ?? dateDayKey(d, zone);
  const last = days[days.length - 1] ?? first;
  const start = d.all_day ? null : hourMark(timeInTz(d.starts_at, zone));
  const endRaw = !d.all_day && d.ends_at ? hourMark(timeInTz(d.ends_at, zone)) : null;
  const end = endRaw && endRaw !== start ? endRaw : null;

  if (d.kind === 'travel_day') {
    const to = d.destination_city ?? d.city ?? null;
    const from = d.origin_city ?? null;
    const ends = [from, to].filter(Boolean).join(' → ');
    const name = d.title ?? (ends || null);
    const place = d.venue_name && d.venue_name !== name ? d.venue_name : null;
    return { name, first, last, start, end, place, trip: from || to ? { from, to } : null };
  }

  const name = d.title ?? (d.kind === 'other' ? (d.label ?? null) : null) ?? d.venue_name ?? null;
  const place = [d.venue_name, d.city].filter((p): p is string => Boolean(p) && p !== name).join(' · ') || null;
  return { name, first, last, start, end, place, trip: null };
}
