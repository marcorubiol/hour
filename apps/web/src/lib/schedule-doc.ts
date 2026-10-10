/**
 * THE RUNNING ORDER IN THE COLLAB DOC, as the editor writes it (ADR-090 P2).
 *
 * The doc manda (Marco, 2026-10-10): the running order of a performance or a
 * rehearsal day is written ONLY into its collab doc, like the notes; the
 * Durable Object materializes it into `schedule_slot`, the rows every read
 * surface queries. So the editor (`RunningOrder.svelte`) keeps doing what it
 * did with the API, produce the WHOLE next order as `ScheduleSlotInput[]`,
 * and this file turns that into the fewest CRDT operations, so two people
 * editing at once merge instead of overwriting each other.
 *
 * THE SHAPE (one contract, two readers: this file and
 * `apps/collab/src/schedule.ts`, which seeds and materializes it):
 *   doc.getArray('schedule')  Y.Array of Y.Map, IN ORDER (the CRDT owns the
 *                             order; `sort` exists only in the rows)
 *     each Y.Map: id (uuid), kind, label, at (ISO), ends_at, notes
 *
 * Pure over a Y.Doc: no provider, no network. The screen opens the doc
 * (`$lib/collab-doc`) and passes it in.
 */

import * as Y from 'yjs';
import type { ScheduleSlotInput } from './schedule-slot';

export const SCHEDULE_FIELD = 'schedule';

/** The six keys of a moment's Y.Map. */
const KEYS = ['id', 'kind', 'label', 'at', 'ends_at', 'notes'] as const;

/** A moment as the doc holds it: always with its id. */
export type ScheduleMoment = ScheduleSlotInput & { id: string };

export function scheduleArray(doc: Y.Doc): Y.Array<Y.Map<unknown>> {
  return doc.getArray<Y.Map<unknown>>(SCHEDULE_FIELD);
}

function text(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function momentOf(map: Y.Map<unknown>): ScheduleMoment | null {
  const id = text(map.get('id'));
  const at = text(map.get('at'));
  if (!id || !at) return null;
  return {
    id,
    kind: text(map.get('kind')),
    label: text(map.get('label')),
    at,
    ends_at: text(map.get('ends_at')),
    notes: text(map.get('notes')),
  };
}

/**
 * The order as the doc says it. Two people moving the same moment at once
 * leave two copies of it (a move is a delete and an insert): the FIRST copy
 * is the moment, and the next write removes the other. A malformed entry is
 * not drawn.
 */
export function readSchedule(doc: Y.Doc): ScheduleMoment[] {
  const seen = new Set<string>();
  const out: ScheduleMoment[] = [];
  for (const item of scheduleArray(doc).toArray()) {
    if (!(item instanceof Y.Map)) continue;
    const moment = momentOf(item);
    if (!moment || seen.has(moment.id)) continue;
    seen.add(moment.id);
    out.push(moment);
  }
  return out;
}

function newMap(moment: ScheduleMoment): Y.Map<unknown> {
  const map = new Y.Map<unknown>();
  for (const key of KEYS) map.set(key, moment[key] ?? null);
  return map;
}

/**
 * Longest increasing subsequence of `xs`, as the set of its INDEXES into
 * `xs`. The moments it covers already stand in the right relative order and
 * stay where they are; only the others move.
 */
function lisIndexes(xs: readonly number[]): Set<number> {
  const tails: number[] = []; // index into xs of the smallest tail per length
  const prev: number[] = new Array(xs.length).fill(-1);
  for (let i = 0; i < xs.length; i += 1) {
    let lo = 0;
    let hi = tails.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (xs[tails[mid]] < xs[i]) lo = mid + 1;
      else hi = mid;
    }
    if (lo > 0) prev[i] = tails[lo - 1];
    tails[lo] = i;
  }
  const keep = new Set<number>();
  for (let i = tails.length > 0 ? tails[tails.length - 1] : -1; i >= 0; i = prev[i]) keep.add(i);
  return keep;
}

/**
 * Make the doc's order be `next`, with the fewest operations, in ONE
 * transaction (one update on the wire, one entry in every peer's history).
 *
 * - a moment that is gone is deleted;
 * - a moment that stayed in its relative place is edited IN PLACE, field by
 *   field and only where it changed, so a concurrent edit to another field
 *   of the same moment survives;
 * - a moment that moved is deleted and inserted again at its new place (Yjs
 *   has no move), with the fields `next` gives it;
 * - a moment without an id gets one here.
 *
 * Returns the order as written, ids included.
 */
export function writeSchedule(
  doc: Y.Doc,
  next: readonly ScheduleSlotInput[],
  origin: unknown = 'local',
): ScheduleMoment[] {
  const seenNext = new Set<string>();
  const desired: ScheduleMoment[] = [];
  for (const slot of next) {
    const id = slot.id ?? crypto.randomUUID();
    if (seenNext.has(id)) continue;
    seenNext.add(id);
    desired.push({ ...slot, id });
  }

  doc.transact(() => {
    const array = scheduleArray(doc);

    // 1 · Out: what `next` no longer has, a second copy of an id, junk.
    const seen = new Set<string>();
    const doomed: number[] = [];
    array.toArray().forEach((item, i) => {
      const id = item instanceof Y.Map ? text(item.get('id')) : null;
      if (!id || seen.has(id) || !seenNext.has(id)) doomed.push(i);
      else seen.add(id);
    });
    for (const i of doomed.reverse()) array.delete(i, 1);

    // 2 · Which of the survivors already stand in `next`'s order.
    const position = new Map<string, number>();
    array.toArray().forEach((item, i) => position.set(text(item.get('id'))!, i));
    const present = desired.filter((m) => position.has(m.id));
    const keepIdx = lisIndexes(present.map((m) => position.get(m.id)!));
    const keep = new Set(present.filter((_, i) => keepIdx.has(i)).map((m) => m.id));

    // 3 · The others leave, to come back at their new place.
    const moving: number[] = [];
    array.toArray().forEach((item, i) => {
      if (!keep.has(text(item.get('id'))!)) moving.push(i);
    });
    for (const i of moving.reverse()) array.delete(i, 1);

    // 4 · Walk `next`: edit the kept in place, insert the rest.
    desired.forEach((moment, j) => {
      if (keep.has(moment.id)) {
        const map = array.get(j);
        for (const key of KEYS) {
          const value = moment[key] ?? null;
          if ((map.get(key) ?? null) !== value) map.set(key, value);
        }
      } else {
        array.insert(j, [newMap(moment)]);
      }
    });
  }, origin);

  return desired;
}
