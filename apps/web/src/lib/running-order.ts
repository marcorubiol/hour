/**
 * THE RUNNING ORDER, as an editor sees it (ADR-090 P3).
 *
 * `schedule-slot.ts` is the storage side: rows, the five legacy fields, the
 * PATCH that moves one of them. This file is what a person does with the list
 * on the day: type an hour the way the Planner writes it, name the moment,
 * and have it land where it belongs in the order.
 *
 * Pure functions only. The screen (`RunningOrder.svelte`) and the endpoint
 * (`/api/schedule/[target]/[id]`) are the two callers.
 *
 * P2 (live editing over the collab DO) replaces how the list is WRITTEN, not
 * what it is: the editor keeps producing a whole `ScheduleSlotInput[]`, and
 * whether that goes to `replace_schedule_slots` or into a `Y.Array` is the
 * caller's business.
 */

import { hourMark, timeInTz, wallClockToInstant, instantToWallClock } from './datetime';
import { TIMESLOT_KINDS, type ScheduleSlotInput, type ScheduleSlotRow } from './schedule-slot';

/** Where a running order hangs: a performance XOR a date (ADR-090). */
export type RunningOrderTarget = 'performance' | 'date';

export const RUNNING_ORDER_TARGETS: readonly RunningOrderTarget[] = ['performance', 'date'];

/**
 * The date kinds that have a day to put in order. A travel day carries its
 * own stages (ADR-089) and a day off has nothing to order; drawing an empty
 * running order under either would be furniture.
 */
export const ORDERED_DATE_KINDS: readonly string[] = ['rehearsal', 'residency', 'press', 'other'];

/** The five kinds the road sheet and the strip already know, in stage order. */
export const LEGACY_KINDS: readonly string[] = TIMESLOT_KINDS.map(([k]) => k);

/** A clock somebody typed. Minutes since midnight. */
export type Clock = { h: number; m: number };

/**
 * What a person types for an hour, read the way the Planner writes it.
 *
 * `20h30`, `20h`, `20:30`, `20.30`, `2030`, `930`, `20` all mean what they
 * look like. Anything that is not a real wall-clock hour is null, never a
 * guess: `2575` is not «a quarter past one tomorrow».
 */
export function parseClock(text: string): Clock | null {
  const s = text.trim().toLowerCase();
  if (!s) return null;
  let h: number;
  let m: number;
  const sep = /^(\d{1,2})\s*[h:.]\s*(\d{2})?$/.exec(s);
  if (sep) {
    h = Number(sep[1]);
    m = sep[2] ? Number(sep[2]) : 0;
  } else if (/^\d{1,4}$/.test(s)) {
    if (s.length <= 2) {
      h = Number(s);
      m = 0;
    } else {
      h = Number(s.slice(0, -2));
      m = Number(s.slice(-2));
    }
  } else {
    return null;
  }
  if (h > 23 || m > 59) return null;
  return { h, m };
}

/** `{h: 9, m: 5}` → `09:05`, the shape `wallClockToInstant` reads. */
function pad(c: Clock): string {
  return `${String(c.h).padStart(2, '0')}:${String(c.m).padStart(2, '0')}`;
}

/** An instant as the Planner's clock in `tz`: `20h30`, `16h` (never `20:30`). */
export function clockText(iso: string, tz: string): string {
  return hourMark(timeInTz(iso, tz));
}

/** The calendar day an instant falls on in `tz`, `YYYY-MM-DD`. */
export function dayOf(iso: string, tz: string): string {
  return instantToWallClock(iso, tz).slice(0, 10);
}

function nextDay(dayIso: string): string {
  const d = new Date(`${dayIso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

/**
 * The hour where the night ends: a clock before it, on a running order that
 * already reaches the afternoon, is the next morning.
 */
export const NIGHT_ENDS_AT = 6;

/**
 * A typed clock on the day being looked at → the instant to store.
 *
 * THE NIGHT RUNS LONG, it does not go back (the strip's rule, `day-strip.ts`):
 * a load-out typed as `1h30` on a running order whose day already reaches
 * noon is half past one TOMORROW, not this morning before the load-in. Without
 * an afternoon to hold on to, an early hour is just early.
 *
 * Returns null when the wall hour does not exist (a DST gap the conversion
 * refuses) or the day is not a day.
 */
export function instantFor(
  dayIso: string,
  clock: Clock,
  tz: string,
  order: ReadonlyArray<Pick<ScheduleSlotInput, 'at'>> = [],
): string | null {
  const noon = wallClockToInstant(`${dayIso}T12:00`, tz);
  const reachesAfternoon =
    noon !== null && order.some((s) => new Date(s.at).getTime() >= new Date(noon).getTime());
  const day = clock.h < NIGHT_ENDS_AT && reachesAfternoon ? nextDay(dayIso) : dayIso;
  return wallClockToInstant(`${day}T${pad(clock)}`, tz);
}

/**
 * The end of a moment typed as a clock: the first instant at that wall hour
 * that is not before the start. `22h → 1h` is one in the morning, after.
 */
export function endFor(startIso: string, clock: Clock, tz: string): string | null {
  const day = dayOf(startIso, tz);
  const same = wallClockToInstant(`${day}T${pad(clock)}`, tz);
  if (same === null) return null;
  if (new Date(same).getTime() >= new Date(startIso).getTime()) return same;
  return wallClockToInstant(`${nextDay(day)}T${pad(clock)}`, tz);
}

/**
 * A moment's word: what somebody called it, or the word for its kind. A slot
 * always has one of the two (CHECK `schedule_slot_named`).
 */
export function slotWord(
  slot: Pick<ScheduleSlotInput, 'label' | 'kind'>,
  kindWord: (kind: string) => string,
): string {
  if (slot.label) return slot.label;
  return slot.kind ? kindWord(slot.kind) : '';
}

/**
 * A typed name that IS one of the five words (`soundcheck`, `función`…)
 * becomes that kind, not a free label: the road sheet and the strip only
 * know the five by kind, so «función» typed by hand must be the show and not
 * a moment that happens to share its name. Case and spacing do not count.
 */
export function kindForLabel(
  label: string,
  words: ReadonlyArray<readonly [kind: string, word: string]>,
): string | null {
  const norm = (s: string) => s.trim().toLocaleLowerCase().replace(/\s+/g, ' ');
  const typed = norm(label);
  if (!typed) return null;
  return words.find(([, w]) => norm(w) === typed)?.[0] ?? null;
}

/**
 * A name for a slot to store. A word that IS a kind is stored as the kind
 * with no label, so it reads in the reader's language. Any other word is a
 * free moment with no kind: renaming the soundcheck to «photo call» makes it
 * a photo call, and the strip and the road sheet stop calling it a
 * soundcheck. Empty keeps the kind it had (the word was only its
 * translation); null when there is nothing to name it with.
 */
export function namedSlot(
  label: string,
  previousKind: string | null,
  words: ReadonlyArray<readonly [kind: string, word: string]>,
): Pick<ScheduleSlotInput, 'kind' | 'label'> | null {
  const text = label.trim();
  if (!text) return previousKind ? { kind: previousKind, label: null } : null;
  const kind = kindForLabel(text, words);
  if (kind) return { kind, label: null };
  return { kind: null, label: text };
}

/** Rows (from the API) → the editable order, in their stored order. */
export function inputsOf(rows: readonly ScheduleSlotRow[]): ScheduleSlotInput[] {
  return [...rows]
    .sort((a, b) => a.sort - b.sort)
    .map(({ id, kind, label, at, ends_at, notes }) => ({ id, kind, label, at, ends_at, notes }));
}

/**
 * Put one slot where its hour says, and return the new order.
 *
 * `index` is the slot's current place when it is being edited (it leaves it
 * first); absent for a new one. Equal hours keep arrival order: the new one
 * goes AFTER the moments already at that hour, which is how a list filled in
 * on the day reads.
 *
 * Only this slot moves. An order somebody arranged by hand (P2's CRDT will
 * allow it) is not re-sorted around it.
 */
export function placeByTime(
  order: readonly ScheduleSlotInput[],
  slot: ScheduleSlotInput,
  index?: number,
): ScheduleSlotInput[] {
  const rest = order.filter((_, i) => i !== index);
  const t = new Date(slot.at).getTime();
  const at = rest.findIndex((s) => new Date(s.at).getTime() > t);
  if (at < 0) return [...rest, slot];
  return [...rest.slice(0, at), slot, ...rest.slice(at)];
}
