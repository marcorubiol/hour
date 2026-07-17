/**
 * Scopes store — saved scopes + recents (Scope v2 nav). A "scope" is a named
 * bundle of pins (the same `s:`/`p:`/`l:` tokens the PinsStore holds). The
 * sidebar surfaces these as one-click destinations; applying one just sets
 * `pins.pins = scope.tokens`. This is the D-PRE-05 "Master View" / saved-views
 * ceiling made concrete (structure-model.md § persona-fit): named token
 * bundles, never a per-card view builder.
 *
 *   · saved   → bundles the user explicitly kept (☆ Save scope)
 *   · recent  → bundles applied from ⌘K, auto-remembered, capped.
 *     Fixed slots: a recent's position never changes once it enters —
 *     not on click, not across sessions (muscle memory is the point).
 *     Every apply only bumps its invisible lastUsedAt; when the list is
 *     full, the least recently USED entry falls, wherever it sits.
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

export interface RecentScope extends Scope {
  /** epoch ms of the last apply — decides evictions, never order */
  lastUsedAt: number;
}

function sameSet(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const set = new Set(a);
  return b.every((x) => set.has(x));
}

export class ScopesStore {
  saved = $state<Scope[]>([]);
  recent = $state<RecentScope[]>([]);

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
    const hit = this.recent.find((r) => sameSet(r.tokens, tokens));
    if (hit) {
      // Fixed slot: a re-applied recent stays where it is — only its
      // usage clock moves.
      hit.lastUsedAt = Date.now();
      hit.name = name;
      this.persist();
      return;
    }
    // New combos enter at the top; a full list evicts the least recently
    // used entry, wherever it sits — never simply the bottom row.
    let next = [...this.recent];
    while (next.length >= RECENT_CAP) {
      const lru = next.reduce((a, b) => (b.lastUsedAt < a.lastUsedAt ? b : a));
      next = next.filter((r) => r !== lru);
    }
    this.recent = [{ name, tokens: [...tokens], lastUsedAt: Date.now() }, ...next];
    this.persist();
  }

  restoreFromLocalStorage(): void {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (parsed && Array.isArray(parsed.saved)) this.saved = parsed.saved;
      if (parsed && Array.isArray(parsed.recent)) {
        // Legacy entries carry no lastUsedAt (pre-fixed-slots): seed it
        // from list position — top WAS most recent under the old scheme.
        const now = Date.now();
        this.recent = (parsed.recent as (Scope & { lastUsedAt?: number })[]).map((r, i) => ({
          name: r.name,
          tokens: r.tokens,
          lastUsedAt: r.lastUsedAt ?? now - i,
        }));
      }
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
