/**
 * The running order inside a collab doc (ADR-090 P2), as the Durable Object
 * sees it.
 *
 * THE DOC MANDA (Marco, 2026-10-10): the running order of a performance or a
 * rehearsal day is written ONLY through its collab doc, like the notes. The
 * rows in `schedule_slot` are the doc's materialization, the projection every
 * read surface (road sheet, Desk, ICS, the public sheet) queries.
 *
 * THE SHAPE (one contract, two readers: this file and
 * `apps/web/src/lib/schedule-doc.ts`, which edits it):
 *   doc.getArray('schedule')  Y.Array of Y.Map, IN ORDER (the CRDT owns the
 *                             order; `sort` exists only in the rows)
 *     each Y.Map: id (uuid), kind, label, at (ISO), ends_at, notes
 *                 (strings, or null)
 *   doc.getMap('seeds')       'schedule' → true once the array was seeded
 *                             from the rows (ADR-090 risk 1, below)
 *
 * Pure functions over a Y.Doc. No network, no storage: `roadsheet.ts` does
 * the I/O.
 */

import * as Y from 'yjs';

export const SCHEDULE_FIELD = 'schedule';
export const SEEDS_FIELD = 'seeds';

/** A moment as the rows and `replace_schedule_slots_for_user` speak it. */
export interface ScheduleSlot {
  id: string;
  kind: string | null;
  label: string | null;
  at: string;
  ends_at: string | null;
  notes: string | null;
}

/** The six keys of a moment's Y.Map, in the order they are written. */
const KEYS = ['id', 'kind', 'label', 'at', 'ends_at', 'notes'] as const;

export function scheduleOf(doc: Y.Doc): Y.Array<Y.Map<unknown>> {
  return doc.getArray<Y.Map<unknown>>(SCHEDULE_FIELD);
}

/**
 * RISK 1 OF ADR-090, CLOSED HERE. A doc saved before P2 has a snapshot (the
 * notes) and no `schedule`. Read as is, its empty array would materialize as
 * «no moments» and delete every row. So a doc is seeded from the rows exactly
 * once, and the mark that says so lives IN the doc (it travels with the
 * snapshot, so no other store can disagree with it). An empty array WITH the
 * mark is a running order somebody emptied; without it, one never read.
 */
export function isScheduleSeeded(doc: Y.Doc): boolean {
  return doc.getMap(SEEDS_FIELD).get(SCHEDULE_FIELD) === true;
}

/**
 * Put the rows into the doc, in their order, and set the mark. The caller must
 * persist the doc BEFORE any client sees it: two activations seeding the same
 * rows would merge as two copies of every moment.
 */
export function seedSchedule(doc: Y.Doc, rows: readonly ScheduleSlot[]): void {
  doc.transact(() => {
    const array = scheduleOf(doc);
    if (array.length === 0) {
      array.push(rows.map(momentMap));
    }
    doc.getMap(SEEDS_FIELD).set(SCHEDULE_FIELD, true);
  });
}

function momentMap(slot: ScheduleSlot): Y.Map<unknown> {
  const map = new Y.Map<unknown>();
  for (const key of KEYS) map.set(key, slot[key] ?? null);
  return map;
}

function text(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

/** The moments as they stand, in order. No validation: what the doc says. */
export function readSchedule(doc: Y.Doc): ScheduleSlot[] {
  return scheduleOf(doc)
    .toArray()
    .filter((item): item is Y.Map<unknown> => item instanceof Y.Map)
    .map((map) => ({
      id: text(map.get('id')) ?? '',
      kind: text(map.get('kind')),
      label: text(map.get('label')),
      at: text(map.get('at')) ?? '',
      ends_at: text(map.get('ends_at')),
      notes: text(map.get('notes')),
    }));
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const KIND = /^[a-z][a-z0-9_]{0,31}$/;
const MAX_SLOTS = 200;

function trimmed(value: string | null): string | null {
  const t = value?.trim() ?? '';
  return t.length > 0 ? t : null;
}

/**
 * The moments the rows can hold, for the materialization. A CRDT cannot be
 * refused: whatever a client merged is in the doc. A moment the table's CHECKs
 * would reject (no hour, no name, an end before its start, a duplicated id
 * from two people moving the same row at once) is LEFT OUT of the rows, not
 * allowed to fail the whole write: one bad moment must not freeze every
 * other. The first copy of a duplicated id wins, as the screen draws it.
 * `dropped` says how many were left out, for the log.
 */
export function scheduleForRows(doc: Y.Doc): { slots: ScheduleSlot[]; dropped: number } {
  const seen = new Set<string>();
  const slots: ScheduleSlot[] = [];
  let dropped = 0;
  for (const raw of readSchedule(doc)) {
    const at = Date.parse(raw.at);
    const ends = raw.ends_at === null ? null : Date.parse(raw.ends_at);
    const label = trimmed(raw.label);
    const kind = trimmed(raw.kind);
    const notes = trimmed(raw.notes);
    const ok =
      UUID.test(raw.id) &&
      !seen.has(raw.id.toLowerCase()) &&
      Number.isFinite(at) &&
      (ends === null || (Number.isFinite(ends) && ends >= at)) &&
      (label !== null || kind !== null) &&
      (label === null || label.length <= 200) &&
      (kind === null || KIND.test(kind)) &&
      (notes === null || notes.length <= 5000) &&
      slots.length < MAX_SLOTS;
    if (!ok) {
      dropped += 1;
      continue;
    }
    seen.add(raw.id.toLowerCase());
    slots.push({ id: raw.id, kind, label, at: raw.at, ends_at: raw.ends_at, notes });
  }
  return { slots, dropped };
}

/** A change to one moment's hours, conditional on what they were. */
export interface ScheduleHoursUpdate {
  id: string;
  from: { at: string; ends_at: string | null };
  to: { at: string; ends_at: string | null };
}

/**
 * Move the hours of some moments, for a server-side writer (the venue
 * changed zone: `PATCH /api/performances/:key` computes the new instants and
 * hands them here). Compare-and-set per moment: one whose hours somebody
 * changed in the meantime is skipped, not overwritten. One transaction, so
 * every client sees the move at once.
 */
export function applyHoursUpdates(
  doc: Y.Doc,
  updates: readonly ScheduleHoursUpdate[],
  origin: unknown = null,
): { applied: number; skipped: number } {
  let applied = 0;
  let skipped = 0;
  doc.transact(() => {
    const byId = new Map<string, Y.Map<unknown>>();
    for (const item of scheduleOf(doc).toArray()) {
      if (!(item instanceof Y.Map)) continue;
      const id = text(item.get('id'));
      if (id && !byId.has(id)) byId.set(id, item);
    }
    for (const u of updates) {
      const map = byId.get(u.id);
      if (
        !map ||
        text(map.get('at')) !== u.from.at ||
        text(map.get('ends_at')) !== u.from.ends_at
      ) {
        skipped += 1;
        continue;
      }
      map.set('at', u.to.at);
      map.set('ends_at', u.to.ends_at);
      applied += 1;
    }
  }, origin);
  return { applied, skipped };
}
