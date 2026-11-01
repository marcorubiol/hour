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
 *
 * Legible (ADR-162): the words are Hour's, in the feed's language (the
 * `lang` of the link, `CalendarOptions`); the hours of the running order are
 * the Planner's clock (`carga 15h`) in the venue's zone, the workspace's when
 * the venue has none; and each event links back to where it lives in Hour.
 */

import { clockText, dayOf, KIND_WORD_KEYS } from './running-order';
import { t, TRADES, type Locale, type Trade } from './i18n';

type FeedPerformance = {
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
  /**
   * The whole running order, when the feed carries it. Today
   * `get_public_calendar` sends only the five fields above (doors and curfew
   * stay out); a migration that adds this array lights it up here unchanged.
   */
  schedule?: FeedMoment[] | null;
  project: { name: string } | null;
  venue: {
    name: string;
    city: string | null;
    country: string | null;
    address: string | null;
    timezone: string | null;
  } | null;
};

type FeedMoment = { kind: string | null; label: string | null; at: string };

type FeedDate = {
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
  /** `trade` since 20261102160000: the space's own trade, when the link names none. */
  workspace: { name: string; slug: string; timezone: string | null; trade?: string | null } | null;
  performances: FeedPerformance[];
  dates: FeedDate[];
};

/** How the feed speaks and where its links point. */
export type CalendarOptions = {
  locale?: Locale;
  trade?: Trade;
  /** `https://hour.zerosense.studio`; without one, no links. */
  origin?: string | null;
};

const CRLF = '\r\n';
const UID_HOST = 'hour.zerosense.studio';
/** Between the parts of a title: never a dash (Marco's rule for everything written). */
const SEP = ' · ';

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
  /** Where the event lives in Hour (RFC 5545 §3.8.4.6). */
  url?: string | null;
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
  if (e.url) lines.push(`URL:${e.url}`);
  if (e.status) lines.push(`STATUS:${e.status}`);
  if (e.updatedAt) lines.push(`LAST-MODIFIED:${toIcsUtc(e.updatedAt)}`);
  lines.push('END:VEVENT');
  return lines;
}

/** The five fields as moments, in stage order, for a feed without `schedule`. */
const LEGACY_MOMENTS = [
  ['load_in', 'load_in_at'],
  ['soundcheck', 'soundcheck_at'],
  ['start', 'start_at'],
  ['loadout', 'loadout_at'],
  ['wrap', 'wrap_at'],
] as const;

function momentsOf(p: FeedPerformance): FeedMoment[] {
  if (p.schedule && p.schedule.length > 0) return p.schedule;
  return LEGACY_MOMENTS.flatMap(([kind, field]) => {
    const at = p[field];
    return at ? [{ kind, label: null, at }] : [];
  });
}

/** A moment's word: its label, or the dictionary's word for its kind. */
function momentWord(m: FeedMoment, o: Required<CalendarOptions>): string {
  if (m.label) return m.label;
  const key = m.kind ? KIND_WORD_KEYS[m.kind] : undefined;
  return key ? t(key, o.locale, undefined, o.trade) : (m.kind ?? '').replace(/_/g, ' ');
}

/** «carga 15h», one moment per line, in the order the running order keeps. */
export function runningOrderLines(
  moments: readonly FeedMoment[],
  tz: string,
  o: Required<CalendarOptions>,
): string[] {
  return moments
    .filter((m) => !Number.isNaN(new Date(m.at).getTime()))
    .map((m) => `${momentWord(m, o)} ${clockText(m.at, tz)}`);
}

function hourLink(url: string | null, o: Required<CalendarOptions>): string | null {
  return url ? t('ics.in_hour', o.locale, { url }, o.trade) : null;
}

function performanceEvent(
  p: FeedPerformance,
  ws: CalendarFeed['workspace'],
  o: Required<CalendarOptions>,
): VEvent {
  const venueName = p.venue?.name ?? p.venue_name;
  const city = p.venue?.city ?? p.city;
  const summaryParts = [p.project?.name, venueName ?? city].filter(Boolean);
  const location = [venueName, p.venue?.address, city, p.venue?.country ?? p.country]
    .filter(Boolean)
    .join(', ');
  // The venue's clock first (D-PRE-10); the space's when the venue has none.
  const tz = p.venue?.timezone || ws?.timezone || 'UTC';
  // Its page: `/h/<space>/performance/<slug>`. No slug, no page to point at.
  const url = o.origin && ws?.slug && p.slug ? `${o.origin}/h/${ws.slug}/performance/${p.slug}` : null;

  // No status line: a performance in the feed is an option (hold, 90) or
  // confirmed and beyond, and the beyond (invoiced, paid) is money the feed
  // never shows. An option says so, as a date does, and goes TENTATIVE.
  const option = isOption(p.status);
  const descParts = runningOrderLines(momentsOf(p), tz, o);
  if (option) descParts.unshift(t('planner.state_tentative', o.locale, undefined, o.trade));
  const link = hourLink(url, o);
  if (link) descParts.push(link);

  const base: VEvent = {
    uid: `perf-${p.id}@${UID_HOST}`,
    summary: summaryParts.join(SEP) || t('perf.label', o.locale, undefined, o.trade),
    location: location || null,
    description: descParts.join('\n') || null,
    url,
    status: option ? 'TENTATIVE' : 'CONFIRMED',
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

/** `hold`, `hold_1`..`hold_3`: an option, which the feed carries since 90. */
function isOption(status: string): boolean {
  return status === 'hold' || /^hold_[1-3]$/.test(status);
}

/** The word for a date's kind; the raw kind with spaces if Hour has none. */
function kindWord(kind: string, o: Required<CalendarOptions>): string {
  const key = `perf.date_kind_${kind}`;
  const word = t(key, o.locale, undefined, o.trade);
  return word === key ? kind.replace(/_/g, ' ') : word;
}

function dateEvent(d: FeedDate, ws: CalendarFeed['workspace'], o: Required<CalendarOptions>): VEvent {
  const kindLabel = kindWord(d.kind, o);
  const summaryParts = [d.project?.name, d.title ?? kindLabel].filter(Boolean);
  const location = [d.venue_name, d.city].filter(Boolean).join(', ');
  const tz = ws?.timezone || 'UTC';
  // A date has no page (its edit is a dialog): its day in the Planner.
  const day = d.all_day ? d.starts_at.slice(0, 10) : dayOf(d.starts_at, tz);
  const url = o.origin && day ? `${o.origin}/h/planner?view=day&d=${day}` : null;

  // «ensayo», or «ensayo · opción» while it is not confirmed.
  const head =
    d.status === 'tentative'
      ? `${kindLabel}${SEP}${t('planner.state_tentative', o.locale, undefined, o.trade)}`
      : kindLabel;
  const link = hourLink(url, o);

  const base: VEvent = {
    uid: `date-${d.id}@${UID_HOST}`,
    summary: summaryParts.join(SEP) || kindLabel,
    location: location || null,
    description: [head, link].filter(Boolean).join('\n'),
    url,
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

function feedTrade(trade: string | null | undefined): Trade | undefined {
  return trade && (TRADES as readonly string[]).includes(trade) ? (trade as Trade) : undefined;
}

/**
 * Render the whole feed. `now` is injected for a stable DTSTAMP (tests)
 * — pass `new Date()` from the endpoint.
 */
export function buildCalendar(feed: CalendarFeed, now: Date, options: CalendarOptions = {}): string {
  const o: Required<CalendarOptions> = {
    locale: options.locale ?? 'en',
    trade: options.trade ?? feedTrade(feed.workspace?.trade) ?? 'stage',
    origin: options.origin ?? null,
  };
  const dtstamp = toIcsUtc(now.toISOString());
  const name = feed.workspace ? `${feed.workspace.name}${SEP}Hour` : 'Hour';

  const lines: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Hour//Calendar Feed//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${escapeText(name)}`,
    'X-PUBLISHED-TTL:PT1H',
  ];

  for (const p of feed.performances) lines.push(...renderEvent(performanceEvent(p, feed.workspace, o), dtstamp));
  for (const d of feed.dates) lines.push(...renderEvent(dateEvent(d, feed.workspace, o), dtstamp));

  lines.push('END:VCALENDAR');
  return lines.map(foldLine).join(CRLF) + CRLF;
}
