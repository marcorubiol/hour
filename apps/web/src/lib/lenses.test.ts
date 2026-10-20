import { describe, expect, it } from 'vitest';
import { isToggleLens, lensesOnFor, lensOn, routedLensOf, setLensesOn, TOGGLE_LENSES } from './lenses.svelte';

describe('lensesOnFor (ADR-132)', () => {
  it('turns every lens on while no workspace has answered', () => {
    expect([...lensesOnFor([])]).toEqual([...TOGGLE_LENSES]);
  });

  it('reads an absent or null column as every lens on', () => {
    expect(lensesOnFor([{}, { lenses_off: null }]).size).toBe(3);
  });

  it('hides a lens only when every space on screen has it off', () => {
    const on = lensesOnFor([{ lenses_off: ['books'] }, { lenses_off: ['books', 'planner'] }]);
    expect(on.has('books')).toBe(false);
    expect(on.has('planner')).toBe(true);
    expect(on.has('conversations')).toBe(true);
  });

  it('a lens on in one space of the scope is on', () => {
    expect(lensesOnFor([{ lenses_off: ['books'] }, { lenses_off: [] }]).has('books')).toBe(true);
  });

  it('ignores a value the app does not know', () => {
    expect(lensesOnFor([{ lenses_off: ['money', 'desk'] }]).size).toBe(3);
  });
});

describe('lensOn', () => {
  it('Desk is no lens: it is always on', () => {
    setLensesOn(new Set());
    expect(lensOn('desk')).toBe(true);
    expect(lensOn('planner')).toBe(false);
    setLensesOn(new Set(TOGGLE_LENSES));
    expect(lensOn('planner')).toBe(true);
  });

  it('knows the three lenses and nothing else', () => {
    expect(TOGGLE_LENSES.every(isToggleLens)).toBe(true);
    expect(isToggleLens('desk')).toBe(false);
  });
});

describe('routedLensOf (ADR-140)', () => {
  it('reads the four lens routes, with or without the slash', () => {
    expect(routedLensOf('/h/desk')).toBe('desk');
    expect(routedLensOf('/h/planner/')).toBe('planner');
    expect(routedLensOf('/h/conversations')).toBe('conversations');
    expect(routedLensOf('/h/books')).toBe('books');
  });

  it('is no lens on a record, a space, Settings or the door', () => {
    expect(routedLensOf('/h')).toBeNull();
    expect(routedLensOf('/h/muk-cia/')).toBeNull();
    expect(routedLensOf('/h/muk-cia/performance/x')).toBeNull();
    expect(routedLensOf('/h/muk-cia/settings')).toBeNull();
    expect(routedLensOf('/h/muk-cia/planner')).toBeNull();
  });
});
