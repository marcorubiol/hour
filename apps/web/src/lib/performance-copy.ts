/**
 * «Copiar de otra función» (ADR-169, punto 83): la técnica, la logística, la
 * acogida y la escaleta de una función pasan a otra. Pure: the dialog asks
 * what to offer and what to write, and sends it (the three columns in one
 * PATCH, the running order into the destination's collab doc).
 *
 * Nothing is overwritten without asking: when the destination already has a
 * part, the person picks «completar» (keep what is there, add what is
 * missing) or «reemplazar».
 */
import type { Json } from './db-types';
import { instantToWallClock, wallClockToInstant } from './datetime';
import { kvObject, type KVObject } from './kv-lines';
import type { ScheduleSlotInput } from './schedule-slot';

/** The three columns, in the order the dialog lists them. */
export const COPY_COLUMNS = ['technical', 'logistics', 'hospitality'] as const;
export type CopyColumn = (typeof COPY_COLUMNS)[number];
export type CopyPart = CopyColumn | 'schedule';
export const COPY_PARTS: readonly CopyPart[] = [...COPY_COLUMNS, 'schedule'];

/** `fill`: what the destination has stays, what it lacks arrives. `replace`: the source's, whole. */
export type CopyMode = 'fill' | 'replace';

/** A column has something to copy or to lose: an object with keys. */
export function columnHasContent(value: Json | null | undefined): boolean {
  const obj = kvObject(value);
  return obj !== null && Object.keys(obj).length > 0;
}

/**
 * The column the destination ends up with, or null when nothing changes (no
 * write). A destination that is not an object (an array someone imported)
 * is only replaced, never merged into.
 */
export function mergeColumn(dest: Json | null | undefined, src: Json | null | undefined, mode: CopyMode): KVObject | null {
  const from = kvObject(src);
  if (!from || Object.keys(from).length === 0) return null;
  const into = kvObject(dest);
  if (mode === 'replace' || into === null) return { ...from };
  const next = { ...from, ...into };
  return Object.keys(next).length === Object.keys(into).length ? null : next;
}

function addDays(day: string, n: number): string {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

function dayDiff(a: string, b: string): number {
  const ms = (s: string) => {
    const [y, m, d] = s.split('-').map(Number);
    return Date.UTC(y, m - 1, d);
  };
  return Math.round((ms(a) - ms(b)) / 86_400_000);
}

export interface DayPlace {
  /** `YYYY-MM-DD`: the performance's day. */
  day: string;
  /** The zone its hours are written in (venue, else space). */
  tz: string;
}

function moveInstant(iso: string, from: DayPlace, to: DayPlace): string | null {
  const wall = instantToWallClock(iso, from.tz);
  if (!wall) return null;
  const offset = dayDiff(wall.slice(0, 10), from.day);
  return wallClockToInstant(`${addDays(to.day, offset)}${wall.slice(10)}`, to.tz);
}

/**
 * The source's running order on the destination's day: the same wall-clock
 * hours (20:00 stays 20:00, a get-out after midnight stays the next day), in
 * the destination's zone. New moments: no ids, the doc gives them.
 */
export function shiftSchedule(
  slots: readonly Pick<ScheduleSlotInput, 'kind' | 'label' | 'at' | 'ends_at' | 'notes'>[],
  from: DayPlace,
  to: DayPlace,
): ScheduleSlotInput[] {
  const out: ScheduleSlotInput[] = [];
  for (const s of slots) {
    const at = moveInstant(s.at, from, to);
    if (!at) continue;
    out.push({
      kind: s.kind,
      label: s.label,
      at,
      ends_at: s.ends_at ? moveInstant(s.ends_at, from, to) : null,
      notes: s.notes,
    });
  }
  return out;
}

const sameMoment = (a: ScheduleSlotInput, b: ScheduleSlotInput) =>
  a.kind === b.kind && (a.label ?? '') === (b.label ?? '') && a.at === b.at;

/**
 * The destination's next order, or null when nothing changes. `fill` keeps
 * every moment it has (ids included, so the doc edits nothing of them) and
 * adds the copied ones it does not have, in time order.
 */
export function mergeSchedule(
  dest: readonly ScheduleSlotInput[],
  copied: readonly ScheduleSlotInput[],
  mode: CopyMode,
): ScheduleSlotInput[] | null {
  if (copied.length === 0) return null;
  if (mode === 'replace' || dest.length === 0) return [...copied];
  const fresh = copied.filter((c) => !dest.some((d) => sameMoment(c, d)));
  if (fresh.length === 0) return null;
  return [...dest, ...fresh].sort((a, b) => a.at.localeCompare(b.at));
}

export interface CopyCandidate {
  id: string;
  slug: string | null;
  performed_at: string;
  project_id: string;
  venue_name: string | null;
  city: string | null;
  status: string;
}

/**
 * The performances to copy from: this project's first, then the space's;
 * each group nearest day first (the last one done is the likeliest model).
 * Never the destination itself, never a cancelled one.
 */
export function copyCandidates<T extends CopyCandidate>(
  items: readonly T[],
  self: { id: string; project_id: string; performed_at: string },
): { project: T[]; others: T[] } {
  const seen = new Set<string>([self.id]);
  const pool = items.filter((p) => {
    if (seen.has(p.id) || p.status === 'cancelled') return false;
    seen.add(p.id);
    return true;
  });
  const day = self.performed_at.slice(0, 10);
  const near = (a: T, b: T) =>
    Math.abs(dayDiff(a.performed_at.slice(0, 10), day)) - Math.abs(dayDiff(b.performed_at.slice(0, 10), day)) ||
    b.performed_at.localeCompare(a.performed_at);
  return {
    project: pool.filter((p) => p.project_id === self.project_id).sort(near),
    others: pool.filter((p) => p.project_id !== self.project_id).sort(near),
  };
}
