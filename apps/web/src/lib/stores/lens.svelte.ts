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
 * factory default ('desk') paints on first frame and we don't reach for
 * localStorage on the server.
 */

import { getContext, setContext } from 'svelte';

export type Lens = 'desk' | 'calendar' | 'conversations' | 'money';
const VALID_LENSES: readonly Lens[] = ['desk', 'calendar', 'conversations', 'money'];
const STORAGE_KEY = 'hour_lens';

export class LensStore {
  current = $state<Lens>('desk');

  set(next: Lens) {
    this.current = next;
    this.persist();
  }

  restoreFromLocalStorage(): boolean {
    if (typeof localStorage === 'undefined') return false;
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return false;
      // A session stored before ADR-075 holds the dead 'contacts'. Map it and
      // rewrite storage on the spot: one-shot migration, not a standing alias
      // — once every browser has re-persisted, this line is deletable. Without
      // it the dead value fails the check below and drops the user on 'desk'
      // with no clue why.
      const value = raw === 'contacts' ? 'conversations' : raw;
      if (!(VALID_LENSES as readonly string[]).includes(value)) return false;
      this.current = value as Lens;
      if (value !== raw) this.persist();
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

export function provideLens(initial: Lens = 'desk'): LensStore {
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
