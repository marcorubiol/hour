/**
 * AHORA — the gig day of a touring technician, one screen (ADR-146).
 *
 * A mode of Hoy, not a lens: it reads the pulse's rows (the same feeds, the
 * same person axis, every space of the viewer) and answers three questions a
 * hand and a glance can afford: what am I in, what comes next and in how many
 * minutes, and where do I have to be. This module is the truth: pure, clock
 * free (`now` is a parameter), no words. The screen (`AhoraView.svelte`)
 * fetches, translates and draws.
 *
 * ── THE DAY IS THE WORKING DAY ─────────────────────────────────────────
 * Not the calendar's: what is yours today (performances, and trips with
 * their stages), and once all of it is over, tomorrow (the eve asks for
 * tomorrow's call). A show that ends past midnight is still «today» until
 * its last moment. Only today and tomorrow: Ahora is the next 48 hours.
 *
 * ── ONE TIMELINE ───────────────────────────────────────────────────────
 * The trip in the morning and the show at night are one screen, in order:
 * every running-order moment and every stage departure is a point, sorted
 * by instant across the day's rows.
 */

import type { Json } from './db-types';
import { dayKeyInTz, addDaysIso } from './planner';
import { wallClockToInstant } from './datetime';
import {
  dayMoments,
  perfWorkspaceId,
  type DateEvent,
  type MomentKey,
  type PerformanceEvent,
} from './month-events';
import { performanceAttribution, timedStages } from './pulse';
import type { PersonAttribution, PersonAttributionScope } from './people';
import type { TransportMode, TravelStageRow } from './travel-stage';

/** A moment of the day, as Ahora draws it. */
export type AhoraPoint =
  | {
      of: 'moment';
      itemId: string;
      at: string;
      tz: string | null;
      /** One of the named kinds, or null for a free moment (`label`). */
      key: MomentKey | null;
      label: string | null;
    }
  | {
      of: 'stage';
      itemId: string;
      at: string;
      tz: string | null;
      mode: TransportMode;
      stage: TravelStageRow;
    };

/** A row of the day: a performance or a trip. */
export interface AhoraItem {
  of: 'performance' | 'date';
  id: string;
  row: PerformanceEvent | DateEvent;
  /** The company (ADR-146 § 6: every block carries its monogram). */
  workspaceId: string | null;
  /** The venue's zone, when it has one: every hour is venue-first. */
  tz: string | null;
  day: string;
  attribution: PersonAttribution;
  points: AhoraPoint[];
  /** Instants (ms): the first point, and when the row is over. */
  start: number;
  end: number;
}

interface AhoraInput {
  performances: readonly PerformanceEvent[];
  dates: readonly DateEvent[];
  viewerTz: string;
  axis?: PersonAttributionScope | null;
}

const TERMINAL: ReadonlySet<string> = new Set(['wrap', 'curfew']);

function endOfDayKey(day: string, tz: string): number {
  const next = wallClockToInstant(`${addDaysIso(day, 1)}T00:00`, tz);
  return next ? Date.parse(next) : Date.parse(`${addDaysIso(day, 1)}T00:00:00Z`);
}

function startOfDayKey(day: string, tz: string): number {
  const at = wallClockToInstant(`${day}T00:00`, tz);
  return at ? Date.parse(at) : Date.parse(`${day}T00:00:00Z`);
}

const byAt = (a: { at: string }, b: { at: string }) => Date.parse(a.at) - Date.parse(b.at);

function performanceItem(p: PerformanceEvent, viewerTz: string, attribution: PersonAttribution): AhoraItem {
  const tz = p.venue?.timezone ?? null;
  const zone = tz || viewerTz;
  const day = p.performed_at.slice(0, 10);
  const points: AhoraPoint[] = dayMoments(p)
    .filter((m) => Number.isFinite(Date.parse(m.at)))
    .map((m) => ({ of: 'moment' as const, itemId: p.id, at: m.at, tz, key: m.key, label: m.label }))
    .sort(byAt);
  const first = points[0];
  const last = points.at(-1);
  // A sheet that closes (wrap, curfew) ends there; one that does not runs to
  // the end of its day, the pulse's honest horizon.
  const end =
    last && last.of === 'moment' && last.key && TERMINAL.has(last.key)
      ? Date.parse(last.at)
      : Math.max(endOfDayKey(day, zone), last ? Date.parse(last.at) : 0);
  return {
    of: 'performance',
    id: p.id,
    row: p,
    workspaceId: perfWorkspaceId(p),
    tz,
    day,
    attribution,
    points,
    start: first ? Date.parse(first.at) : startOfDayKey(day, zone),
    end,
  };
}

function tripItem(d: DateEvent, viewerTz: string, attribution: PersonAttribution): AhoraItem {
  const tz = d.venue?.timezone ?? null;
  const zone = tz || viewerTz;
  const day = dayKeyInTz(d.starts_at, zone);
  const stages = timedStages(d);
  const points: AhoraPoint[] = stages.map((s) => ({
    of: 'stage' as const,
    itemId: d.id,
    at: s.depart_at!,
    tz: s.depart_tz ?? tz,
    mode: s.mode,
    stage: s,
  }));
  const last = stages.at(-1);
  const lastAt = last ? Date.parse(last.arrive_at ?? last.depart_at!) : NaN;
  return {
    of: 'date',
    id: d.id,
    row: d,
    workspaceId: d.project?.workspace_id ?? null,
    tz,
    day,
    attribution,
    points,
    start: points[0] ? Date.parse(points[0].at) : startOfDayKey(day, zone),
    end: Number.isFinite(lastAt) ? lastAt : endOfDayKey(day, zone),
  };
}

/**
 * Every row Ahora may draw: performances and trips, not cancelled, and not
 * somebody else's (the pulse's rule: only `no` is dropped, ADR-096).
 */
export function ahoraItems(input: AhoraInput): AhoraItem[] {
  const axis = input.axis?.active ? input.axis : null;
  const out: AhoraItem[] = [];
  for (const p of input.performances) {
    if (p.status === 'cancelled') continue;
    const attribution = performanceAttribution(p, axis);
    if (attribution === 'no') continue;
    out.push(performanceItem(p, input.viewerTz, attribution));
  }
  for (const d of input.dates) {
    if (d.status === 'cancelled' || d.kind !== 'travel_day') continue;
    const attribution: PersonAttribution = axis
      ? axis.attribute({
          projectId: d.project?.id ?? null,
          day: dayKeyInTz(d.starts_at, d.venue?.timezone || input.viewerTz),
          commitments: d.commitments,
        })
      : 'explicit';
    if (attribution === 'no') continue;
    out.push(tripItem(d, input.viewerTz, attribution));
  }
  return out.sort((a, b) => a.start - b.start);
}

/**
 * THE DAY AHORA SHOWS: the first of yesterday, today and tomorrow (viewer
 * zone) with a row still not over. Yesterday only for a show past midnight;
 * tomorrow once today is done. Null: nothing in the next 48 hours.
 */
export function ahoraDay(items: readonly AhoraItem[], now: Date, viewerTz: string): string | null {
  const today = dayKeyInTz(now.toISOString(), viewerTz);
  const t = now.getTime();
  for (const day of [addDaysIso(today, -1), today, addDaysIso(today, 1)]) {
    if (items.some((i) => i.day === day && i.end > t)) return day;
  }
  return null;
}

/** The rows of one day, and its timeline. */
export function ahoraTimeline(items: readonly AhoraItem[], day: string): { items: AhoraItem[]; points: AhoraPoint[] } {
  const mine = items.filter((i) => i.day === day);
  return { items: mine, points: mine.flatMap((i) => i.points).sort(byAt) };
}

/** Minutes to an instant, rounded UP: it never says «0 min» before it happens. */
export function minutesTo(at: string, now: Date): number {
  return Math.ceil((Date.parse(at) - now.getTime()) / 60_000);
}

/** A countdown in hours and minutes, for the words the screen owns. */
export function countdownParts(minutes: number): { h: number; m: number } {
  const n = Math.max(0, minutes);
  return { h: Math.floor(n / 60), m: n % 60 };
}

/** When a point stops being «now»: a stage at its arrival, a moment at the next point. */
function pointEnd(p: AhoraPoint, next: AhoraPoint | undefined): number {
  if (p.of === 'stage' && p.stage.arrive_at) return Date.parse(p.stage.arrive_at);
  if (p.of === 'moment' && p.key && TERMINAL.has(p.key)) return Date.parse(p.at);
  return next ? Date.parse(next.at) : Number.POSITIVE_INFINITY;
}

export interface AhoraState {
  /** What you are in, null between things or once the day is done. */
  current: AhoraPoint | null;
  /** When `current` ends (an instant), when it is a real one. */
  currentUntil: string | null;
  /** The next point still ahead. */
  next: AhoraPoint | null;
  /** The headline: a countdown to `next`, what you are in, or the day done. */
  headline: 'countdown' | 'doing' | 'done';
}

/** Within this, the countdown beats what you are in («Función en 30 min»). */
const IMMINENT_MIN = 60;

export function ahoraState(points: readonly AhoraPoint[], now: Date): AhoraState {
  const t = now.getTime();
  let current: AhoraPoint | null = null;
  let currentUntil: string | null = null;
  let next: AhoraPoint | null = null;
  for (let i = 0; i < points.length; i += 1) {
    const p = points[i];
    const at = Date.parse(p.at);
    if (at > t) {
      next = p;
      break;
    }
    const end = pointEnd(p, points[i + 1]);
    if (t < end) {
      current = p;
      currentUntil = Number.isFinite(end) ? new Date(end).toISOString() : null;
    } else {
      current = null;
      currentUntil = null;
    }
  }
  const headline =
    next && minutesTo(next.at, now) <= IMMINENT_MIN
      ? 'countdown'
      : current
        ? 'doing'
        : next
          ? 'countdown'
          : 'done';
  return { current, currentUntil, next, headline };
}

/** Has this point gone by (and is not what you are in)? */
export function pointPast(p: AhoraPoint, state: AhoraState, now: Date): boolean {
  return Date.parse(p.at) <= now.getTime() && p !== state.current;
}

// ── The venue's contact to call ──────────────────────────────────────────

export interface VenueCall {
  name: string;
  role: string | null;
  phone: string | null;
  /** Why this one: a technical role, production, or the main contact. */
  by: 'technical' | 'production' | 'main';
}

const fold = (s: string) =>
  s
    .toLocaleLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '');

/** Roles that say «technical» in the four languages and the trade's English. */
const TECHNICAL_WORDS = ['tecnic', 'techn', 'tech ', 'regie', 'regid', 'stage', 'luz', 'luces', 'llum', 'light', 'sonido', 'sound', 'maquin'];
const PRODUCTION_WORDS = ['produc'];

function contactsOf(raw: Json | null | undefined): Array<{ name: string; role: string | null; phone: string | null }> {
  if (!Array.isArray(raw)) return [];
  const out: Array<{ name: string; role: string | null; phone: string | null }> = [];
  for (const c of raw) {
    if (!c || typeof c !== 'object' || Array.isArray(c)) continue;
    const o = c as Record<string, Json>;
    if (typeof o.name !== 'string' || !o.name.trim()) continue;
    out.push({
      name: o.name.trim(),
      role: typeof o.role === 'string' && o.role.trim() ? o.role.trim() : null,
      phone: typeof o.phone === 'string' && o.phone.trim() ? o.phone.trim() : null,
    });
  }
  return out;
}

/**
 * WHO TO CALL AT THE VENUE (ADR-146): `venue.contacts` has a free `role`, so
 * «technical» is deduced from its words: the first technical contact, else
 * the first in production, else the main one (the first). Among those with a
 * phone first, because the button calls; with no phone on file anywhere, the
 * same rule still names the person (and the screen draws no call).
 */
export function venueCall(raw: Json | null | undefined): VenueCall | null {
  const all = contactsOf(raw);
  if (all.length === 0) return null;
  const has = (words: string[]) => (c: { role: string | null }) =>
    !!c.role && words.some((w) => `${fold(c.role!)} `.includes(w));
  const pick = (list: typeof all): VenueCall | null => {
    const tech = list.find(has(TECHNICAL_WORDS));
    if (tech) return { ...tech, by: 'technical' };
    const prod = list.find(has(PRODUCTION_WORDS));
    if (prod) return { ...prod, by: 'production' };
    return list[0] ? { ...list[0], by: 'main' } : null;
  };
  return pick(all.filter((c) => c.phone)) ?? pick(all);
}

/** A `tel:` link: the digits and a leading plus, nothing a dialer chokes on. */
export function telHref(phone: string): string {
  return `tel:${phone.replace(/[^\d+]/g, '')}`;
}

/** Apple Maps opens the app on an iPhone and the web elsewhere (ADR-146). */
export function mapsHref(parts: readonly (string | null | undefined)[]): string | null {
  const q = parts.filter((p): p is string => typeof p === 'string' && p.trim() !== '').join(', ');
  return q ? `https://maps.apple.com/?q=${encodeURIComponent(q)}` : null;
}

// ── Hotel, parking, load access: fixed keys in `logistics` ───────────────

/**
 * THE FIXED KEYS (ADR-146 § 4, no migration). `performance.logistics` stays a
 * free object of lines; these three keys have a meaning Ahora draws in place
 * when present. Canonical: `hotel`, `parking`, `load_access`. Recognised
 * without case or accents, with the words people already type in the four
 * languages (a line «Hotel: Ultònia», «Aparcamiento: ...»), and the old
 * `accommodation`.
 */
export const LOGISTICS_KEYS = {
  hotel: ['hotel', 'accommodation', 'alojamiento', 'allotjament', 'hebergement'],
  parking: ['parking', 'aparcamiento', 'aparcament', 'estacionamiento', 'stationnement'],
  load_access: ['load_access', 'load access', 'acceso de carga', 'acceso carga', 'acces de carrega', 'carga', 'carrega', 'acces de chargement', 'chargement'],
} as const;

export type LogisticsKey = keyof typeof LOGISTICS_KEYS;

function textOf(v: Json): string | null {
  if (v === null || v === undefined) return null;
  if (typeof v === 'string') return v.trim() || null;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  if (Array.isArray(v)) return v.map(textOf).filter(Boolean).join(' · ') || null;
  return Object.values(v as Record<string, Json>).map(textOf).filter(Boolean).join(' · ') || null;
}

/** The three fixed lines a logistics object carries, as text. */
export function logisticsLines(raw: Json | null | undefined): Partial<Record<LogisticsKey, string>> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out: Partial<Record<LogisticsKey, string>> = {};
  for (const [k, v] of Object.entries(raw as Record<string, Json>)) {
    const key = fold(k).replace(/_/g, ' ').trim();
    for (const [canon, words] of Object.entries(LOGISTICS_KEYS) as [LogisticsKey, readonly string[]][]) {
      if (out[canon]) continue;
      if (words.some((w) => fold(w).replace(/_/g, ' ') === key)) {
        const text = textOf(v);
        if (text) out[canon] = text;
      }
    }
  }
  return out;
}

// ── Freshness and the way back in ────────────────────────────────────────

/** Older than this, Ahora says how old its data is. */
export const FRESH_MS = 3_600_000;

/**
 * THE FRESHNESS LINE (ADR-146 § 3, amends ADR-144 § 6 for Ahora only): one
 * line saying when the data was last updated, only without network or when
 * it is older than an hour. A load-in moved by an hour that never reached
 * the phone is the expensive mistake of a tour; a line that is always there
 * is a line nobody reads.
 */
export function freshnessShown(updatedAt: number | null | undefined, now: number, online: boolean): boolean {
  if (!updatedAt) return false;
  return !online || now - updatedAt > FRESH_MS;
}

/** The road sheet Ahora asks for (ADR-146 § 6): the whole one for the
    space's crew, the technician's cut for a guest. Like every door of the
    frame, a role that has not arrived reads as able: the server clamps it
    (`roadsheetRoleFor`), so asking for more never shows more. */
export function ahoraRoadsheetRole(myRole: string | null | undefined): 'full' | 'tech_manager' {
  return myRole === 'guest' ? 'tech_manager' : 'full';
}

/** Ahora was open on this day: the home-screen app opens straight in it. */
export const AHORA_KEY = 'hour.ahora';

export function ahoraRelaunch(stored: string | null | undefined, today: string): boolean {
  return stored === today;
}
