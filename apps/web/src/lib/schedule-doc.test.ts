import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { readSchedule, scheduleArray, writeSchedule, type ScheduleMoment } from './schedule-doc';
import { moveSlot, placeByTime } from './running-order';
import type { ScheduleSlotInput } from './schedule-slot';

const m = (id: string, at: string, label: string | null = id, kind: string | null = null): ScheduleMoment => ({
  id,
  kind,
  label,
  at,
  ends_at: null,
  notes: null,
});

const A = m('a', '2031-04-10T10:00:00Z', null, 'load_in');
const B = m('b', '2031-04-10T15:00:00Z');
const C = m('c', '2031-04-10T17:00:00Z');
const D = m('d', '2031-04-10T20:00:00Z', null, 'start');

/** Every update a write sends, decoded into what it touched. */
function updatesOf(doc: Y.Doc, run: () => void): number {
  let n = 0;
  const count = () => (n += 1);
  doc.on('update', count);
  run();
  doc.off('update', count);
  return n;
}

function sync(from: Y.Doc, to: Y.Doc) {
  Y.applyUpdate(to, Y.encodeStateAsUpdate(from, Y.encodeStateVector(to)));
}

describe('writeSchedule: the whole next order, as the fewest CRDT operations', () => {
  it('writes an order into an empty doc and reads it back the same', () => {
    const doc = new Y.Doc();
    writeSchedule(doc, [A, B, D]);
    expect(readSchedule(doc)).toEqual([A, B, D]);
  });

  it('gives an id to a moment that has none, and returns it', () => {
    const doc = new Y.Doc();
    const { id: _drop, ...noId } = C;
    const written = writeSchedule(doc, [A, noId as ScheduleSlotInput]);
    expect(written[1].id).toMatch(/^[0-9a-f-]{36}$/);
    expect(readSchedule(doc).map((s) => s.id)).toEqual(['a', written[1].id]);
  });

  it('writing the order it already has sends nothing', () => {
    const doc = new Y.Doc();
    writeSchedule(doc, [A, B, D]);
    expect(updatesOf(doc, () => writeSchedule(doc, readSchedule(doc)))).toBe(0);
  });

  it('an edit is in place: the same Y.Map, only the field that changed', () => {
    const doc = new Y.Doc();
    writeSchedule(doc, [A, B, D]);
    const before = scheduleArray(doc).get(1);
    writeSchedule(doc, [A, { ...B, notes: 'red coat' }, D]);
    expect(scheduleArray(doc).get(1)).toBe(before);
    expect(readSchedule(doc)[1].notes).toBe('red coat');
  });

  it('a move keeps every other moment where it is: only the moved one is re-made', () => {
    const doc = new Y.Doc();
    writeSchedule(doc, [A, B, C, D]);
    const maps = scheduleArray(doc).toArray();
    // Move D to the top: A, B, C stay the same Y.Maps.
    writeSchedule(doc, moveSlot(readSchedule(doc), 3, 0));
    const after = scheduleArray(doc).toArray();
    expect(readSchedule(doc).map((s) => s.id)).toEqual(['d', 'a', 'b', 'c']);
    expect(after.slice(1)).toEqual(maps.slice(0, 3));
    expect(after[1]).toBe(maps[0]);
  });

  it('removing and adding (placed by its hour) are plain deletes and inserts', () => {
    const doc = new Y.Doc();
    writeSchedule(doc, [A, B, D]);
    writeSchedule(doc, placeByTime(readSchedule(doc).filter((s) => s.id !== 'b'), C));
    expect(readSchedule(doc).map((s) => s.id)).toEqual(['a', 'c', 'd']);
  });

  it('two people writing at once merge: one adds, the other edits another moment', () => {
    const one = new Y.Doc();
    writeSchedule(one, [A, B, D]);
    const two = new Y.Doc();
    sync(one, two);

    writeSchedule(one, placeByTime(readSchedule(one), C));
    writeSchedule(two, readSchedule(two).map((s) => (s.id === 'b' ? { ...s, label: 'photo call' } : s)));
    sync(one, two);
    sync(two, one);

    expect(readSchedule(one)).toEqual(readSchedule(two));
    expect(readSchedule(one).map((s) => [s.id, s.label ?? s.kind])).toEqual([
      ['a', 'load_in'],
      ['b', 'photo call'],
      ['c', 'c'],
      ['d', 'start'],
    ]);
  });

  it('two people moving the same moment leave two copies: the first is drawn, the next write cleans', () => {
    const one = new Y.Doc();
    writeSchedule(one, [A, B, C, D]);
    const two = new Y.Doc();
    sync(one, two);

    writeSchedule(one, moveSlot(readSchedule(one), 3, 0)); // d to the top
    writeSchedule(two, moveSlot(readSchedule(two), 3, 1)); // d after a
    sync(one, two);
    sync(two, one);

    expect(scheduleArray(one).length).toBe(5); // d twice in the CRDT
    const drawn = readSchedule(one);
    expect(drawn.map((s) => s.id).filter((id) => id === 'd')).toHaveLength(1);
    expect(drawn).toEqual(readSchedule(two));

    writeSchedule(one, drawn);
    expect(scheduleArray(one).length).toBe(4);
  });
});
