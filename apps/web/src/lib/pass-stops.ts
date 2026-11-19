/**
 * EL DÍA, PARADA A PARADA (brief `ficha-pase`, phase 2; ADR-213).
 *
 * The performance's page draws its running order as stops on a line
 * (`RunningOrder` with `placing="stops"`). The rows are still the running
 * order's own, in the hand's order (ADR-090 P3). This module says what the
 * page adds AROUND them, read-only, and where each fact hangs:
 *
 * - EXTRA STOPS: a trip of the same project that day lends its stages
 *   (departure and arrival, with a link to the trip; the user's answer 3 of
 *   18-11); the show itself, when nobody wrote its hour yet (a stop with a
 *   dash instead of an hour); and the night (the hotel, when the logistics
 *   say one).
 * - HANGS: the address and the load access go to the arrival (the trip's,
 *   else the load-in, else the show), the venue's contact to the load-in
 *   (else the show).
 * - THE TEMPLATE: «Rellenar el día» writes load-in, soundcheck and load-out
 *   around the show's hour, only when the person presses it, with hours they
 *   can change first (answer 1 of 18-11, an exception to ADR-090's «never a
 *   placeholder five»).
 *
 * Pure: no clock, no network. The screen says the words.
 */

import { instantToWallClock, wallClockToInstant } from './datetime';
import type { ScheduleSlotInput } from './schedule-slot';

/** A stop the page adds: never written, never dragged. */
export interface ExtraStop {
  key: string;
  /** Its instant; null draws a dash (the show without an hour, the night). */
  at: string | null;
  kind: 'depart' | 'arrive' | 'show' | 'night';
}

export type StopItem<E extends ExtraStop = ExtraStop> =
  | { type: 'row'; index: number }
  | { type: 'extra'; stop: E };

/** Kinds that close the day: a show without an hour goes before them. */
const AFTER_SHOW: readonly string[] = ['loadout', 'wrap', 'curfew'];

const ms = (iso: string) => new Date(iso).getTime();

/**
 * The rows, in their own (hand-made) order, with the extra stops woven in.
 *
 * A timed extra goes before the first row that is later than it, so it never
 * reorders the rows. The show without an hour goes before the first row that
 * closes the day (load-out, wrap, curfew), else at the end. The night is
 * always last. Extras keep their given order among themselves when they tie.
 */
export function weaveStops<E extends ExtraStop>(
  rows: ReadonlyArray<Pick<ScheduleSlotInput, 'kind' | 'at'>>,
  extras: readonly E[],
): StopItem<E>[] {
  const before = new Map<number, E[]>();
  const tail: E[] = [];
  const night: E[] = [];
  const put = (i: number, e: E) => {
    const list = before.get(i) ?? [];
    list.push(e);
    before.set(i, list);
  };

  for (const e of extras) {
    if (e.kind === 'night') {
      night.push(e);
      continue;
    }
    let i = -1;
    if (e.at !== null) {
      const t = ms(e.at);
      i = rows.findIndex((r) => ms(r.at) > t);
    } else {
      i = rows.findIndex((r) => r.kind !== null && AFTER_SHOW.includes(r.kind));
    }
    if (i === -1) tail.push(e);
    else put(i, e);
  }

  const out: StopItem<E>[] = [];
  rows.forEach((_, index) => {
    for (const stop of before.get(index) ?? []) out.push({ type: 'extra', stop });
    out.push({ type: 'row', index });
  });
  for (const stop of tail) out.push({ type: 'extra', stop });
  for (const stop of night) out.push({ type: 'extra', stop });
  return out;
}

/** Where a fact hangs: a row by its kind, or one of the page's own stops. */
export type HangAt = 'arrive' | 'load_in' | 'start' | 'show';

/**
 * Where the address and the contact hang, given what the day has.
 *
 * - The address (and the load access): the arrival when a trip lands there,
 *   else the load-in, else the show (its row, or its dashed stop).
 * - The contact: the load-in (who opens the door), else the show.
 */
export function hangPlaces(
  kinds: ReadonlyArray<string | null>,
  hasArrival: boolean,
): { address: HangAt; contact: HangAt } {
  const has = (k: string) => kinds.includes(k);
  const show: HangAt = has('start') ? 'start' : 'show';
  return {
    address: hasArrival ? 'arrive' : has('load_in') ? 'load_in' : show,
    contact: has('load_in') ? 'load_in' : show,
  };
}

/** One moment the template offers, with the hour it proposes. */
export interface TemplateMoment {
  kind: 'load_in' | 'soundcheck' | 'loadout';
  /** Minutes from the show's start: load-in 5 h before, soundcheck 2 h
      before, load-out 2 h after (the drawing's «como en tus últimos bolos»
      has no data behind it yet, so these are fixed and said as editable). */
  offset: number;
}

export const DAY_TEMPLATE: readonly TemplateMoment[] = [
  { kind: 'load_in', offset: -5 * 60 },
  { kind: 'soundcheck', offset: -2 * 60 },
  { kind: 'loadout', offset: 2 * 60 },
];

/** The moments the template still has to offer: the ones the day lacks. */
export function templateFor(kinds: ReadonlyArray<string | null>): TemplateMoment[] {
  if (!kinds.includes('start')) return [];
  return DAY_TEMPLATE.filter((m) => !kinds.includes(m.kind));
}

/** The proposed instant of a template moment: the show's start plus its offset. */
export function templateAt(startIso: string, m: TemplateMoment): string {
  return new Date(ms(startIso) + m.offset * 60_000).toISOString();
}

/**
 * The instant of a template moment once its clock is (re)typed: the instant
 * at that wall clock nearest to the proposed one. A show at 1h lands its
 * load-in the evening before, and an hour left as proposed stays exactly
 * that instant, never moved to another day.
 */
export function templateClockAt(
  proposedIso: string,
  clock: { h: number; m: number },
  tz: string,
): string | null {
  const day = instantToWallClock(proposedIso, tz).slice(0, 10);
  const shift = (d: string, n: number) => {
    const x = new Date(`${d}T12:00:00Z`);
    x.setUTCDate(x.getUTCDate() + n);
    return x.toISOString().slice(0, 10);
  };
  const hm = `${String(clock.h).padStart(2, '0')}:${String(clock.m).padStart(2, '0')}`;
  const target = ms(proposedIso);
  let best: string | null = null;
  for (const n of [-1, 0, 1]) {
    const at = wallClockToInstant(`${shift(day, n)}T${hm}`, tz);
    if (at !== null && (best === null || Math.abs(ms(at) - target) < Math.abs(ms(best) - target))) best = at;
  }
  return best;
}

/**
 * The order after «Rellenar el día»: each new moment placed by its hour
 * among the rows that are there (the running order's own law, `placeByTime`,
 * applied one at a time), the rows already written untouched.
 */
export function fillDay(
  order: readonly ScheduleSlotInput[],
  moments: ReadonlyArray<{ kind: string; at: string }>,
  place: (order: ScheduleSlotInput[], slot: ScheduleSlotInput) => ScheduleSlotInput[],
): ScheduleSlotInput[] {
  let next = [...order];
  for (const m of moments) {
    next = place(next, { kind: m.kind, label: null, at: m.at, ends_at: null, notes: null });
  }
  return next;
}

/** A wall hour on a day in a zone, as an instant (the card's «poner la hora»). */
export function showInstant(dayIso: string, h: number, m: number, tz: string): string | null {
  return wallClockToInstant(`${dayIso}T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`, tz);
}

/** A trip's stage, as the page reads it from `/api/dates?stages=1`. */
export interface TripStage {
  id: string;
  depart_at: string | null;
  arrive_at: string | null;
  from_city: string | null;
  from_place: string | null;
  to_city: string | null;
  to_place: string | null;
}

export interface TripStop extends ExtraStop {
  kind: 'depart' | 'arrive';
  at: string;
  /** Where it leaves from, or where it lands. */
  place: string | null;
  tripId: string;
}

/**
 * The stops a trip lends the day: the first departure and the last arrival
 * that fall on the day in its zone (`dayOf`), not every leg. A day with two
 * trains is still «salida» and «llegada»; the trip itself says the rest.
 */
export function tripStops(
  tripId: string,
  stages: readonly TripStage[],
  onDay: (iso: string) => boolean,
): TripStop[] {
  const out: TripStop[] = [];
  const departs = stages.filter((s) => s.depart_at && onDay(s.depart_at));
  const arrives = stages.filter((s) => s.arrive_at && onDay(s.arrive_at));
  const first = departs[0];
  const last = arrives[arrives.length - 1];
  if (first?.depart_at) {
    out.push({
      key: `${tripId}:depart`,
      kind: 'depart',
      at: first.depart_at,
      place: first.from_place || first.from_city,
      tripId,
    });
  }
  if (last?.arrive_at) {
    out.push({
      key: `${tripId}:arrive`,
      kind: 'arrive',
      at: last.arrive_at,
      place: last.to_place || last.to_city,
      tripId,
    });
  }
  return out;
}
