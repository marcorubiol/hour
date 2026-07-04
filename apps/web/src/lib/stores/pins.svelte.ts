/**
 * Pins store (Adaptive Digest, ADR-057 nav redesign) — the scope model
 * that replaces the persistent sidebar. A pin brings a unit of work forward
 * onto the clean home and scopes the Calendar/Money lenses. Two kinds:
 *
 *   · space  → a whole workspace         encoded `s:<workspaceSlug>`
 *   · line   → a single line of work      encoded `l:<lineId>`
 *
 * Identity only — display (name, kind, accent, URL) is resolved by consumers
 * from the live `['workspaces']` and `['lines', …]` caches, so a renamed or
 * revoked target never leaves stale text baked into localStorage.
 *
 * Empty pins = everything the user can see (ADR-038: empty scope = all RLS
 * allows). Persisted across sessions. Provided via context like selection/lens.
 */

import { getContext, setContext } from 'svelte';

const KEY = Symbol('pins');
const STORAGE_KEY = 'hour_pins';

export type PinKind = 'space' | 'line';
export type ParsedPin = { kind: PinKind; key: string };

export function spacePin(workspaceSlug: string): string {
  return `s:${workspaceSlug}`;
}
export function linePin(lineId: string): string {
  return `l:${lineId}`;
}
export function parsePin(pin: string): ParsedPin {
  return pin.startsWith('l:')
    ? { kind: 'line', key: pin.slice(2) }
    : { kind: 'space', key: pin.slice(2) };
}

export class PinsStore {
  pins = $state<string[]>([]);

  has(pin: string): boolean {
    return this.pins.includes(pin);
  }

  add(pin: string) {
    if (!this.pins.includes(pin)) {
      this.pins = [...this.pins, pin];
      this.persist();
    }
  }

  remove(pin: string) {
    this.pins = this.pins.filter((p) => p !== pin);
    this.persist();
  }

  toggle(pin: string) {
    if (this.has(pin)) this.remove(pin);
    else this.add(pin);
  }

  /** Workspace slugs of the pinned spaces. */
  spaceSlugs(): string[] {
    return this.pins
      .filter((p) => p.startsWith('s:'))
      .map((p) => p.slice(2));
  }

  /** Line ids of the pinned lines. */
  lineIds(): string[] {
    return this.pins
      .filter((p) => p.startsWith('l:'))
      .map((p) => p.slice(2));
  }

  restoreFromLocalStorage(): void {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.every((x) => typeof x === 'string')) {
        this.pins = parsed;
      }
    } catch {
      // Storage disabled or malformed — start empty (= everything).
    }
  }

  private persist(): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.pins));
    } catch {
      // ignore
    }
  }
}

export function providePins(): PinsStore {
  const store = new PinsStore();
  setContext(KEY, store);
  return store;
}

export function usePins(): PinsStore {
  return getContext<PinsStore>(KEY);
}
