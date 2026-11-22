/**
 * Minimal RFC 5545 VEVENT parser + RRULE expander (ADR-241 Fases 3 & 4).
 *
 * Security by construction: NEVER extracts SUMMARY, LOCATION, DESCRIPTION or
 * ATTENDEE. Only reads timing (`DTSTART`, `DTEND`, `DURATION`, `RRULE`,
 * `EXDATE`, `TRANSP`, `STATUS`, `UID`) for:
 *   · Fase 3: computing busy intervals from external CalDAV calendars
 *   · Fase 4: reading moved start/end times on an Hour `date-*` event
 *
 * Only relative imports (bundled into worker-cron.ts).
 */

import { wallToUtcIso } from '../../calendar-clock';

export interface ParsedVEventTiming {
  uid: string | null;
  startsAt: string;
  endsAt: string;
  allDay: boolean;
  transparent: boolean;
  cancelled: boolean;
  rrule: string | null;
  exdates: Set<string>;
}

/** Unfold RFC 5545 folded lines (`CRLF` + space/tab). */
export function unfoldIcs(raw: string): string[] {
  const normalized = raw.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const lines: string[] = [];
  for (const line of normalized.split('\n')) {
    if ((line.startsWith(' ') || line.startsWith('\t')) && lines.length > 0) {
      lines[lines.length - 1] += line.slice(1);
    } else if (line.length > 0) {
      lines.push(line);
    }
  }
  return lines;
}

function parseIcsDateValue(params: string, value: string): { iso: string; allDay: boolean } | null {
  const v = value.trim();
  const isDateOnly = /VALUE=DATE\b/i.test(params) || /^\d{8}$/.test(v);
  if (isDateOnly && /^\d{8}/.test(v)) {
    const iso = `${v.slice(0, 4)}-${v.slice(4, 6)}-${v.slice(6, 8)}T00:00:00.000Z`;
    return Number.isNaN(Date.parse(iso)) ? null : { iso, allDay: true };
  }
  const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z?)$/.exec(v);
  if (!m) return null;
  const [, Y, M, D, h, min, s, z] = m;
  if (z === 'Z') {
    const iso = `${Y}-${M}-${D}T${h}:${min}:${s}.000Z`;
    return Number.isNaN(Date.parse(iso)) ? null : { iso, allDay: false };
  }
  const tzMatch = /TZID=([^;:]+)/i.exec(params);
  if (tzMatch) {
    const tz = tzMatch[1].replace(/^"|"$/g, '');
    const inst = wallToUtcIso(`${Y}-${M}-${D}T${h}:${min}`, tz);
    if (inst) return { iso: inst, allDay: false };
  }
  const fallback = `${Y}-${M}-${D}T${h}:${min}:${s}.000Z`;
  return Number.isNaN(Date.parse(fallback)) ? null : { iso: fallback, allDay: false };
}

function parseDurationMs(value: string): number | null {
  const m = /^([+-])?P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/i.exec(value.trim());
  if (!m) return null;
  const sign = m[1] === '-' ? -1 : 1;
  const weeks = Number(m[2] ?? 0);
  const days = Number(m[3] ?? 0);
  const hours = Number(m[4] ?? 0);
  const mins = Number(m[5] ?? 0);
  const secs = Number(m[6] ?? 0);
  const total = ((((weeks * 7 + days) * 24 + hours) * 60 + mins) * 60 + secs) * 1000;
  return total > 0 ? sign * total : null;
}

/** Parse all VEVENT blocks from an ICS payload, returning ONLY timing metadata. */
export function parseIcsTimings(raw: string): ParsedVEventTiming[] {
  const lines = unfoldIcs(raw);
  const out: ParsedVEventTiming[] = [];
  let inEvent = false;
  let inAlarm = false;

  let uid: string | null = null;
  let start: { iso: string; allDay: boolean } | null = null;
  let end: { iso: string; allDay: boolean } | null = null;
  let durationMs: number | null = null;
  let transparent = false;
  let cancelled = false;
  let rrule: string | null = null;
  let exdates = new Set<string>();

  const flush = () => {
    if (!start) return;
    const startMs = Date.parse(start.iso);
    let endMs = end ? Date.parse(end.iso) : NaN;
    if (Number.isNaN(endMs) || endMs <= startMs) {
      if (durationMs && durationMs > 0) endMs = startMs + durationMs;
      else endMs = startMs + (start.allDay ? 86_400_000 : 3_600_000);
    }
    out.push({
      uid,
      startsAt: new Date(startMs).toISOString(),
      endsAt: new Date(endMs).toISOString(),
      allDay: start.allDay,
      transparent,
      cancelled,
      rrule,
      exdates,
    });
  };

  for (const line of lines) {
    if (line === 'BEGIN:VEVENT') {
      inEvent = true;
      inAlarm = false;
      uid = null;
      start = null;
      end = null;
      durationMs = null;
      transparent = false;
      cancelled = false;
      rrule = null;
      exdates = new Set();
      continue;
    }
    if (line === 'END:VEVENT') {
      flush();
      inEvent = false;
      inAlarm = false;
      continue;
    }
    if (!inEvent) continue;
    if (line === 'BEGIN:VALARM') {
      inAlarm = true;
      continue;
    }
    if (line === 'END:VALARM') {
      inAlarm = false;
      continue;
    }
    if (inAlarm) continue;

    const colon = line.indexOf(':');
    if (colon < 0) continue;
    const head = line.slice(0, colon);
    const val = line.slice(colon + 1);
    const semi = head.indexOf(';');
    const prop = (semi >= 0 ? head.slice(0, semi) : head).toUpperCase();
    const params = semi >= 0 ? head.slice(semi + 1) : '';

    if (prop === 'UID') uid = val.trim();
    else if (prop === 'DTSTART') start = parseIcsDateValue(params, val);
    else if (prop === 'DTEND') end = parseIcsDateValue(params, val);
    else if (prop === 'DURATION') durationMs = parseDurationMs(val);
    else if (prop === 'TRANSP') transparent = val.trim().toUpperCase() === 'TRANSPARENT';
    else if (prop === 'STATUS') cancelled = val.trim().toUpperCase() === 'CANCELLED';
    else if (prop === 'RRULE') rrule = val.trim();
    else if (prop === 'EXDATE') {
      for (const piece of val.split(',')) {
        const parsed = parseIcsDateValue(params, piece);
        if (parsed) exdates.add(parsed.iso.slice(0, 16));
      }
    }
  }

  return out;
}

const WEEKDAY_MAP: Record<string, number> = { SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6 };

/**
 * Expand a single parsed VEVENT (including common DAILY/WEEKLY/MONTHLY/YEARLY
 * RRULEs) into busy intervals intersecting `[windowStart, windowEnd]`.
 * Caps iterations defensively so malformed RRULEs never burn Worker CPU.
 */
export function expandTimingToBusy(
  ev: ParsedVEventTiming,
  windowStart: Date,
  windowEnd: Date,
): Array<{ starts_at: string; ends_at: string; all_day: boolean }> {
  if (ev.transparent || ev.cancelled) return [];
  const winStartMs = windowStart.getTime();
  const winEndMs = windowEnd.getTime();
  const startMs = Date.parse(ev.startsAt);
  const endMs = Date.parse(ev.endsAt);
  const durMs = Math.max(60_000, endMs - startMs);

  if (!ev.rrule) {
    if (endMs <= winStartMs || startMs >= winEndMs) return [];
    return [{ starts_at: ev.startsAt, ends_at: ev.endsAt, all_day: ev.allDay }];
  }

  const parts = new Map<string, string>();
  for (const token of ev.rrule.split(';')) {
    const eq = token.indexOf('=');
    if (eq > 0) parts.set(token.slice(0, eq).toUpperCase(), token.slice(eq + 1).toUpperCase());
  }

  const freq = parts.get('FREQ');
  if (!freq || !['DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY'].includes(freq)) {
    if (endMs <= winStartMs || startMs >= winEndMs) return [];
    return [{ starts_at: ev.startsAt, ends_at: ev.endsAt, all_day: ev.allDay }];
  }

  const interval = Math.max(1, Number(parts.get('INTERVAL') ?? 1) || 1);
  const countLimit = parts.has('COUNT') ? Math.max(1, Number(parts.get('COUNT')) || 1) : 500;
  let untilMs = winEndMs;
  if (parts.has('UNTIL')) {
    const u = parseIcsDateValue('', parts.get('UNTIL')!);
    if (u) untilMs = Math.min(untilMs, Date.parse(u.iso) + (u.allDay ? 86_400_000 : 0));
  }
  const byDayRaw = parts.get('BYDAY');
  const byDays = byDayRaw
    ? byDayRaw
        .split(',')
        .map((s) => WEEKDAY_MAP[s.slice(-2)])
        .filter((d): d is number => d !== undefined)
    : null;

  const out: Array<{ starts_at: string; ends_at: string; all_day: boolean }> = [];
  let cursor = new Date(startMs);
  let generated = 0;

  for (let iter = 0; iter < 1000 && generated < countLimit; iter++) {
    const candidates: Date[] = [];
    if (freq === 'WEEKLY' && byDays && byDays.length > 0) {
      const weekStart = new Date(cursor.getTime());
      weekStart.setUTCDate(weekStart.getUTCDate() - weekStart.getUTCDay());
      for (const wd of [...new Set(byDays)].sort((a, b) => a - b)) {
        const d = new Date(weekStart.getTime());
        d.setUTCDate(d.getUTCDate() + wd);
        if (d.getTime() >= startMs) candidates.push(d);
      }
    } else {
      candidates.push(new Date(cursor.getTime()));
    }

    let pastUntil = false;
    for (const c of candidates) {
      const cMs = c.getTime();
      if (cMs > untilMs) {
        pastUntil = true;
        break;
      }
      generated++;
      if (generated > countLimit) break;
      const iso = c.toISOString();
      if (ev.exdates.has(iso.slice(0, 16))) continue;
      const cEndMs = cMs + durMs;
      if (cEndMs > winStartMs && cMs < winEndMs) {
        out.push({
          starts_at: iso,
          ends_at: new Date(cEndMs).toISOString(),
          all_day: ev.allDay,
        });
      }
    }
    if (pastUntil || cursor.getTime() > untilMs) break;

    if (freq === 'DAILY') cursor.setUTCDate(cursor.getUTCDate() + interval);
    else if (freq === 'WEEKLY') cursor.setUTCDate(cursor.getUTCDate() + 7 * interval);
    else if (freq === 'MONTHLY') cursor.setUTCMonth(cursor.getUTCMonth() + interval);
    else if (freq === 'YEARLY') cursor.setUTCFullYear(cursor.getUTCFullYear() + interval);
  }

  return out;
}
