import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ScopesStore } from './scopes.svelte';

// Fixed-slots recents (2026-07-17): position never changes after entry;
// lastUsedAt decides evictions, never order.

function names(store: ScopesStore): string[] {
  return store.recent.map((r) => r.name);
}

/** Minimal in-memory localStorage — the harness env doesn't provide one. */
function stubStorage() {
  const bag = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => bag.get(k) ?? null,
    setItem: (k: string, v: string) => void bag.set(k, v),
    removeItem: (k: string) => void bag.delete(k),
    clear: () => bag.clear(),
  });
}

describe('ScopesStore recents — fixed slots', () => {
  let store: ScopesStore;

  beforeEach(() => {
    stubStorage();
    vi.useFakeTimers();
    vi.setSystemTime(1_000);
    store = new ScopesStore();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  /** Advance the clock so each remember() gets a distinct timestamp. */
  function rememberAt(ms: number, name: string, tokens: string[]) {
    vi.setSystemTime(ms);
    store.remember(name, tokens);
  }

  it('new combos enter at the top', () => {
    rememberAt(1_000, 'A', ['s:a']);
    rememberAt(2_000, 'B', ['s:b']);
    expect(names(store)).toEqual(['B', 'A']);
  });

  it('re-applying a recent keeps its position and only bumps its clock', () => {
    rememberAt(1_000, 'A', ['s:a']);
    rememberAt(2_000, 'B', ['s:b']);
    rememberAt(3_000, 'C', ['s:c']);
    rememberAt(4_000, 'A', ['s:a']); // click the bottom row
    expect(names(store)).toEqual(['C', 'B', 'A']);
    expect(store.recent[2].lastUsedAt).toBe(4_000);
  });

  it('a full list evicts the least recently USED entry, not the bottom row', () => {
    rememberAt(1_000, 'A', ['s:a']);
    rememberAt(2_000, 'B', ['s:b']);
    rememberAt(3_000, 'C', ['s:c']);
    rememberAt(4_000, 'D', ['s:d']); // cap = 4, list full
    rememberAt(5_000, 'A', ['s:a']); // bottom row becomes the most used
    rememberAt(6_000, 'E', ['s:e']); // B (lastUsedAt 2000) falls, A survives
    expect(names(store)).toEqual(['E', 'D', 'C', 'A']);
  });

  it('restore seeds legacy entries (no lastUsedAt) from list position', () => {
    vi.setSystemTime(9_000);
    localStorage.setItem(
      'hour_scopes',
      JSON.stringify({
        saved: [],
        recent: [
          { name: 'Top', tokens: ['s:t'] },
          { name: 'Bottom', tokens: ['s:b'] },
        ],
      }),
    );
    store.restoreFromLocalStorage();
    expect(store.recent[0].lastUsedAt).toBeGreaterThan(store.recent[1].lastUsedAt);
    // A new combo on the now-full-of-legacy list must still evict the
    // oldest-by-clock (Bottom), keeping Top in place.
    rememberAt(10_000, 'C', ['s:c']);
    rememberAt(11_000, 'D', ['s:d']);
    rememberAt(12_000, 'E', ['s:e']);
    expect(names(store)).toEqual(['E', 'D', 'C', 'Top']);
  });
});
