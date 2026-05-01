/**
 * Lens store — which top-level view the user is in (ADR-009).
 *
 * Class + factory + setContext/getContext rather than module-level $state,
 * because module instances are reused across requests in SSR — bare module
 * state would leak between users. The factory creates a fresh store per
 * request when the workspace layout calls setContext.
 */

import { getContext, setContext } from 'svelte';

export type Lens = 'desk' | 'calendar' | 'contacts' | 'money';

export class LensStore {
  current = $state<Lens>('desk');

  set(next: Lens) {
    this.current = next;
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
