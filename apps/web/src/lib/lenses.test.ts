import { describe, expect, it } from 'vitest';
import { isToggleLens, lensesOnFor, lensOn, setLensesOn, TOGGLE_LENSES } from './lenses.svelte';

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
