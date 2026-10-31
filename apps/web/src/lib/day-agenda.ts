/**
 * HOY'S AGENDA — one day in time order, with what is on now opened as the
 * card (ADR-150, option D of the Hoy review).
 *
 * The day is its points: every moment of a performance's running order, each
 * stage of a trip (the train at 9h12, not «viaje»), every other date at its
 * hour. The card is the point you are in or the next one, and it moves
 * through the day: in the morning the train, at noon the load-in, at night
 * the show. What has gone by dims; the performance's own hour stays marked
 * even when it is not the card, so the day's main event is never lost.
 *
 * NOW AND NEXT ARE THE PULSE'S (ADR-146). The same rows (`pulseRows`, the
 * person axis included), the same segments: a moment lasts until the next
 * moment of ITS row, a stage until its arrival, a date until its end; the
 * last moment of a sheet runs soft to midnight, a wrap or a curfew closes it.
 * Inside two things at once, the innermost wins (a rehearsal during the
 * load-in is what you are doing). And the headline rule is Ahora's: within
 * an hour the countdown to the next thing beats what you are in.
 *
 * Pure and clock-free: `now` is a parameter; the caller words and draws.
 */
import { wallClockToInstant } from './datetime';
import { dayMoments, type DateEvent, type MomentKey, type PerformanceEvent } from './month-events';
import { addDaysIso, dayKeyInTz } from './planner';
import { pulseRef, pulseRows, timedStages, type PulseInputRows, type PulseRef } from './pulse';
import type { TransportMode, TravelStageRow } from './travel-stage';

/** What a point is, as vocabulary: the caller owns the words. */
export type AgendaWhat =
  | { of: 'moment'; key: MomentKey | null; label: string | null }
  | { of: 'stage'; mode: TransportMode; stage: TravelStageRow }
  | { of: 'date'; kind: string; label: string | null };

export interface AgendaPoint {
  /** Unique within the day. */
  key: string;
  ref: PulseRef;
  what: AgendaWhat;
  /** Its hour (an instant), null for an all-day row. */
  at: string | null;
  /** The zone its hour is read in: venue first. */
  tz: string | null;
  /** Instants (ms) it occupies; `hard` = its end is a real moment. */
  from: number;
  to: number;
  hard: boolean;
  /** The day's main event: the first performance's own hour. */
  main: boolean;
}

export interface DayAgenda {
  day: string;
  points: AgendaPoint[];
  /** The point you are in, the next one ahead, and the one the card opens. */
  current: number | null;
  next: number | null;
  focus: number | null;
  /** How the card says it: a countdown, what you are in, or the next hour. */
  headline: 'countdown' | 'doing' | 'at' | 'done';
  /** When `current` ends, when that is a real moment of today. */
  until: string | null;
  /** Each point: gone by (dimmed). */
  past: boolean[];
}

/** Within this, the countdown beats what you are in (Ahora's rule). */
export const AGENDA_IMMINENT_MIN = 60;

const TERMINAL: ReadonlySet<string> = new Set(['wrap', 'curfew']);

function startOf(day: string, tz: string): number {
  const at = wallClockToInstant(`${day}T00:00`, tz);
  return at ? Date.parse(at) : Date.parse(`${day}T00:00:00Z`);
}
const endOf = (day: string, tz: string) => startOf(addDaysIso(day, 1), tz);

function performancePoints(p: PerformanceEvent, ref: PulseRef, viewerTz: string): AgendaPoint[] {
  const zone = ref.tz || viewerTz;
  const day = p.performed_at.slice(0, 10);
  const moments = dayMoments(p)
    .filter((m) => Number.isFinite(Date.parse(m.at)))
    .sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  if (moments.length === 0) {
    // A gig with no hour on file is still the day's: one untimed line.
    return [
      { key: `p:${p.id}`, ref, what: { of: 'moment', key: 'start', label: null }, at: null, tz: ref.tz, from: startOf(day, zone), to: endOf(day, zone), hard: true, main: true },
    ];
  }
  const startAt = moments.find((m) => m.key === 'start')?.at ?? p.start_at ?? null;
  const mainAt = startAt && moments.some((m) => m.at === startAt) ? startAt : moments[0].at;
  return moments.map((m, i) => {
    const next = moments[i + 1];
    const from = Date.parse(m.at);
    const terminal = !next && m.key != null && TERMINAL.has(m.key);
    return {
      key: `p:${p.id}:${i}`,
      ref,
      what: { of: 'moment', key: m.key, label: m.label },
      at: m.at,
      tz: ref.tz,
      from,
      to: terminal ? from : next ? Date.parse(next.at) : Math.max(endOf(dayKeyInTz(m.at, zone), zone), from),
      hard: Boolean(next) || terminal,
      main: m.at === mainAt,
    };
  });
}

function datePoints(d: DateEvent, ref: PulseRef, day: string, viewerTz: string): AgendaPoint[] {
  const zone = ref.tz || viewerTz;
  const stages = timedStages(d);
  if (stages.length > 0) {
    return stages
      .filter((s) => dayKeyInTz(s.depart_at!, s.depart_tz ?? zone) === day)
      .map((s, i) => {
        const from = Date.parse(s.depart_at!);
        const nextDepart = stages[stages.indexOf(s) + 1]?.depart_at;
        const arrive = s.arrive_at ? Date.parse(s.arrive_at) : NaN;
        const to = Number.isFinite(arrive) ? arrive : nextDepart ? Date.parse(nextDepart) : endOf(day, zone);
        return {
          key: `d:${d.id}:${i}`,
          ref,
          what: { of: 'stage', mode: s.mode, stage: s },
          at: s.depart_at!,
          tz: s.depart_tz ?? ref.tz,
          from,
          to: Math.max(to, from),
          hard: Number.isFinite(arrive) || Boolean(nextDepart),
          main: false,
        };
      });
  }
  const what: AgendaWhat = { of: 'date', kind: d.kind, label: d.label ?? null };
  if (d.all_day) {
    return [{ key: `d:${d.id}`, ref, what, at: null, tz: ref.tz, from: startOf(day, zone), to: endOf(day, zone), hard: true, main: false }];
  }
  const from = Date.parse(d.starts_at);
  const to = d.ends_at ? Date.parse(d.ends_at) : endOf(dayKeyInTz(d.starts_at, zone), zone);
  return [{ key: `d:${d.id}`, ref, what, at: d.starts_at, tz: ref.tz, from, to: Math.max(to, from), hard: Boolean(d.ends_at), main: false }];
}

/** Does a date touch the day? An all-day row across several days touches each. */
function dateOnDay(d: DateEvent, day: string, zone: string): boolean {
  if (!d.all_day) return dayKeyInTz(d.starts_at, zone) === day;
  const first = dayKeyInTz(d.starts_at, zone);
  const last = dayKeyInTz(d.ends_at ?? d.starts_at, zone);
  return first <= day && day <= last;
}

/** Every point of one day, in time order (all-day rows first). */
export function agendaPoints(input: PulseInputRows, day: string): AgendaPoint[] {
  const out: AgendaPoint[] = [];
  for (const r of pulseRows(input)) {
    const ref = pulseRef(r);
    if (r.of === 'performance') {
      if (r.row.performed_at.slice(0, 10) === day) out.push(...performancePoints(r.row, ref, input.viewerTz));
    } else if (dateOnDay(r.row, day, ref.tz || input.viewerTz)) {
      out.push(...datePoints(r.row, ref, day, input.viewerTz));
    }
  }
  // Only the first performance of the day is its main event.
  let mainSeen = false;
  const sorted = out.sort((a, b) => (a.at === null ? -1 : 0) - (b.at === null ? -1 : 0) || a.from - b.from);
  for (const p of sorted) {
    if (!p.main) continue;
    if (mainSeen) p.main = false;
    mainSeen = true;
  }
  return sorted;
}

/**
 * THE DAY THE AGENDA SHOWS: today while anything of it is still on or
 * ahead, else the day of what comes next (`fallback`, the pulse's).
 */
export function agendaDay(input: PulseInputRows, now: Date, fallback: string | null): string | null {
  const today = dayKeyInTz(now.toISOString(), input.viewerTz);
  const t = now.getTime();
  if (agendaPoints(input, today).some((p) => p.to > t)) return today;
  return fallback;
}

export function dayAgenda(input: PulseInputRows, day: string, now: Date): DayAgenda {
  const points = agendaPoints(input, day);
  const t = now.getTime();

  // NOW: the innermost point you are in (the latest start), timed ones only:
  // an all-day row is where you are, not what you are doing, unless it is
  // all there is.
  let current: number | null = null;
  points.forEach((p, i) => {
    if (p.from <= t && t < p.to && (current === null || p.from >= points[current].from)) current = i;
  });
  // NEXT: the first timed point still ahead.
  const nextIdx = points.findIndex((p) => p.at !== null && p.from > t);
  const next = nextIdx >= 0 ? nextIdx : null;

  // The end of a sheet (wrap, curfew) closes what you are in; it never takes
  // the card from it («Función · hasta las 22h», not «Fin en 60 min»).
  const nextWhat = next !== null ? points[next].what : null;
  const closes = current !== null && nextWhat?.of === 'moment' && nextWhat.key != null && TERMINAL.has(nextWhat.key);
  const imminent =
    next !== null && !closes && Math.ceil((points[next].from - t) / 60_000) <= AGENDA_IMMINENT_MIN;
  const headline: DayAgenda['headline'] =
    imminent ? 'countdown' : current !== null ? 'doing' : next !== null ? 'at' : 'done';
  const focus = headline === 'doing' ? current : headline === 'done' ? null : next;

  let until: string | null = null;
  if (current !== null) {
    const c = points[current];
    // Its own end when it is a real moment («Carga · hasta las 17h», even with
    // a rehearsal at 14h30 in between: that is the next row, not its end);
    // a soft end runs until the next thing starts.
    const at = c.hard ? c.to : next !== null ? points[next].from : NaN;
    if (Number.isFinite(at)) {
      const iso = new Date(at).toISOString();
      if (dayKeyInTz(iso, input.viewerTz) === dayKeyInTz(now.toISOString(), input.viewerTz)) until = iso;
    }
  }

  // Gone by: over, or a soft end overtaken by something that started after it.
  const past = points.map((p, i) => {
    if (i === current) return false;
    if (p.to <= t) return true;
    if (p.from > t || p.hard) return false;
    return points.some((q) => q.from > p.from && q.from <= t);
  });

  return { day, points, current, next, focus, headline, until, past };
}
