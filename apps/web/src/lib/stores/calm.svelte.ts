/**
 * Calm store (spec § Desk · Calm mode) — a USER-ACTIVATED filter, never
 * automatic. It lives in the shell, not the Desk page, because the toggle
 * sits in the sidebar by the clock while the Desk reads it to fold the feed
 * (shell paints the control, the child route consumes the state).
 *
 * Class + context (not module-level $state) so SSR instances don't leak
 * across users — same reason as the lens store. localStorage ('hour_calm')
 * carries it across sessions; hydration runs in the layout's onMount after
 * SSR so the `false` default paints first frame.
 */

import { getContext, setContext } from 'svelte';

const STORAGE_KEY = 'hour_calm';

export class CalmStore {
  on = $state(false);

  toggle(): void {
    this.set(!this.on);
  }

  set(next: boolean): void {
    this.on = next;
    if (typeof localStorage === 'undefined') return;
    try {
      localStorage.setItem(STORAGE_KEY, next ? '1' : '0');
    } catch {
      // Storage full or disabled — in-session state still works.
    }
  }

  restoreFromLocalStorage(): void {
    if (typeof localStorage === 'undefined') return;
    try {
      this.on = localStorage.getItem(STORAGE_KEY) === '1';
    } catch {
      // Disabled — stay with the default.
    }
  }
}

const KEY = Symbol('calm');

export function provideCalm(): CalmStore {
  const store = new CalmStore();
  setContext(KEY, store);
  return store;
}

export function useCalm(): CalmStore {
  const store = getContext<CalmStore | undefined>(KEY);
  if (!store) throw new Error('useCalm() called outside a CalmStore provider');
  return store;
}
