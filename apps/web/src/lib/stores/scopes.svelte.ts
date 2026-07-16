/**
 * Scopes store — saved scopes + recents (Scope v2 nav). A "scope" is a named
 * bundle of pins (the same `s:`/`p:`/`l:` tokens the PinsStore holds). The
 * sidebar surfaces these as one-click destinations; applying one just sets
 * `pins.pins = scope.tokens`. This is the D-PRE-05 "Master View" / saved-views
 * ceiling made concrete (structure-model.md § persona-fit): named token
 * bundles, never a per-card view builder.
 *
 *   · saved   → bundles the user explicitly kept (☆ Save scope)
 *   · recent  → bundles applied from ⌘K, auto-remembered, capped
 *
 * "Everything" (empty tokens) and the per-space scopes are derived in the
 * sidebar from the live `['workspaces']` cache — not stored here — so a
 * renamed/removed space never leaves stale text baked into localStorage.
 * Class + context (not module $state) so SSR never leaks between users.
 */

import { getContext, setContext } from 'svelte';

const KEY = Symbol('scopes');
const STORAGE_KEY = 'hour_scopes';
const RECENT_CAP = 4;

export interface Scope {
  name: string;
  /** pin tokens — `s:<slug>` | `p:<id>` | `l:<id>` */
  tokens: string[];
}

function sameSet(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const set = new Set(a);
  return b.every((x) => set.has(x));
}

export class ScopesStore {
  saved = $state<Scope[]>([]);
  recent = $state<Scope[]>([]);

  /** Keep a scope under the given name (dedupe by token set). Saving purges
   *  the combo from Recent — a saved scope never lives in both lists. */
  save(name: string, tokens: string[]): void {
    if (tokens.length === 0) return;
    if (this.saved.some((s) => sameSet(s.tokens, tokens))) return;
    this.saved = [...this.saved, { name, tokens: [...tokens] }];
    this.recent = this.recent.filter((r) => !sameSet(r.tokens, tokens));
    this.persist();
  }

  remove(tokens: string[]): void {
    this.saved = this.saved.filter((s) => !sameSet(s.tokens, tokens));
    this.persist();
  }

  /** Overwrite a saved scope's tokens (Update scope — keeps its name). */
  update(oldTokens: string[], newTokens: string[]): void {
    if (newTokens.length === 0) return;
    const s = this.saved.find((x) => sameSet(x.tokens, oldTokens));
    if (!s) return;
    s.tokens = [...newTokens];
    this.recent = this.recent.filter((r) => !sameSet(r.tokens, newTokens));
    this.persist();
  }

  /** Rename a saved scope (identified by its token set). */
  rename(tokens: string[], name: string): void {
    const t = name.trim();
    if (!t) return;
    const s = this.saved.find((x) => sameSet(x.tokens, tokens));
    if (s) {
      s.name = t;
      this.persist();
    }
  }

  /** Remember an applied scope in Recent (skip if it's already a saved one). */
  remember(name: string, tokens: string[]): void {
    if (tokens.length === 0) return;
    if (this.saved.some((s) => sameSet(s.tokens, tokens))) return;
    const rest = this.recent.filter((r) => !sameSet(r.tokens, tokens));
    this.recent = [{ name, tokens: [...tokens] }, ...rest].slice(0, RECENT_CAP);
    this.persist();
  }

  restoreFromLocalStorage(): void {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (parsed && Array.isArray(parsed.saved)) this.saved = parsed.saved;
      if (parsed && Array.isArray(parsed.recent)) this.recent = parsed.recent;
    } catch {
      // storage disabled / malformed — start empty
    }
  }

  private persist(): void {
    try {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ saved: this.saved, recent: this.recent }),
      );
    } catch {
      // ignore
    }
  }
}

export function provideScopes(): ScopesStore {
  const store = new ScopesStore();
  setContext(KEY, store);
  return store;
}

export function useScopes(): ScopesStore {
  return getContext<ScopesStore>(KEY);
}

export { sameSet };
