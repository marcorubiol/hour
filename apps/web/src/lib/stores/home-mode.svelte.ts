/**
 * Home-mode store (Adaptive Digest) — the Today lens has two sub-modes:
 *   · digest ("Clean") — a quiet column: greeting + this-week agenda + pins.
 *   · custom ("My home") — a composed board of widgets the user assembles.
 * The toggle lives in the shell top bar; the Today page reads the value.
 * Persisted so a chosen home survives refresh.
 */

import { getContext, setContext } from 'svelte';

const KEY = Symbol('home-mode');
const STORAGE_KEY = 'hour_home_mode';

export type HomeMode = 'digest' | 'custom';

export class HomeModeStore {
  current = $state<HomeMode>('digest');

  set(next: HomeMode) {
    this.current = next;
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // ignore
    }
  }

  restoreFromLocalStorage(): void {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw === 'digest' || raw === 'custom') this.current = raw;
    } catch {
      // ignore
    }
  }
}

export function provideHomeMode(): HomeModeStore {
  const store = new HomeModeStore();
  setContext(KEY, store);
  return store;
}

export function useHomeMode(): HomeModeStore {
  return getContext<HomeModeStore>(KEY);
}
