import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as Y from 'yjs';
import {
  applyHoursUpdates,
  isScheduleSeeded,
  readSchedule,
  scheduleForRows,
  scheduleOf,
  seedSchedule,
  type ScheduleSlot,
} from '../src/schedule.ts';
import { DOC_FIELDS, isCollabTargetTable } from '../src/persistence-guard.ts';

const A = '0190a000-0000-7000-8000-00000000000a';
const B = '0190a000-0000-7000-8000-00000000000b';
const C = '0190a000-0000-7000-8000-00000000000c';

const row = (id: string, at: string, extra: Partial<ScheduleSlot> = {}): ScheduleSlot => ({
  id,
  kind: null,
  label: 'moment',
  at,
  ends_at: null,
  notes: null,
  ...extra,
});

function push(doc: Y.Doc, fields: Record<string, unknown>): void {
  const map = new Y.Map<unknown>();
  for (const [k, v] of Object.entries(fields)) map.set(k, v);
  scheduleOf(doc).push([map]);
}

test('a doc saved before P2 (notes, no schedule) is NOT seeded: its empty array is not «no moments»', () => {
  const old = new Y.Doc();
  old.getText('notes').insert(0, 'bring the cables');
  const loaded = new Y.Doc();
  Y.applyUpdate(loaded, Y.encodeStateAsUpdate(old));
  assert.equal(isScheduleSeeded(loaded), false);
  assert.equal(scheduleOf(loaded).length, 0);
});

test('seeding puts the rows in, in order, and the mark travels with the snapshot', () => {
  const doc = new Y.Doc();
  seedSchedule(doc, [row(A, '2031-04-10T10:00:00Z', { kind: 'load_in', label: null }), row(B, '2031-04-10T20:00:00Z')]);
  assert.equal(isScheduleSeeded(doc), true);
  assert.deepEqual(
    readSchedule(doc).map((s) => [s.id, s.kind, s.label]),
    [
      [A, 'load_in', null],
      [B, null, 'moment'],
    ],
  );

  const reloaded = new Y.Doc();
  Y.applyUpdate(reloaded, Y.encodeStateAsUpdate(doc));
  assert.equal(isScheduleSeeded(reloaded), true);
  assert.equal(readSchedule(reloaded).length, 2);
});

test('an emptied running order stays empty: the mark, not the length, says it was read', () => {
  const doc = new Y.Doc();
  seedSchedule(doc, [row(A, '2031-04-10T10:00:00Z')]);
  scheduleOf(doc).delete(0, 1);
  assert.equal(isScheduleSeeded(doc), true);
  assert.deepEqual(scheduleForRows(doc), { slots: [], dropped: 0 });
});

test('seeding never doubles moments that are already there', () => {
  const doc = new Y.Doc();
  push(doc, { id: A, label: 'early', at: '2031-04-10T09:00:00Z' });
  seedSchedule(doc, [row(B, '2031-04-10T10:00:00Z')]);
  assert.deepEqual(readSchedule(doc).map((s) => s.id), [A]);
  assert.equal(isScheduleSeeded(doc), true);
});

test('the rows get only what their CHECKs hold; the first copy of a duplicated id wins', () => {
  const doc = new Y.Doc();
  push(doc, { id: A, label: '  call  ', at: '2031-04-10T09:00:00Z', notes: '  ' });
  push(doc, { id: A, label: 'duplicate from a concurrent move', at: '2031-04-10T09:30:00Z' });
  push(doc, { id: B, label: null, kind: null, at: '2031-04-10T10:00:00Z' }); // no name
  push(doc, { id: C, label: 'bad end', at: '2031-04-10T10:00:00Z', ends_at: '2031-04-10T09:00:00Z' });
  push(doc, { id: 'not-a-uuid', label: 'x', at: '2031-04-10T10:00:00Z' });
  push(doc, { id: '0190a000-0000-7000-8000-0000000000d1', kind: 'Bad Kind', at: '2031-04-10T10:00:00Z' });
  push(doc, { id: '0190a000-0000-7000-8000-0000000000d2', label: 'no hour', at: 'soon' });
  push(doc, { id: '0190a000-0000-7000-8000-0000000000d3', kind: 'start', at: '2031-04-10T20:00:00Z' });

  const { slots, dropped } = scheduleForRows(doc);
  assert.equal(dropped, 6);
  assert.deepEqual(slots, [
    { id: A, kind: null, label: 'call', at: '2031-04-10T09:00:00Z', ends_at: null, notes: null },
    {
      id: '0190a000-0000-7000-8000-0000000000d3',
      kind: 'start',
      label: null,
      at: '2031-04-10T20:00:00Z',
      ends_at: null,
      notes: null,
    },
  ]);
});

test('hours move compare-and-set: a moment somebody changed meanwhile is skipped', () => {
  const doc = new Y.Doc();
  seedSchedule(doc, [
    row(A, '2031-04-10T10:00:00Z'),
    row(B, '2031-04-10T20:00:00Z', { ends_at: '2031-04-10T21:00:00Z' }),
  ]);
  const result = applyHoursUpdates(doc, [
    { id: A, from: { at: '2031-04-10T10:00:00Z', ends_at: null }, to: { at: '2031-04-10T09:00:00Z', ends_at: null } },
    {
      id: B,
      from: { at: '2031-04-10T19:00:00Z', ends_at: '2031-04-10T21:00:00Z' }, // stale
      to: { at: '2031-04-10T18:00:00Z', ends_at: '2031-04-10T20:00:00Z' },
    },
    { id: C, from: { at: 'x', ends_at: null }, to: { at: 'y', ends_at: null } }, // gone
  ]);
  assert.deepEqual(result, { applied: 1, skipped: 2 });
  assert.deepEqual(
    readSchedule(doc).map((s) => [s.at, s.ends_at]),
    [
      ['2031-04-10T09:00:00Z', null],
      ['2031-04-10T20:00:00Z', '2031-04-10T21:00:00Z'],
    ],
  );
});

test('which docs carry what: a day carries its order and never its notes', () => {
  assert.deepEqual(DOC_FIELDS.performance, { notes: true, schedule: true });
  assert.deepEqual(DOC_FIELDS.date, { notes: false, schedule: true });
  assert.deepEqual(DOC_FIELDS.project, { notes: true, schedule: false });
  assert.deepEqual(DOC_FIELDS.line, { notes: true, schedule: false });
  assert.equal(isCollabTargetTable('date'), true);
  assert.equal(isCollabTargetTable('venue'), false);
  assert.equal(isCollabTargetTable('toString'), false);
});
