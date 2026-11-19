import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PREPARATION,
  MANUAL_NAME_MAX,
  PREPARATION_MAX,
  addManualThing,
  moveThing,
  newManualId,
  preparationPatch,
  readManual,
  setThingDays,
  thingDays,
  readManualStates,
  readPreparation,
  removeManualThing,
  renameManualThing,
  thingOn,
  thingRank,
  MANUAL_ID_RE,
} from './preparation';

describe('readPreparation · the list of a project (ADR-221)', () => {
  it('no list, or a damaged one, is the default: the four, in order, on', () => {
    for (const raw of [null, undefined, {}, { items: 'x' }, 7, []]) {
      expect(readPreparation(raw)).toEqual(DEFAULT_PREPARATION);
    }
    expect(DEFAULT_PREPARATION.map((x) => x.id)).toEqual(['status', 'hours', 'team', 'sheet']);
  });

  it('keeps the project order and what it turned off', () => {
    const l = readPreparation({ items: [{ id: 'sheet', on: true }, { id: 'hours', on: false }] });
    expect(l).toEqual([
      { id: 'sheet', on: true },
      { id: 'hours', on: false },
      { id: 'status', on: true },
      { id: 'team', on: true },
    ]);
  });

  it('drops unknown ids and repeats; a thing the list lacks is appended on', () => {
    const l = readPreparation({ items: [{ id: 'hotel', on: true }, { id: 'team', on: false }, { id: 'team', on: true }] });
    expect(l.map((x) => [x.id, x.on])).toEqual([
      ['team', false],
      ['status', true],
      ['hours', true],
      ['sheet', true],
    ]);
  });

  it('thingOn and thingRank read the list; without one everything is on, in the default order', () => {
    const l = readPreparation({ items: [{ id: 'hours', on: false }] });
    expect(thingOn(l, 'hours')).toBe(false);
    expect(thingOn(l, 'status')).toBe(true);
    expect(thingOn(null, 'hours')).toBe(true);
    expect(thingRank(l, 'hours')).toBe(0);
    expect(thingRank(null, 'sheet')).toBe(3);
  });

  it('moveThing moves one place and ignores what is out of range', () => {
    expect(moveThing(DEFAULT_PREPARATION, 3, 2).map((x) => x.id)).toEqual(['status', 'hours', 'sheet', 'team']);
    expect(moveThing(DEFAULT_PREPARATION, 0, -1)).toBe(DEFAULT_PREPARATION);
    expect(moveThing(DEFAULT_PREPARATION, 2, 2)).toBe(DEFAULT_PREPARATION);
  });

  it('preparationPatch is what update_project stores, and reads back the same', () => {
    const l = moveThing(readPreparation({ items: [{ id: 'status', on: false }] }), 0, 2);
    expect(readPreparation(preparationPatch(l))).toEqual(l);
  });
});

describe('the project\'s own things (ADR-221, fase 3)', () => {
  const base = DEFAULT_PREPARATION;

  it('newManualId makes ids the base accepts', () => {
    expect(newManualId()).toMatch(MANUAL_ID_RE);
    expect(newManualId(() => 0)).toBe('m_00000000');
  });

  it('adds at the end, trims the name, ignores an empty one and a full list', () => {
    const l = addManualThing(base, '  Enviar   el rider ', 'm_rider001');
    expect(l.at(-1)).toEqual({ id: 'm_rider001', name: 'Enviar el rider', on: true });
    expect(addManualThing(l, '   ', 'm_x1234567')).toBe(l);
    expect(addManualThing(base, 'x'.repeat(200), 'm_long0001').at(-1)).toMatchObject({ name: 'x'.repeat(MANUAL_NAME_MAX) });
    let full = base;
    for (let i = 0; full.length < PREPARATION_MAX; i++) full = addManualThing(full, `c${i}`, `m_fill${String(i).padStart(3, '0')}`);
    expect(addManualThing(full, 'una más', 'm_more0001')).toBe(full);
  });

  it('renames only a hand thing and never to empty; deletes only a hand thing', () => {
    const l = addManualThing(base, 'Cerrar el hotel', 'm_hotel001');
    expect(renameManualThing(l, 'm_hotel001', 'Hotel').at(-1)).toMatchObject({ name: 'Hotel' });
    expect(renameManualThing(l, 'm_hotel001', '  ')).toBe(l);
    expect(renameManualThing(l, 'status', 'Otro')).toEqual(l);
    expect(removeManualThing(l, 'm_hotel001')).toEqual(base);
    expect(removeManualThing(l, 'status')).toEqual(l);
  });

  it('stores and reads back hand things, in order, with their names', () => {
    const l = moveThing(addManualThing(base, 'Pedir dietas', 'm_dietas01'), 4, 1);
    expect(readPreparation(preparationPatch(l))).toEqual(l);
    expect(thingRank(l, 'm_dietas01')).toBe(1);
  });

  it('reading drops a hand thing with no name or a bad id, and a repeat', () => {
    const l = readPreparation({
      items: [
        { id: 'm_ok000001', name: 'Rider', on: false },
        { id: 'm_ok000001', name: 'Otra vez', on: true },
        { id: 'm_noname01', on: true },
        { id: 'rider', name: 'Mal id', on: true },
      ],
    });
    expect(l.slice(0, 1)).toEqual([{ id: 'm_ok000001', name: 'Rider', on: false }]);
    expect(l).toHaveLength(5);
    expect(thingOn(l, 'm_ok000001')).toBe(false);
  });

  it('readManualStates keeps only well-formed hand entries', () => {
    const s = readManualStates({
      m_rider001: { estado: 'hecho', por: 'u1', cuando: '2026-11-18T10:00:00Z' },
      m_hotel001: { estado: 'no_aplica' },
      m_bad00001: { estado: 'quizá' },
      status: { estado: 'hecho' },
    });
    expect(Object.keys(s)).toEqual(['m_rider001', 'm_hotel001']);
    expect(s.m_hotel001).toEqual({ estado: 'no_aplica', por: null, cuando: null });
    expect(readManualStates(null)).toEqual({});
    expect(readManualStates([1])).toEqual({});
  });

  it('readManual: open in the list\'s order, closed apart, off says nothing', () => {
    let l = addManualThing(base, 'Rider', 'm_rider001');
    l = addManualThing(l, 'Hotel', 'm_hotel001');
    l = addManualThing(l, 'Dietas', 'm_dietas01');
    l = l.map((x) => (x.id === 'm_dietas01' ? { ...x, on: false } : x));
    const r = readManual(l, readManualStates({ m_hotel001: { estado: 'no_aplica', por: 'u', cuando: '2026-11-18T10:00:00Z' } }));
    expect(r.open).toEqual([{ id: 'm_rider001', name: 'Rider' }]);
    expect(r.closed.map((c) => [c.id, c.state.estado])).toEqual([['m_hotel001', 'no_aplica']]);
  });
});

describe('days of hurry (ADR-221, fase 4)', () => {
  it('absent is the default (sheet 14, the rest never); null is never; a number is the project\'s', () => {
    expect(thingDays(null, 'sheet')).toBe(14);
    expect(thingDays(null, 'hours')).toBeNull();
    const l = readPreparation({ items: [{ id: 'sheet', on: true, days: null }, { id: 'hours', on: true, days: 5 }] });
    expect(thingDays(l, 'sheet')).toBeNull();
    expect(thingDays(l, 'hours')).toBe(5);
  });

  it('a damaged value is the default; «estado» takes no days', () => {
    const l = readPreparation({ items: [{ id: 'sheet', on: true, days: -3 }, { id: 'hours', on: true, days: 2.5 }, { id: 'status', on: true, days: 4 }] });
    expect(thingDays(l, 'sheet')).toBe(14);
    expect(thingDays(l, 'hours')).toBeNull();
    expect(l.find((x) => x.id === 'status')).toEqual({ id: 'status', on: true });
  });

  it('setThingDays clamps, accepts null, leaves «estado»; the patch keeps what was set and reads back', () => {
    let l = setThingDays(DEFAULT_PREPARATION, 'hours', 9999);
    expect(thingDays(l, 'hours')).toBe(365);
    l = setThingDays(l, 'sheet', null);
    expect(setThingDays(l, 'status', 3)).toBe(l);
    expect(preparationPatch(l).items.find((x) => x.id === 'sheet')).toEqual({ id: 'sheet', on: true, days: null });
    expect(preparationPatch(DEFAULT_PREPARATION).items[0]).toEqual({ id: 'status', on: true });
    expect(readPreparation(preparationPatch(l))).toEqual(l);
  });
});
