import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { FRESH_WAIT_MS, cssTimeMs, isFresh, markFresh } from './fresh.svelte';

describe('fresh', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  test('lo recién hecho se marca y la marca se va si la tarjeta nunca sale', () => {
    markFresh(['p1', 'd1']);
    expect(isFresh('p1')).toBe(true);
    expect(isFresh('d1')).toBe(true);
    expect(isFresh('otro')).toBe(false);
    vi.advanceTimersByTime(FRESH_WAIT_MS);
    expect(isFresh('p1')).toBe(false);
    expect(isFresh('d1')).toBe(false);
  });

  test('marcar otra vez vuelve a dar el plazo entero', () => {
    markFresh(['p2']);
    vi.advanceTimersByTime(FRESH_WAIT_MS - 1);
    markFresh(['p2']);
    vi.advanceTimersByTime(FRESH_WAIT_MS - 1);
    expect(isFresh('p2')).toBe(true);
    vi.advanceTimersByTime(1);
    expect(isFresh('p2')).toBe(false);
  });
});

describe('cssTimeMs', () => {
  test('segundos y milisegundos; si no se entiende, lo de reserva', () => {
    expect(cssTimeMs('2.4s', 1)).toBe(2400);
    expect(cssTimeMs(' 300ms ', 1)).toBe(300);
    expect(cssTimeMs('', 1)).toBe(1);
    expect(cssTimeMs('var(--x)', 7)).toBe(7);
  });
});
