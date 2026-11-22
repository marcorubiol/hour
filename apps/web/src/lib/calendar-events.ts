/**
 * Personal calendar event projection & RFC 5545 renderer (ADR-241).
 *
 * Pure functions, zero I/O, zero Svelte/Vite runtime dependencies — shared by:
 *   · Fase 1: personal cross-workspace `.ics` subscription (`/api/public/my-calendar/[token]`)
 *   · Fase 2: Apple Calendar CalDAV writer (one VEVENT per UID, bundled in `worker-cron.ts`)
 *   · Fase 5: Google Calendar API v3 adapter (translates `CalendarEvent` directly)
 */

import {
  calClockText,
  calWord,
  dayInZone,
  escapeIcsText,
  foldIcsLine,
  formatIcsDate,
  formatIcsLocal,
  formatIcsUtc,
  type CalendarLocale,
} from './calendar-clock';
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
  timezone: string;
  startUtc?: string;
  endUtc?: string;
  startDate?: string;
  endDate?: string;
  alarm: CalendarAlarmMode;
  sequence: number;
  updatedAt: string | null;
}

export interface PersonalCalendarOptions {
  locale?: CalendarLocale;
  origin?: string | null;
  alarm?: CalendarAlarmMode;
  useLocalTz?: boolean;
}

const CRLF = '\r\n';
const UID_HOST = 'hour.zerosense.studio';
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

export function toIcsLocal(iso: string, timeZone: string): string | null {
  return formatIcsLocal(iso, timeZone);
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

function momentLines(moments: readonly EventMoment[], tz: string, locale: CalendarLocale): string[] {
  return moments
    .filter((m) => validMs(m.at) !== null)
    .map((m) => {
      const label =
        m.label ||
        (m.kind ? calWord(locale, `kind_${m.kind}`) : '') ||
        (m.kind ?? '').replace(/_/g, ' ');
      return `${label} ${calClockText(m.at, tz)}`;
    });
}

function stageDescLines(stages: readonly EventStage[], tz: string, locale: CalendarLocale): string[] {
  return stages.map((s) => {
    const modeKey = `mode_${s.mode}`;
    const mode = calWord(locale, modeKey) === modeKey ? s.mode : calWord(locale, modeKey);
    const head = validMs(s.depart_at) !== null ? `${mode} ${calClockText(s.depart_at!, s.depart_tz || tz)}` : mode;
    const from = s.from_place?.trim() || s.from_city?.trim() || '';
    const to = s.to_place?.trim() || s.to_city?.trim() || '';
    const route = from && to ? `${from} → ${to}` : from || to;
    const arrives =
      validMs(s.arrive_at) !== null
        ? calWord(locale, 'arrives', { time: calClockText(s.arrive_at!, s.arrive_tz || tz) })
        : '';
    return [head, route, arrives].filter(Boolean).join(SEP);
  });
}

function dateKindWord(kind: string, locale: CalendarLocale): string {
  const key = `date_${kind}`;
  const w = calWord(locale, key);
  return w === key ? kind.replace(/_/g, ' ') : w;
}

export function performanceToEvent(
  p: PersonalPerformanceRow,
  opts: { locale: CalendarLocale; origin: string | null; alarm: CalendarAlarmMode; sequence?: number },
): CalendarEvent {
  const ws = p.workspace;
  const tz = p.venue?.timezone || ws?.timezone || 'UTC';
  const venueName = p.venue?.name ?? p.venue_name;
  const city = p.venue?.city ?? p.city;

  const moments = momentsOf(p);
  const showStart = showStartIso(p, moments);
  const span = performanceSpan(p, moments, showStart);

  const summaryParts = [p.project?.name, venueName ?? city].filter((x): x is string => Boolean(x));
  if (span?.startsBeforeShow && showStart) {
    summaryParts.push(calClockText(showStart, tz));
  }
  const option = isOption(p.status);
  const unanswered = Boolean(p.unanswered);
  if (option) summaryParts.push(calWord(opts.locale, 'option_suffix'));
  if (unanswered) summaryParts.push(calWord(opts.locale, 'pending_suffix'));

  const location = [venueName, p.venue?.address, city, p.venue?.country ?? p.country]
    .filter(Boolean)
    .join(', ');

  const url = opts.origin && ws?.slug && p.slug ? `${opts.origin}/h/${ws.slug}/performance/${p.slug}` : null;
  const descParts = momentLines(moments, tz, opts.locale);
  if (url) descParts.push(calWord(opts.locale, 'in_hour', { url }));

  const base: CalendarEvent = {
    uid: `perf-${p.id}@${UID_HOST}`,
    entityKind: 'performance',
    entityId: p.id,
    workspaceId: ws?.id ?? null,
    summary: summaryParts.join(SEP) || calWord(opts.locale, 'perf_label'),
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
  opts: { locale: CalendarLocale; origin: string | null; alarm: CalendarAlarmMode; sequence?: number },
): CalendarEvent {
  const ws = d.workspace;
  const tz = ws?.timezone || 'UTC';
  const kindLabel = dateKindWord(d.kind, opts.locale);

  const summaryParts = [d.project?.name, d.title ?? kindLabel].filter((x): x is string => Boolean(x));
  const tentative = d.status === 'tentative';
  if (tentative) summaryParts.push(calWord(opts.locale, 'option_suffix'));

  const location = [d.venue_name, d.city].filter(Boolean).join(', ');
  const day = d.all_day ? d.starts_at.slice(0, 10) : dayInZone(d.starts_at, tz);
  const url = opts.origin && day ? `${opts.origin}/h/planner?view=day&d=${day}` : null;

  const descParts: string[] = [kindLabel];
  if (d.stages && d.stages.length > 0) {
    descParts.push(...stageDescLines(d.stages, tz, opts.locale));
  }
  if (url) descParts.push(calWord(opts.locale, 'in_hour', { url }));

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

export function renderVEventLines(
  e: CalendarEvent,
  dtstamp: string,
  { useLocalTz = true }: { useLocalTz?: boolean } = {},
): string[] {
  const lines = ['BEGIN:VEVENT', `UID:${e.uid}`, `DTSTAMP:${dtstamp}`];

  if (e.startUtc) {
    const localStart = useLocalTz && e.timezone && e.timezone !== 'UTC' ? formatIcsLocal(e.startUtc, e.timezone) : null;
    const localEnd =
      e.endUtc && localStart && e.timezone && e.timezone !== 'UTC' ? formatIcsLocal(e.endUtc, e.timezone) : null;
    if (localStart && (!e.endUtc || localEnd)) {
      lines.push(`DTSTART;TZID=${e.timezone}:${localStart}`);
      if (localEnd) lines.push(`DTEND;TZID=${e.timezone}:${localEnd}`);
    } else {
      lines.push(`DTSTART:${formatIcsUtc(e.startUtc)}`);
      if (e.endUtc) lines.push(`DTEND:${formatIcsUtc(e.endUtc)}`);
    }
  } else if (e.startDate) {
    lines.push(`DTSTART;VALUE=DATE:${formatIcsDate(e.startDate)}`);
    const endExclusive = addDays(e.endDate ?? e.startDate, 1);
    lines.push(`DTEND;VALUE=DATE:${formatIcsDate(endExclusive)}`);
  }

  lines.push(`SUMMARY:${escapeIcsText(e.summary)}`);
  if (e.location) lines.push(`LOCATION:${escapeIcsText(e.location)}`);
  if (e.description) lines.push(`DESCRIPTION:${escapeIcsText(e.description)}`);
  if (e.url) lines.push(`URL:${e.url}`);
  lines.push(`STATUS:${e.status}`);
  lines.push(`TRANSP:${e.transparency}`);
  lines.push(`SEQUENCE:${e.sequence}`);
  if (e.updatedAt) lines.push(`LAST-MODIFIED:${formatIcsUtc(e.updatedAt)}`);

  if (e.alarm === 'day_before' || e.alarm === '2h_before') {
    const trigger = e.alarm === 'day_before' ? '-P1D' : '-PT2H';
    lines.push(
      'BEGIN:VALARM',
      'ACTION:DISPLAY',
      `TRIGGER:${trigger}`,
      `DESCRIPTION:${escapeIcsText(e.summary)}`,
      'END:VALARM',
    );
  }

  lines.push('END:VEVENT');
  return lines;
}

export function buildSingleEventIcs(
  event: CalendarEvent,
  now: Date,
  opts: { useLocalTz?: boolean } = {},
): string {
  const dtstamp = formatIcsUtc(now.toISOString());
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Hour//Calendar Sync//EN',
    'CALSCALE:GREGORIAN',
    ...renderVEventLines(event, dtstamp, opts),
    'END:VCALENDAR',
  ];
  return lines.map(foldIcsLine).join(CRLF) + CRLF;
}

export function buildPersonalCalendar(
  feed: PersonalCalendarFeed,
  now: Date,
  options: PersonalCalendarOptions = {},
): string {
  const dtstamp = formatIcsUtc(now.toISOString());
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
  return lines.map(foldIcsLine).join(CRLF) + CRLF;
}

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
