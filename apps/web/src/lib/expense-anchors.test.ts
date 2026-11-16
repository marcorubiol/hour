import { describe, expect, it } from 'vitest';
import { expenseAnchors } from './expense';
import { boloInScope, type MoneyBolo } from './money';
import type { NavLine } from './nav';

const bolo = (id: string, over: Partial<MoneyBolo> = {}): MoneyBolo =>
  ({
    id,
    project_id: 'p1',
    line_id: null,
    venue_name: null,
    city: null,
    fee_currency: 'EUR',
    project: { id: 'p1', slug: 'p', name: 'MaMeMi', accent: null, workspace_id: 'w1' },
    ...over,
  }) as MoneyBolo;

type Scope = Parameters<typeof boloInScope>[0];
const empty: Scope = { isEmpty: true, workspaceIds: [], projects: [], lineIds: [] };
const scope = (s: Partial<Scope>): Scope => ({ ...empty, isEmpty: false, ...s });

describe('boloInScope (Cuentas and the shell\'s expense, 163)', () => {
  it('everything when nothing is pinned', () => {
    expect(boloInScope(empty, bolo('b'))).toBe(true);
  });
  it('its space, its project or its line pinned', () => {
    expect(boloInScope(scope({ workspaceIds: ['w1'] }), bolo('b'))).toBe(true);
    expect(boloInScope(scope({ projects: [{ id: 'p1' }] as never }), bolo('b'))).toBe(true);
    expect(boloInScope(scope({ lineIds: ['l1'] }), bolo('b', { line_id: 'l1' }))).toBe(true);
  });
  it('a pinned line narrows to its own bolos, not its project\'s', () => {
    expect(boloInScope(scope({ lineIds: ['l1'] }), bolo('b'))).toBe(false);
  });
});

describe('expenseAnchors', () => {
  const line = { id: 'l1', name: 'Gira', projectName: 'MaMeMi', workspaceId: 'w1' } as NavLine;
  it('the lines of the bolos first, once each, then the bolos with their place', () => {
    const out = expenseAnchors(
      [bolo('b1', { line_id: 'l1', venue_name: 'Antic', city: 'Barcelona' }), bolo('b2', { line_id: 'l1' })],
      new Map([['l1', line]]),
      'es',
    );
    expect(out.map((a) => a.value)).toEqual(['line:l1', 'bolo:b1', 'bolo:b2']);
    expect(out[1].label).toContain('Antic, Barcelona');
    expect(out[2].label).toContain('MaMeMi');
    expect(out.every((a) => a.workspaceId === 'w1')).toBe(true);
  });
  it('nothing without bolos', () => {
    expect(expenseAnchors([], new Map(), 'es')).toEqual([]);
  });
});
