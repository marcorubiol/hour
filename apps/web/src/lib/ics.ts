/**
 * ICS (RFC 5545) feed builder (ADR-054) — pure functions, no I/O. The
 * Worker feeds it the sanitized JSON from `get_public_calendar` and
 * serves the result as text/calendar.
 *
 * Scope: what a subscribed Google/Apple Calendar needs — VEVENT per
 * confirmed-or-beyond performance and per non-cancelled date. Timed
 * events use the stored UTC instants (calendar apps localize); date-only
 * events use VALUE=DATE. No VTIMEZONE blocks needed since all instants
 * ship as UTC (`Z`).
 */

export type FeedPerformance = {
  id: string;
  slug: string | null;
  performed_at: string;
  status: string;
  venue_name: string | null;
  city: string | null;
  country: string | null;
  load_in_at: string | null;
  soundcheck_at: string | null;
  start_at: string | null;
  loadout_at: string | null;
  wrap_at: string | null;
  updated_at: string | null;
  project: { name: string } | null;
  venue: {
    name: string;
    city: string | null;
    country: string | null;
    address: string | null;
    timezone: string | null;
  } | null;
};

export type FeedDate = {
  id: string;
  kind: string;
  status: string;
  title: string | null;
  starts_at: string;
  ends_at: string | null;
  all_day: boolean;
  venue_name: string | null;
  city: string | null;
  updated_at: string | null;
  project: { name: string } | null;
};

export type CalendarFeed = {
  workspace: { name: string; slug: string; timezone: string | null } | null;
  performances: FeedPerformance[];
  dates: FeedDate[];
};

const CRLF = '\r\n';
const UID_HOST = 'hour.zerosense.studio';

/** Escape per RFC 5545 §3.3.11: backslash, semicolon, comma, newline. */
export function escapeText(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n');
}

/**
 * Fold a content line at 75 octets (RFC 5545 §3.1) — continuation lines
 * start with one space. Folds on UTF-8 byte length, never splitting a
 * multi-byte character.
 */
export function foldLine(line: string): string {
  const encoder = new TextEncoder();
  if (encoder.encode(line).length <= 75) return line;

  const out: string[] = [];
  let current = '';
  let currentBytes = 0;
  let limit = 75;
  for (const ch of line) {
    const chBytes = encoder.encode(ch).length;
    if (currentBytes + chBytes > limit) {
      out.push(current);
      current = ' ';
      currentBytes = 1;
      limit = 75;
    }
    current += ch;
    currentBytes += chBytes;
  }
  if (current) out.push(current);
  return out.join(CRLF);
}

/** 2026-07-04T18:30:00+00:00 | ...Z → 20260704T183000Z */
export function toIcsUtc(iso: string): string {
  const d = new Date(iso);
  return d
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}Z$/, 'Z');
}

/** 2026-07-04 → 20260704 */
export function toIcsDate(day: string): string {
  return day.slice(0, 10).replace(/-/g, '');
}

/** YYYY-MM-DD + n days, calendar-safe (UTC math). */
function addDays(day: string, n: number): string {
  const d = new Date(`${day.slice(0, 10)}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

type VEvent = {
  uid: string;
  summary: string;
  location?: string | null;
  description?: string | null;
  status?: 'CONFIRMED' | 'TENTATIVE';
  /** Timed event: ISO instants. */
  startUtc?: string;
  endUtc?: string | null;
  /** All-day event: YYYY-MM-DD (DTEND exclusive is handled here). */
  startDate?: string;
  endDate?: string | null;
  updatedAt?: string | null;
};

function renderEvent(e: VEvent, dtstamp: string): string[] {
  const lines = ['BEGIN:VEVENT', `UID:${e.uid}`, `DTSTAMP:${dtstamp}`];
  if (e.startUtc) {
    lines.push(`DTSTART:${toIcsUtc(e.startUtc)}`);
    if (e.endUtc) lines.push(`DTEND:${toIcsUtc(e.endUtc)}`);
  } else if (e.startDate) {
    lines.push(`DTSTART;VALUE=DATE:${toIcsDate(e.startDate)}`);
    // DTEND is exclusive for VALUE=DATE — a one-day event ends "tomorrow".
    const endExclusive = addDays(e.endDate ?? e.startDate, 1);
    lines.push(`DTEND;VALUE=DATE:${toIcsDate(endExclusive)}`);
  }
  lines.push(`SUMMARY:${escapeText(e.summary)}`);
  if (e.location) lines.push(`LOCATION:${escapeText(e.location)}`);
  if (e.description) lines.push(`DESCRIPTION:${escapeText(e.description)}`);
  if (e.status) lines.push(`STATUS:${e.status}`);
  if (e.updatedAt) lines.push(`LAST-MODIFIED:${toIcsUtc(e.updatedAt)}`);
  lines.push('END:VEVENT');
  return lines;
}

function performanceEvent(p: FeedPerformance): VEvent {
  const venueName = p.venue?.name ?? p.venue_name;
  const city = p.venue?.city ?? p.city;
  const summaryParts = [p.project?.name, venueName ?? city].filter(Boolean);
  const location = [venueName, p.venue?.address, city, p.venue?.country ?? p.country]
    .filter(Boolean)
    .join(', ');

  const descParts: string[] = [`Status: ${p.status}`];
  if (p.load_in_at) descParts.push(`Load in: ${p.load_in_at}`);
  if (p.soundcheck_at) descParts.push(`Soundcheck: ${p.soundcheck_at}`);

  const base: VEvent = {
    uid: `perf-${p.id}@${UID_HOST}`,
    summary: summaryParts.join(' — ') || 'Performance',
    location: location || null,
    description: descParts.join('\n'),
    status: 'CONFIRMED',
    updatedAt: p.updated_at,
  };

  if (p.start_at) {
    // Timed: start_at → wrap_at, but only when wrap_at is strictly after
    // start_at. The DB CHECK chains start ≤ loadout ≤ wrap, so with
    // loadout_at NULL a wrap_at BEFORE start_at is a valid row — using it
    // raw would emit DTEND < DTSTART (RFC 5545 §3.6.1 violation). Fall
    // back to a 2h block then.
    const startMs = new Date(p.start_at).getTime();
    const end =
      p.wrap_at && new Date(p.wrap_at).getTime() > startMs
        ? p.wrap_at
        : new Date(startMs + 2 * 3600_000).toISOString();
    return { ...base, startUtc: p.start_at, endUtc: end };
  }
  return { ...base, startDate: p.performed_at };
}

function dateEvent(d: FeedDate): VEvent {
  const kindLabel = d.kind.replace(/_/g, ' ');
  const summaryParts = [d.project?.name, d.title ?? kindLabel].filter(Boolean);
  const location = [d.venue_name, d.city].filter(Boolean).join(', ');

  const base: VEvent = {
    uid: `date-${d.id}@${UID_HOST}`,
    summary: summaryParts.join(' — ') || kindLabel,
    location: location || null,
    description: `${kindLabel} — ${d.status}`,
    status: d.status === 'tentative' ? 'TENTATIVE' : 'CONFIRMED',
    updatedAt: d.updated_at,
  };

  if (d.all_day) {
    return {
      ...base,
      startDate: d.starts_at.slice(0, 10),
      endDate: d.ends_at ? d.ends_at.slice(0, 10) : null,
    };
  }
  return { ...base, startUtc: d.starts_at, endUtc: d.ends_at };
}

/**
 * Render the whole feed. `now` is injected for a stable DTSTAMP (tests)
 * — pass `new Date()` from the endpoint.
 */
export function buildCalendar(feed: CalendarFeed, now: Date): string {
  const dtstamp = toIcsUtc(now.toISOString());
  const name = feed.workspace ? `${feed.workspace.name} — Hour` : 'Hour';

  const lines: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Hour//Calendar Feed//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${escapeText(name)}`,
    'X-PUBLISHED-TTL:PT1H',
  ];

  for (const p of feed.performances) lines.push(...renderEvent(performanceEvent(p), dtstamp));
  for (const d of feed.dates) lines.push(...renderEvent(dateEvent(d), dtstamp));

  lines.push('END:VCALENDAR');
  return lines.map(foldLine).join(CRLF) + CRLF;
}
