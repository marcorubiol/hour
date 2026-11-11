/**
 * Borrar con «Deshacer» (`$lib/undo-remove`, tarea 134): se va al momento,
 * se escribe al acabar el aviso, «Deshacer» no escribe nada y un fallo lo
 * devuelve a la vista. Y lo borrado se borra seguro: al cerrar el aviso, al
 * desmontar, al esconder o cerrar la pestaña, siempre con `keepalive`.
 */
import { flushSync } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mutateJSON = vi.fn((..._args: unknown[]) => Promise.resolve(null));
vi.mock('$lib/api', () => ({ mutateJSON: (...args: unknown[]) => mutateJSON(...args) }));
type Toast = { ondismiss?: () => void; action?: { run: () => void } };
const toasts: Toast[] = [];
vi.mock('$lib/components/Toast.svelte', () => ({
  addToast: (t: Toast) => toasts.push(t),
  removeToast: () => {},
}));

const { undoableRemovals } = await import('./undo-remove.svelte');
type UndoableRemovals = ReturnType<typeof undoableRemovals>;

let cleanup: (() => void) | null = null;

function make(onsettled?: () => void): UndoableRemovals {
  let r!: UndoableRemovals;
  cleanup = $effect.root(() => {
    r = undoableRemovals({ locale: 'es', ms: 1000, onsettled });
  });
  // The listeners and the unmount flush live in an $effect: let it mount.
  flushSync();
  return r;
}

function deletes(): string[] {
  return mutateJSON.mock.calls.map((c) => {
    expect(c[0]).toBe('DELETE');
    expect(c[3]).toEqual({ keepalive: true });
    return c[1] as string;
  });
}

function setHidden(state: 'hidden' | 'visible') {
  Object.defineProperty(document, 'visibilityState', { value: state, configurable: true });
  document.dispatchEvent(new Event('visibilitychange'));
}

beforeEach(() => {
  vi.useFakeTimers();
  mutateJSON.mockReset();
  toasts.length = 0;
  mutateJSON.mockImplementation(() => Promise.resolve(null));
});
afterEach(() => {
  cleanup?.();
  cleanup = null;
  setHidden('visible');
  vi.useRealTimers();
});

describe('undoableRemovals', () => {
  it('hides at once and writes when the notice ends', async () => {
    const settled = vi.fn();
    const r = make(settled);
    r.remove('a', { message: 'Nota borrada.', url: '/api/notes/a' });
    expect(r.hidden.has('a')).toBe(true);
    expect(mutateJSON).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1000);
    expect(deletes()).toEqual(['/api/notes/a']);
    expect(settled).toHaveBeenCalledTimes(1);
    // Written: it stays out of the screen until the read no longer has it.
    expect(r.hidden.has('a')).toBe(true);
  });

  it('«Deshacer» writes nothing and shows it again; a second press is ignored', async () => {
    const r = make();
    r.remove('a', { message: 'x', url: '/a' });
    r.remove('a', { message: 'x', url: '/a' });
    r.undo('a');
    expect(r.hidden.has('a')).toBe(false);
    r.flush();
    await vi.advanceTimersByTimeAsync(5000);
    expect(mutateJSON).not.toHaveBeenCalled();
  });

  it('a failed write brings it back', async () => {
    mutateJSON.mockImplementation(() => Promise.reject(new Error('boom')));
    const r = make();
    r.remove('a', { message: 'x', url: '/a' });
    await vi.advanceTimersByTimeAsync(1000);
    expect(r.hidden.has('a')).toBe(false);
  });

  it('two removals in a row are two deletes, each on its own clock, and undoing one keeps the other', async () => {
    const r = make();
    r.remove('a', { message: 'x', url: '/a' });
    await vi.advanceTimersByTimeAsync(400);
    r.remove('b', { message: 'y', url: '/b' });
    r.remove('c', { message: 'z', url: '/c' });
    r.undo('c');
    await vi.advanceTimersByTimeAsync(600);
    expect(deletes()).toEqual(['/a']);
    await vi.advanceTimersByTimeAsync(400);
    expect(deletes()).toEqual(['/a', '/b']);
    await vi.advanceTimersByTimeAsync(5000);
    expect(deletes()).toEqual(['/a', '/b']);
  });

  it('flush writes what is pending, once', async () => {
    const r = make();
    r.remove('a', { message: 'x', url: '/a' });
    r.remove('b', { message: 'y', url: '/b' });
    r.flush();
    r.flush();
    await vi.advanceTimersByTimeAsync(5000);
    expect(deletes()).toEqual(['/a', '/b']);
  });

  it('unmounting (leaving the screen) writes at once', async () => {
    const r = make();
    r.remove('a', { message: 'x', url: '/a' });
    cleanup?.();
    cleanup = null;
    expect(deletes()).toEqual(['/a']);
    await vi.advanceTimersByTimeAsync(5000);
    expect(mutateJSON).toHaveBeenCalledTimes(1);
  });

  it('closing the tab (pagehide) sends the delete in the same turn', () => {
    const r = make();
    r.remove('a', { message: 'x', url: '/a' });
    window.dispatchEvent(new Event('pagehide'));
    // Synchronous: no timer, no await before the request leaves.
    expect(deletes()).toEqual(['/a']);
  });

  it('hiding the tab writes; showing it again does not', async () => {
    const r = make();
    r.remove('a', { message: 'x', url: '/a' });
    setHidden('visible');
    expect(mutateJSON).not.toHaveBeenCalled();
    setHidden('hidden');
    expect(deletes()).toEqual(['/a']);
  });

  it('closing the notice by hand confirms it: the delete goes now', async () => {
    const r = make();
    r.remove('a', { message: 'x', url: '/a' });
    toasts.at(-1)!.ondismiss!();
    expect(deletes()).toEqual(['/a']);
    await vi.advanceTimersByTimeAsync(5000);
    expect(mutateJSON).toHaveBeenCalledTimes(1);
  });

  it('the notice\'s «Deshacer» is the undo', async () => {
    const r = make();
    r.remove('a', { message: 'x', url: '/a' });
    toasts.at(-1)!.action!.run();
    expect(r.hidden.has('a')).toBe(false);
    await vi.advanceTimersByTimeAsync(5000);
    expect(mutateJSON).not.toHaveBeenCalled();
  });
});
