/**
 * Lens store — which top-level view the user is in (ADR-009).
 *
 * Class + factory + setContext/getContext rather than module-level $state,
 * because module instances are reused across requests in SSR — bare module
 * state would leak between users. The factory creates a fresh store per
 * request when the workspace layout calls setContext.
 *
 * Persistence: last active lens survives across sessions via localStorage
 * (`hour_lens`). Hydration runs in the layout's onMount after SSR so the
 * factory default ('today') paints on first frame and we don't reach for
 * localStorage on the server.
 */

import { getContext, setContext } from 'svelte';

export type Lens = 'today' | 'calendar' | 'contacts' | 'money';
const VALID_LENSES: readonly Lens[] = ['today', 'calendar', 'contacts', 'money'];
const STORAGE_KEY = 'hour_lens';

export class LensStore {
  current = $state<Lens>('today');

  set(next: Lens) {
    this.current = next;
    this.persist();
  }

  restoreFromLocalStorage(): boolean {
    if (typeof localStorage === 'undefined') return false;
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return false;
      if (!(VALID_LENSES as readonly string[]).includes(raw)) return false;
      this.current = raw as Lens;
      return true;
    } catch {
      return false;
    }
  }

  private persist(): void {
    if (typeof localStorage === 'undefined') return;
    try {
      localStorage.setItem(STORAGE_KEY, this.current);
    } catch {
      // Storage full or disabled — in-session state still works
    }
  }
}

const KEY = Symbol('lens');

export function provideLens(initial: Lens = 'today'): LensStore {
  const store = new LensStore();
  store.current = initial;
  setContext(KEY, store);
  return store;
}

export function useLens(): LensStore {
  const store = getContext<LensStore | undefined>(KEY);
  if (!store) {
    throw new Error('useLens() called outside a LensStore provider');
  }
  return store;
}
