import { describe, expect, it } from 'vitest';
import { DEFAULT_PREPARATION, moveThing, preparationPatch, readPreparation, thingOn, thingRank } from './preparation';

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
