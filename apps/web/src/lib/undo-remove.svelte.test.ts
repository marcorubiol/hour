/**
 * Borrar con «Deshacer» (`$lib/undo-remove`, tarea 134): se va al momento,
 * se escribe al acabar el aviso, «Deshacer» no escribe nada y un fallo lo
 * devuelve a la vista.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { undoableRemovals, type UndoableRemovals } from './undo-remove.svelte';

let cleanup: (() => void) | null = null;

function make(onsettled?: () => void): UndoableRemovals {
  let r!: UndoableRemovals;
  cleanup = $effect.root(() => {
    r = undoableRemovals({ locale: 'es', ms: 1000, onsettled });
  });
  return r;
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  cleanup?.();
  cleanup = null;
  vi.useRealTimers();
});

describe('undoableRemovals', () => {
  it('hides at once and writes when the notice ends', async () => {
    const commit = vi.fn(() => Promise.resolve());
    const settled = vi.fn();
    const r = make(settled);
    r.remove('a', { message: 'Nota borrada.', commit });
    expect(r.hidden.has('a')).toBe(true);
    expect(commit).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1000);
    expect(commit).toHaveBeenCalledTimes(1);
    expect(settled).toHaveBeenCalledTimes(1);
    // Written: it stays out of the screen until the read no longer has it.
    expect(r.hidden.has('a')).toBe(true);
  });

  it('«Deshacer» writes nothing and shows it again; a second press is ignored', async () => {
    const commit = vi.fn(() => Promise.resolve());
    const r = make();
    r.remove('a', { message: 'x', commit });
    r.remove('a', { message: 'x', commit });
    r.undo('a');
    expect(r.hidden.has('a')).toBe(false);
    await vi.advanceTimersByTimeAsync(5000);
    expect(commit).not.toHaveBeenCalled();
  });

  it('a failed write brings it back', async () => {
    const r = make();
    r.remove('a', { message: 'x', commit: () => Promise.reject(new Error('boom')) });
    await vi.advanceTimersByTimeAsync(1000);
    expect(r.hidden.has('a')).toBe(false);
  });

  it('leaving writes what is pending, once', async () => {
    const commit = vi.fn(() => Promise.resolve());
    const r = make();
    r.remove('a', { message: 'x', commit });
    r.remove('b', { message: 'y', commit });
    r.flush();
    await vi.advanceTimersByTimeAsync(5000);
    expect(commit).toHaveBeenCalledTimes(2);
  });
});
