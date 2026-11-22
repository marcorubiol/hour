/**
 * Personal calendar event projection & RFC 5545 renderer (ADR-241).
 *
 * Pure functions, zero I/O — shared by:
 *   · Fase 1: personal cross-workspace `.ics` subscription (`/api/public/my-calendar/[token]`)
 *   · Fase 2: Apple Calendar CalDAV writer (one VEVENT per UID)
 *   · Fase 5: Google Calendar API v3 adapter (translates `CalendarEvent` directly)
 *
 * Decisions encoded here (Marco, 22-11-2026):
 *   1. Workday block for performances: earliest schedule moment (citación /
 *      load_in) to latest moment (recogida / wrap), with show start time in
 *      the title when the workday begins earlier than `start_at`. Fallback:
 *      `start_at` → `start_at + 2h`, else all-day `performed_at`.
 *   2. Options (`hold`, `hold_1..3`) and unanswered convocations (`unanswered`)
 *      are TENTATIVE and carry `· opción` / `· por contestar` in the title.
 *   3. `travel_day` spans first stage departure to last stage arrival (with
 *      stages in description); `day_off` is all-day with `TRANSP:TRANSPARENT`.
 *   4. Alarms (`VALARM`): `none` by default; optional `day_before` (-P1D) or
 *      `2h_before` (-PT2H).
 *   5. Real IANA timezone (`TZID`) on timed events (venue timezone, fallback
 *      workspace timezone, fallback UTC) so events do not drift while touring.
 *   6. Security (ADR-054): never money, internal notes, booking references, or
 *      other people's data.
 */

import { instantToWallClock } from './datetime';
import { escapeText, foldLine, runningOrderLines, stageLines, toIcsDate, toIcsUtc } from './ics';
import { t, TRADES, type Locale, type Trade } from './i18n';
import { clockText, dayOf } from './running-order';
import type { TravelStageRow } from './travel-stage';

export type CalendarAlarmMode = 'none' | 'day_before' | '2h_before';

export interface EventWorkspace {
  id?: string;
  name: string;
  slug: string;
  timezone: string | null;
  trade?: string | null;
}

export interface EventMoment {
  kind: string | null;
  label: string | null;
  at: string;
  ends_at?: string | null;
}

export type EventStage = Pick<
  TravelStageRow,
  'mode' | 'from_city' | 'from_place' | 'to_city' | 'to_place' | 'depart_at' | 'arrive_at' | 'depart_tz' | 'arrive_tz'
>;

export interface PersonalPerformanceRow {
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
  unanswered?: boolean;
  schedule?: EventMoment[] | null;
  workspace: EventWorkspace | null;
  project: { name: string } | null;
  venue: {
    name: string;
    city: string | null;
    country: string | null;
    address: string | null;
    timezone: string | null;
  } | null;
}

export interface PersonalDateRow {
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
  workspace: EventWorkspace | null;
  project: { name: string } | null;
  stages?: EventStage[] | null;
}

export interface PersonalCalendarFeed {
  alarm_mode?: CalendarAlarmMode | string | null;
  expires_at?: string | null;
  locale?: string | null;
  performances: PersonalPerformanceRow[];
  dates: PersonalDateRow[];
}

export interface CalendarEvent {
  uid: string;
  entityKind: 'performance' | 'date';
  entityId: string;
  workspaceId: string | null;
  summary: string;
  location: string | null;
  description: string | null;
  url: string | null;
  status: 'CONFIRMED' | 'TENTATIVE';
  transparency: 'OPAQUE' | 'TRANSPARENT';
  /** IANA timezone for timed events (venue → workspace → UTC). */
  timezone: string;
  /** Timed event instants (ISO 8601). */
  startUtc?: string;
  endUtc?: string;
  /** All-day event dates (YYYY-MM-DD; inclusive endDate, rendered exclusive in ICS). */
  startDate?: string;
  endDate?: string;
  alarm: CalendarAlarmMode;
  sequence: number;
  updatedAt: string | null;
}

export interface PersonalCalendarOptions {
  locale?: Locale;
  origin?: string | null;
  alarm?: CalendarAlarmMode;
  /** Render timed events with TZID=<iana> instead of UTC Z (default true). */
  useLocalTz?: boolean;
}

const CRLF = '\r\n';
const UID_HOST = 'hour.zerosense.studio';
/** Between title parts: never a dash (Hour's house rule). */
const SEP = ' · ';
const DEFAULT_DURATION_MS = 2 * 3600_000;

const LEGACY_MOMENTS = [
  ['load_in', 'load_in_at'],
  ['soundcheck', 'soundcheck_at'],
  ['start', 'start_at'],
  ['loadout', 'loadout_at'],
  ['wrap', 'wrap_at'],
] as const;

export function normalizeAlarmMode(raw: unknown): CalendarAlarmMode {
  if (raw === 'day_before' || raw === '2h_before') return raw;
  return 'none';
}

function validMs(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? null : ms;
}

function addDays(day: string, n: number): string {
  const d = new Date(`${day.slice(0, 10)}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function isOption(status: string): boolean {
  return status === 'hold' || /^hold_[1-3]$/.test(status);
}

function resolveTrade(trade: string | null | undefined): Trade {
  return trade && (TRADES as readonly string[]).includes(trade) ? (trade as Trade) : 'stage';
}

function momentsOf(p: PersonalPerformanceRow): EventMoment[] {
  if (p.schedule && p.schedule.length > 0) return p.schedule;
  return LEGACY_MOMENTS.flatMap(([kind, field]) => {
    const at = p[field];
    return at ? [{ kind, label: null, at, ends_at: null }] : [];
  });
}

function showStartIso(p: PersonalPerformanceRow, moments: readonly EventMoment[]): string | null {
  const fromSlot = moments.find((m) => m.kind === 'start' && validMs(m.at) !== null)?.at;
  if (fromSlot) return fromSlot;
  return validMs(p.start_at) !== null ? p.start_at : null;
}

/**
 * Full workday span for a performance (Marco, 22-11-2026 § 7 #3):
 *   earliest valid instant across the running order → latest valid instant
 *   (including any slot `ends_at`). When the latest does not exceed the
 *   earliest, falls back to +2h from the show start (or earliest moment).
 */
function performanceSpan(
  p: PersonalPerformanceRow,
  moments: readonly EventMoment[],
  showStart: string | null,
): { startUtc: string; endUtc: string; startsBeforeShow: boolean } | null {
  const points: number[] = [];
  for (const m of moments) {
    const a = validMs(m.at);
    if (a !== null) points.push(a);
    const e = validMs(m.ends_at);
    if (e !== null) points.push(e);
  }
  const startMs = validMs(showStart);
  if (startMs !== null) points.push(startMs);

  if (points.length === 0) return null;

  const earliestMs = Math.min(...points);
  let latestMs = Math.max(...points);

  // If the last recorded point is the show start itself (or no later wrap/loadout),
  // guarantee a 2h block after the show start (or after earliest if no show start).
  const anchorForEnd = startMs !== null ? startMs : earliestMs;
  if (latestMs <= anchorForEnd) {
    latestMs = anchorForEnd + DEFAULT_DURATION_MS;
  }

  return {
    startUtc: new Date(earliestMs).toISOString(),
    endUtc: new Date(latestMs).toISOString(),
    startsBeforeShow: startMs !== null && earliestMs < startMs,
  };
}

/** Travel span: earliest stage departure to latest stage arrival. */
function travelSpan(stages: readonly EventStage[]): { startUtc: string; endUtc: string } | null {
  const departs: number[] = [];
  const arrives: number[] = [];
  for (const s of stages) {
    const d = validMs(s.depart_at);
    if (d !== null) departs.push(d);
    const a = validMs(s.arrive_at);
    if (a !== null) arrives.push(a);
  }
  if (departs.length === 0) return null;
  const startMs = Math.min(...departs);
  const maxArrive = arrives.length > 0 ? Math.max(...arrives) : null;
  const maxDepart = Math.max(...departs);
  const endMs =
    maxArrive !== null && maxArrive > startMs
      ? maxArrive
      : maxDepart > startMs
        ? maxDepart + DEFAULT_DURATION_MS
        : startMs + DEFAULT_DURATION_MS;
  return { startUtc: new Date(startMs).toISOString(), endUtc: new Date(endMs).toISOString() };
}

function kindWord(kind: string, locale: Locale, trade: Trade): string {
  const key = `perf.date_kind_${kind}`;
  const word = t(key, locale, undefined, trade);
  return word === key ? kind.replace(/_/g, ' ') : word;
}

/** Format an ISO instant in an IANA timezone as `YYYYMMDDTHHMMSS` (for `TZID=`). */
export function toIcsLocal(iso: string, timeZone: string): string | null {
  try {
    const wall = instantToWallClock(iso, timeZone); // YYYY-MM-DDTHH:mm
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(wall)) return null;
    const secs = String(new Date(iso).getUTCSeconds()).padStart(2, '0');
    return `${wall.slice(0, 4)}${wall.slice(5, 7)}${wall.slice(8, 10)}T${wall.slice(11, 13)}${wall.slice(14, 16)}${secs}`;
  } catch {
    return null;
  }
}

export function performanceToEvent(
  p: PersonalPerformanceRow,
  opts: { locale: Locale; origin: string | null; alarm: CalendarAlarmMode; sequence?: number },
): CalendarEvent {
  const ws = p.workspace;
  const trade = resolveTrade(ws?.trade);
  const tz = p.venue?.timezone || ws?.timezone || 'UTC';
  const venueName = p.venue?.name ?? p.venue_name;
  const city = p.venue?.city ?? p.city;

  const moments = momentsOf(p);
  const showStart = showStartIso(p, moments);
  const span = performanceSpan(p, moments, showStart);

  const summaryParts = [p.project?.name, venueName ?? city].filter((x): x is string => Boolean(x));
  if (span?.startsBeforeShow && showStart) {
    summaryParts.push(clockText(showStart, tz));
  }
  const option = isOption(p.status);
  const unanswered = Boolean(p.unanswered);
  if (option) summaryParts.push(t('ics.option_suffix', opts.locale, undefined, trade));
  if (unanswered) summaryParts.push(t('ics.pending_suffix', opts.locale, undefined, trade));

  const location = [venueName, p.venue?.address, city, p.venue?.country ?? p.country]
    .filter(Boolean)
    .join(', ');

  const url = opts.origin && ws?.slug && p.slug ? `${opts.origin}/h/${ws.slug}/performance/${p.slug}` : null;
  const descParts = runningOrderLines(moments, tz, { locale: opts.locale, trade, origin: opts.origin });
  if (url) descParts.push(t('ics.in_hour', opts.locale, { url }, trade));

  const base: CalendarEvent = {
    uid: `perf-${p.id}@${UID_HOST}`,
    entityKind: 'performance',
    entityId: p.id,
    workspaceId: ws?.id ?? null,
    summary: summaryParts.join(SEP) || t('perf.label', opts.locale, undefined, trade),
    location: location || null,
    description: descParts.join('\n') || null,
    url,
    status: option || unanswered ? 'TENTATIVE' : 'CONFIRMED',
    transparency: 'OPAQUE',
    timezone: tz,
    alarm: opts.alarm,
    sequence: opts.sequence ?? 0,
    updatedAt: p.updated_at,
  };

  if (span) {
    return { ...base, startUtc: span.startUtc, endUtc: span.endUtc };
  }
  return { ...base, startDate: p.performed_at.slice(0, 10), endDate: p.performed_at.slice(0, 10) };
}

export function dateToEvent(
  d: PersonalDateRow,
  opts: { locale: Locale; origin: string | null; alarm: CalendarAlarmMode; sequence?: number },
): CalendarEvent {
  const ws = d.workspace;
  const trade = resolveTrade(ws?.trade);
  const tz = ws?.timezone || 'UTC';
  const kindLabel = kindWord(d.kind, opts.locale, trade);

  const summaryParts = [d.project?.name, d.title ?? kindLabel].filter((x): x is string => Boolean(x));
  const tentative = d.status === 'tentative';
  if (tentative) summaryParts.push(t('ics.option_suffix', opts.locale, undefined, trade));

  const location = [d.venue_name, d.city].filter(Boolean).join(', ');
  const day = d.all_day ? d.starts_at.slice(0, 10) : dayOf(d.starts_at, tz);
  const url = opts.origin && day ? `${opts.origin}/h/planner?view=day&d=${day}` : null;

  const descParts: string[] = [kindLabel];
  if (d.stages && d.stages.length > 0) {
    descParts.push(...stageLines(d.stages, tz, { locale: opts.locale, trade, origin: opts.origin }));
  }
  if (url) descParts.push(t('ics.in_hour', opts.locale, { url }, trade));

  const isDayOff = d.kind === 'day_off';
  const base: CalendarEvent = {
    uid: `date-${d.id}@${UID_HOST}`,
    entityKind: 'date',
    entityId: d.id,
    workspaceId: ws?.id ?? null,
    summary: summaryParts.join(SEP) || kindLabel,
    location: location || null,
    description: descParts.filter(Boolean).join('\n') || null,
    url,
    status: tentative ? 'TENTATIVE' : 'CONFIRMED',
    transparency: isDayOff ? 'TRANSPARENT' : 'OPAQUE',
    timezone: tz,
    alarm: isDayOff ? 'none' : opts.alarm,
    sequence: opts.sequence ?? 0,
    updatedAt: d.updated_at,
  };

  if (isDayOff) {
    const startDay = d.starts_at.slice(0, 10);
    const endDay = d.ends_at ? d.ends_at.slice(0, 10) : startDay;
    return { ...base, startDate: startDay, endDate: endDay >= startDay ? endDay : startDay };
  }

  if (d.kind === 'travel_day' && d.stages && d.stages.length > 0) {
    const span = travelSpan(d.stages);
    if (span) return { ...base, startUtc: span.startUtc, endUtc: span.endUtc };
  }

  if (d.all_day) {
    const startDay = d.starts_at.slice(0, 10);
    const endDay = d.ends_at ? d.ends_at.slice(0, 10) : startDay;
    return { ...base, startDate: startDay, endDate: endDay >= startDay ? endDay : startDay };
  }

  const startMs = validMs(d.starts_at);
  const endMs = validMs(d.ends_at);
  const endUtc =
    startMs !== null && endMs !== null && endMs > startMs
      ? new Date(endMs).toISOString()
      : startMs !== null
        ? new Date(startMs + DEFAULT_DURATION_MS).toISOString()
        : undefined;

  return { ...base, startUtc: d.starts_at, endUtc };
}

/** Project a personal cross-workspace feed into sorted neutral `CalendarEvent[]`. */
export function buildPersonalEvents(
  feed: PersonalCalendarFeed,
  options: PersonalCalendarOptions = {},
): CalendarEvent[] {
  const locale = options.locale ?? 'en';
  const origin = options.origin ?? null;
  const alarm = options.alarm ?? normalizeAlarmMode(feed.alarm_mode);
  const perOpts = { locale, origin, alarm };

  const events: CalendarEvent[] = [];
  for (const p of feed.performances) {
    if (p.status === 'cancelled' || p.status === 'proposed') continue;
    events.push(performanceToEvent(p, perOpts));
  }
  for (const d of feed.dates) {
    if (d.status === 'cancelled') continue;
    events.push(dateToEvent(d, perOpts));
  }
  return events;
}

/**
 * Render one neutral `CalendarEvent` as unfolded RFC 5545 VEVENT lines.
 * Shared by both the `.ics` feed and CalDAV single-resource PUTs (Fase 2).
 */
export function renderVEventLines(
  e: CalendarEvent,
  dtstamp: string,
  { useLocalTz = true }: { useLocalTz?: boolean } = {},
): string[] {
  const lines = ['BEGIN:VEVENT', `UID:${e.uid}`, `DTSTAMP:${dtstamp}`];

  if (e.startUtc) {
    const localStart = useLocalTz && e.timezone && e.timezone !== 'UTC' ? toIcsLocal(e.startUtc, e.timezone) : null;
    const localEnd =
      e.endUtc && localStart && e.timezone && e.timezone !== 'UTC' ? toIcsLocal(e.endUtc, e.timezone) : null;
    if (localStart && (!e.endUtc || localEnd)) {
      lines.push(`DTSTART;TZID=${e.timezone}:${localStart}`);
      if (localEnd) lines.push(`DTEND;TZID=${e.timezone}:${localEnd}`);
    } else {
      lines.push(`DTSTART:${toIcsUtc(e.startUtc)}`);
      if (e.endUtc) lines.push(`DTEND:${toIcsUtc(e.endUtc)}`);
    }
  } else if (e.startDate) {
    lines.push(`DTSTART;VALUE=DATE:${toIcsDate(e.startDate)}`);
    const endExclusive = addDays(e.endDate ?? e.startDate, 1);
    lines.push(`DTEND;VALUE=DATE:${toIcsDate(endExclusive)}`);
  }

  lines.push(`SUMMARY:${escapeText(e.summary)}`);
  if (e.location) lines.push(`LOCATION:${escapeText(e.location)}`);
  if (e.description) lines.push(`DESCRIPTION:${escapeText(e.description)}`);
  if (e.url) lines.push(`URL:${e.url}`);
  lines.push(`STATUS:${e.status}`);
  lines.push(`TRANSP:${e.transparency}`);
  lines.push(`SEQUENCE:${e.sequence}`);
  if (e.updatedAt) lines.push(`LAST-MODIFIED:${toIcsUtc(e.updatedAt)}`);

  if (e.alarm === 'day_before' || e.alarm === '2h_before') {
    const trigger = e.alarm === 'day_before' ? '-P1D' : '-PT2H';
    lines.push(
      'BEGIN:VALARM',
      'ACTION:DISPLAY',
      `TRIGGER:${trigger}`,
      `DESCRIPTION:${escapeText(e.summary)}`,
      'END:VALARM',
    );
  }

  lines.push('END:VEVENT');
  return lines;
}

/** Render a standalone VCALENDAR containing a single VEVENT (for CalDAV PUT). */
export function buildSingleEventIcs(
  event: CalendarEvent,
  now: Date,
  opts: { useLocalTz?: boolean } = {},
): string {
  const dtstamp = toIcsUtc(now.toISOString());
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Hour//Calendar Sync//EN',
    'CALSCALE:GREGORIAN',
    ...renderVEventLines(event, dtstamp, opts),
    'END:VCALENDAR',
  ];
  return lines.map(foldLine).join(CRLF) + CRLF;
}

/** Render the full personal cross-workspace `.ics` calendar feed (Fase 1). */
export function buildPersonalCalendar(
  feed: PersonalCalendarFeed,
  now: Date,
  options: PersonalCalendarOptions = {},
): string {
  const dtstamp = toIcsUtc(now.toISOString());
  const events = buildPersonalEvents(feed, options);
  const useLocalTz = options.useLocalTz ?? true;

  const lines: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Hour//Personal Calendar//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'X-WR-CALNAME:Hour',
    'X-PUBLISHED-TTL:PT1H',
  ];

  for (const event of events) {
    lines.push(...renderVEventLines(event, dtstamp, { useLocalTz }));
  }

  lines.push('END:VCALENDAR');
  return lines.map(foldLine).join(CRLF) + CRLF;
}

/**
 * Deterministic SHA-256 fingerprint of an event's semantic content (ignoring
 * `updatedAt`, `sequence` and `dtstamp`), used by the sync engine (Fases 2 & 5)
 * to skip no-op writes and ignore echoes of our own writes.
 */
export async function eventFingerprint(e: CalendarEvent): Promise<string> {
  const canonical = JSON.stringify([
    e.uid,
    e.summary,
    e.location ?? '',
    e.description ?? '',
    e.url ?? '',
    e.status,
    e.transparency,
    e.timezone,
    e.startUtc ?? '',
    e.endUtc ?? '',
    e.startDate ?? '',
    e.endDate ?? '',
    e.alarm,
  ]);
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}
