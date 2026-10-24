import { describe, expect, test } from 'vitest';
import { blockDrawn, screenQuiet } from './dashboard-blocks';

describe('a dashboard block is drawn only with something in it (ADR-145 § 1)', () => {
  test('with rows it is drawn; at zero it is not', () => {
    expect(blockDrawn({ count: 3 })).toBe(true);
    expect(blockDrawn({ count: 0 })).toBe(false);
  });
  test('a failed read is drawn, so the silence never claims «nada»', () => {
    expect(blockDrawn({ count: 0, errored: true })).toBe(true);
  });
  test('while its read is on the way it is not drawn', () => {
    expect(blockDrawn({ count: 0, loading: true })).toBe(false);
    expect(blockDrawn({ count: 2, loading: true })).toBe(false);
  });
  test('the screen is quiet only when no block is drawn and none is loading', () => {
    expect(screenQuiet([{ count: 0 }, { count: 0 }])).toBe(true);
    expect(screenQuiet([{ count: 0 }, { count: 1 }])).toBe(false);
    expect(screenQuiet([{ count: 0 }, { count: 0, loading: true }])).toBe(false);
    expect(screenQuiet([{ count: 0, errored: true }])).toBe(false);
  });
});
