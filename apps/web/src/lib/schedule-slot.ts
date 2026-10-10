/**
 * The running order of a gig, as rows (ADR-090 P1).
 *
 * The five timeslots of ADR-023 used to be columns on `performance`. Since
 * migration 20261009200000 they are `schedule_slot` rows with a `kind`, and
 * the five fields every surface reads (`load_in_at` … `wrap_at`) are DERIVED
 * here, at the server boundary: the API keeps its shape and no screen changes.
 * The first slot of each kind (by `sort`) is the one that counts.
 *
 * Writing is not here (ADR-090 P2): the running order is written into its
 * collab doc (`schedule-doc.ts`) and the Durable Object materializes these
 * rows. What stays is the read side and the two rules a writer applies: the
 * order of the five (`timeslotsOrdered`) and the venue's clock
 * (`reinterpretSlots`).
 */

import { instantToWallClock, wallClockToInstant } from './datetime';

/** The five legacy timeslots, in their canonical order (ADR-023). */
export const TIMESLOT_KINDS = [
  ['load_in', 'load_in_at'],
  ['soundcheck', 'soundcheck_at'],
  ['start', 'start_at'],
  ['loadout', 'loadout_at'],
  ['wrap', 'wrap_at'],
] as const;

export type TimeslotField = (typeof TIMESLOT_KINDS)[number][1];

export type TimeslotFields = { [K in TimeslotField]: string | null };

export const TIMESLOT_FIELDS: readonly TimeslotField[] = TIMESLOT_KINDS.map(([, f]) => f);

/** A slot as it comes from PostgREST (the embed or the RPC). */
export interface ScheduleSlotRow {
  id: string;
  kind: string | null;
  label: string | null;
  at: string;
  ends_at: string | null;
  sort: number;
  notes: string | null;
}

/** One moment as an editor writes it: the order of the array is the order. */
export interface ScheduleSlotInput {
  id?: string;
  kind: string | null;
  label: string | null;
  at: string;
  ends_at: string | null;
  notes: string | null;
}

/** The embed to put in a `performance` select. */
export const SCHEDULE_SLOT_EMBED = 'schedule_slot(id,kind,label,at,ends_at,sort,notes)';

export const EMPTY_TIMESLOTS: TimeslotFields = {
  load_in_at: null,
  soundcheck_at: null,
  start_at: null,
  loadout_at: null,
  wrap_at: null,
};

/** The five fields, from a performance's slots. */
export function timeslotsFromSlots(
  slots: ReadonlyArray<Pick<ScheduleSlotRow, 'kind' | 'at' | 'sort'>> | null | undefined,
): TimeslotFields {
  const out: TimeslotFields = { ...EMPTY_TIMESLOTS };
  const sorted = [...(slots ?? [])].sort((a, b) => a.sort - b.sort);
  for (const [kind, field] of TIMESLOT_KINDS) {
    out[field] = sorted.find((s) => s.kind === kind)?.at ?? null;
  }
  return out;
}

/**
 * Replace a row's embedded `schedule_slot` with the five fields. The embed is
 * dropped: no surface reads it yet, and the API stays what it was.
 */
export function withTimeslots<T extends { schedule_slot?: ScheduleSlotRow[] | null }>(
  row: T,
): Omit<T, 'schedule_slot'> & TimeslotFields {
  const { schedule_slot, ...rest } = row;
  return { ...rest, ...timeslotsFromSlots(schedule_slot) };
}

/**
 * One moment of the running order as the READ surfaces need it (the day
 * strip, the road sheet): what it is called and when, in its order. No id,
 * no notes: those are the editor's, and it reads `/api/schedule`.
 */
export type ScheduleMoment = Pick<ScheduleSlotRow, 'kind' | 'label' | 'at' | 'ends_at'>;

/** The whole order, compacted for a feed. */
export function scheduleOf(slots: readonly ScheduleSlotRow[] | null | undefined): ScheduleMoment[] {
  return [...(slots ?? [])]
    .sort((a, b) => a.sort - b.sort)
    .map(({ kind, label, at, ends_at }) => ({ kind, label, at, ends_at }));
}

/**
 * `withTimeslots` plus the whole order as `schedule` (ADR-090 P3): the five
 * fields stay for every surface that reads them, and the strip and the road
 * sheet get the free moments too («photo call»), in their order.
 */
export function withSchedule<T extends { schedule_slot?: ScheduleSlotRow[] | null }>(
  row: T,
): Omit<T, 'schedule_slot'> & TimeslotFields & { schedule: ScheduleMoment[] } {
  return { ...withTimeslots(row), schedule: scheduleOf(row.schedule_slot) };
}

/**
 * THE VENUE MOVED ZONE, THE CLOCK STAYS (Marco, 2026-10-10). A running order
 * is typed in the venue's wall clock; relinking a gig to a venue in another
 * timezone keeps «load-in at 10h» at 10h ON THE NEW VENUE'S CLOCK, which is
 * a new instant. Same rule the details dialog used to apply to the five.
 *
 * Every slot's `at` and `ends_at` are read as wall time in `fromTz` and
 * rewritten as that wall time in `toTz`. Ids, order and words are kept: only
 * hours move (`rezoneScheduleInDoc` writes them into the doc). Same zone →
 * untouched.
 */
export function reinterpretSlots<T extends Pick<ScheduleSlotRow, 'at' | 'ends_at'>>(
  slots: readonly T[],
  fromTz: string,
  toTz: string,
): T[] {
  if (fromTz === toTz) return [...slots];
  const move = (iso: string) => wallClockToInstant(instantToWallClock(iso, fromTz), toTz) ?? iso;
  return slots.map((s) => ({ ...s, at: move(s.at), ends_at: s.ends_at ? move(s.ends_at) : null }));
}

/**
 * The order rule the old CHECK `performance_timeslots_ordered` enforced, kept
 * for the five fields: ADJACENT pairs only, NULL-safe (load in + wrap with
 * nothing between never violates). Returns true when the schedule is legal.
 */
export function timeslotsOrdered(t: TimeslotFields): boolean {
  for (let i = 0; i < TIMESLOT_FIELDS.length - 1; i += 1) {
    const a = t[TIMESLOT_FIELDS[i]];
    const b = t[TIMESLOT_FIELDS[i + 1]];
    if (a && b && new Date(a).getTime() > new Date(b).getTime()) return false;
  }
  return true;
}

