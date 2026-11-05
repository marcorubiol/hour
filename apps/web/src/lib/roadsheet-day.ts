/**
 * THE DAY OF A ROAD SHEET, IN ORDER (120, ADR-177): the technician's
 * itinerary. Pure and clock free (`now` is a parameter); the sheet
 * (`RoadsheetView.svelte`) translates and draws. Apart from `$lib/roadsheet`
 * so the endpoint's module stays free of the calendar vocabulary.
 */

import { MOMENT_KEYS, type MomentKey } from './month-events';
import { dayKeyInTz } from './planner';
import type { Roadsheet, RoadsheetStage, RoadsheetTrip } from './roadsheet';

/**
 * A point of the sheet's day. The hours come from ONE place, the plan: the
 * running order (`schedule_slot`) and the timed stages of the day's trips.
 * Nothing else is a source of hours (not the chat, not a note).
 */
export type RoadsheetDayPoint =
  | {
      of: 'moment';
      at: string;
      ends_at: string | null;
      /** One of the named kinds, or null for a free moment (`label`). */
      key: MomentKey | null;
      label: string | null;
    }
  | {
      of: 'stage';
      at: string;
      /** The clock of the departure: its own zone, else the trip's. */
      tz: string | null;
      stage: RoadsheetStage;
      trip: RoadsheetTrip;
    };

const FIVE: ReadonlyArray<[MomentKey, 'load_in_at' | 'soundcheck_at' | 'start_at' | 'loadout_at' | 'wrap_at']> = [
  ['load_in', 'load_in_at'],
  ['soundcheck', 'soundcheck_at'],
  ['start', 'start_at'],
  ['loadout', 'loadout_at'],
  ['wrap', 'wrap_at'],
];

const parsed = (iso: string | null | undefined): iso is string => !!iso && Number.isFinite(Date.parse(iso));

/**
 * THE DAY IN ORDER, as an itinerary: every running-order moment and every
 * timed stage of the day's trips, sorted by instant (ties keep the written
 * order: the trip before the moment it leads to). The whole running order
 * when the sheet has it, else the five fields. A trip without a timed stage
 * has no hour and is not a point (the screen names it above the list).
 */
export function roadsheetDay(sheet: Pick<Roadsheet, 'schedule' | 'travel'>): RoadsheetDayPoint[] {
  const out: RoadsheetDayPoint[] = [];
  for (const trip of sheet.travel ?? []) {
    for (const stage of trip.stages) {
      if (parsed(stage.depart_at)) out.push({ of: 'stage', at: stage.depart_at, tz: stage.depart_tz ?? trip.tz, stage, trip });
    }
  }
  const s = sheet.schedule;
  if (s?.moments?.length) {
    for (const m of s.moments) {
      if (!parsed(m.at)) continue;
      out.push({
        of: 'moment',
        at: m.at,
        ends_at: parsed(m.ends_at) ? m.ends_at : null,
        key: m.kind && MOMENT_KEYS.has(m.kind) ? (m.kind as MomentKey) : null,
        label: m.label,
      });
    }
  } else if (s) {
    for (const [key, field] of FIVE) {
      const at = s[field];
      if (parsed(at)) out.push({ of: 'moment', at, ends_at: null, key, label: null });
    }
  }
  return out
    .map((p, i) => ({ p, i }))
    .sort((a, b) => Date.parse(a.p.at) - Date.parse(b.p.at) || a.i - b.i)
    .map(({ p }) => p);
}

/**
 * WHERE THE «NOW» LINE GOES: the index of the first point still ahead, so the
 * line is drawn just before it (`points.length` = after the last). Only on a
 * day the list covers, on the venue's clock: the day of its first point
 * through the day of its last (a show past midnight is still that day). On
 * any other day, null: no line, the sheet is read ahead or after.
 */
export function nowLineIndex(points: readonly RoadsheetDayPoint[], now: Date, tz: string): number | null {
  if (points.length === 0) return null;
  const iso = now.toISOString();
  const today = dayKeyInTz(iso, tz);
  const first = dayKeyInTz(points[0]!.at, tz);
  const last = dayKeyInTz(points[points.length - 1]!.at, tz);
  if (today < first || today > last) return null;
  const t = now.getTime();
  const i = points.findIndex((p) => Date.parse(p.at) > t);
  return i === -1 ? points.length : i;
}
