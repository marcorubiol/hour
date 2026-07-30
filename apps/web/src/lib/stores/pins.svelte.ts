/**
 * Pins store (Adaptive Digest, ADR-057 nav redesign; projects ADR-060) —
 * the scope model that replaces the persistent sidebar. A pin brings a unit
 * of work forward onto the clean home and scopes the Calendar/Money lenses.
 * Three kinds are the container ladder, one per level of the model:
 *
 *   · space   → a whole workspace         encoded `s:<workspaceSlug>`
 *   · project → a production (the show)    encoded `p:<projectId>`
 *   · line    → a single line of work      encoded `l:<lineId>`
 *
 * And a fourth that is NOT on that ladder:
 *
 *   · person  → whoever carries the work   encoded `pe:<personId>`
 *
 * A person is not a container — it holds nothing, it is *attached to* things
 * by rosters — so it narrows on a different axis: the three above partition
 * the work (each row belongs to exactly one space and one project), a person
 * covers it (a gig is a night for everyone who plays it). Narrowing does not
 * care about that difference; GROUPING does, which is why `$lib/people`
 * keeps the attribution and its evidence separate. Two letters because `p:`
 * was already the project's, and `parsePin` tests it first so it can never
 * fall through to the space branch.
 *
 * Identity only — display (name, kind, accent, URL) is resolved by consumers
 * from the live `['workspaces']`, `['projects', …]` and `['lines', …]`
 * caches, so a renamed or revoked target never leaves stale text baked into
 * localStorage.
 *
 * Empty pins = everything the user can see (ADR-038: empty scope = all RLS
 * allows). Persisted across sessions. Provided via context like selection/lens.
 */

import { getContext, setContext } from 'svelte';

const KEY = Symbol('pins');
const STORAGE_KEY = 'hour_pins';

export type PinKind = 'space' | 'project' | 'line' | 'person';
export type ParsedPin = { kind: PinKind; key: string };

export function spacePin(workspaceSlug: string): string {
  return `s:${workspaceSlug}`;
}
export function projectPin(projectId: string): string {
  return `p:${projectId}`;
}
export function linePin(lineId: string): string {
  return `l:${lineId}`;
}
export function personPin(personId: string): string {
  return `pe:${personId}`;
}
export function parsePin(pin: string): ParsedPin {
  // `pe:` is tested BEFORE `p:` and before the space fallback: the last line
  // treats anything unrecognised as a space and slices two characters off it,
  // so a token checked in the wrong order does not fail — it silently becomes
  // a space pin with a mangled slug, which resolves to nothing and reads as
  // "scope is empty". Order is load-bearing here, not stylistic.
  if (pin.startsWith('pe:')) return { kind: 'person', key: pin.slice(3) };
  if (pin.startsWith('l:')) return { kind: 'line', key: pin.slice(2) };
  if (pin.startsWith('p:')) return { kind: 'project', key: pin.slice(2) };
  return { kind: 'space', key: pin.slice(2) };
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

  /** Replace the whole pin set at once (applying a saved scope). Persists. */
  set(pins: string[]) {
    this.pins = [...pins];
    this.persist();
  }

  /** Workspace slugs of the pinned spaces. */
  spaceSlugs(): string[] {
    return this.pins
      .filter((p) => p.startsWith('s:'))
      .map((p) => p.slice(2));
  }

  /** Project ids of the pinned projects. */
  projectIds(): string[] {
    return this.pins
      .filter((p) => p.startsWith('p:'))
      .map((p) => p.slice(2));
  }

  /** Line ids of the pinned lines. */
  lineIds(): string[] {
    return this.pins
      .filter((p) => p.startsWith('l:'))
      .map((p) => p.slice(2));
  }

  /** Person ids of the pinned people — the axis that is not a container. */
  personIds(): string[] {
    return this.pins
      .filter((p) => p.startsWith('pe:'))
      .map((p) => p.slice(3));
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
