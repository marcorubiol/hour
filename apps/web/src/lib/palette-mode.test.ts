import { describe, expect, test } from 'vitest';
import { enterAct, rowAct, rowAside } from './palette-mode';

// The palette's two doors (ADR-178): the bar searches, the pill filters.
describe('rowAct', () => {
  test('search: every row opens its record', () => {
    expect(rowAct('search', true)).toBe('open');
    expect(rowAct('search', false)).toBe('open');
  });
  test('filter: what can be scoped is staged, the rest opens', () => {
    expect(rowAct('filter', true)).toBe('stage');
    expect(rowAct('filter', false)).toBe('open');
  });
});

describe('rowAside', () => {
  test('search: «acotar» beside what can be scoped', () => {
    expect(rowAside('search', true)).toBe('narrow');
  });
  test('filter: «abrir» beside what can be scoped', () => {
    expect(rowAside('filter', true)).toBe('open');
  });
  test('a row that cannot be scoped has one gesture only', () => {
    expect(rowAside('search', false)).toBeNull();
    expect(rowAside('filter', false)).toBeNull();
  });
});

describe('enterAct', () => {
  test('↵ does what the click does', () => {
    expect(enterAct('search', true)).toBe('open');
    expect(enterAct('filter', true)).toBe('stage');
    expect(enterAct('filter', false)).toBe('open');
  });
  test('⌘↵ always opens', () => {
    expect(enterAct('search', true, { meta: true })).toBe('open');
    expect(enterAct('filter', true, { meta: true })).toBe('open');
  });
  test('⇧↵ narrows in the search and applies in the filter', () => {
    expect(enterAct('search', true, { shift: true })).toBe('narrow');
    expect(enterAct('search', false, { shift: true })).toBe('open');
    expect(enterAct('filter', true, { shift: true })).toBe('apply');
    expect(enterAct('filter', false, { shift: true })).toBe('apply');
  });
});
