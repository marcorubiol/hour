/**
 * Breadcrumb store — the address layer for entity pages. An entity page
 * (line, project, performance, person) declares WHERE it is; the shell
 * (/h/+layout) renders that address as a sticky bar under the top bar and
 * clears it on non-entity routes (home/lenses set nothing).
 *
 * Separation of concerns: the page owns "what's the address" (it has the
 * ancestry names loaded); the shell owns "where it renders" (sticky chrome,
 * aligned with the page column). Same split as pins/lens — provided via
 * context, consumed with use*.
 *
 * `pin` is the current entity's pin target (id + label). The shell renders
 * a pin toggle from it against the shared pins store — one pin concept, two
 * surfaces (filter on the home, toggle-in-place here). Decision A.
 */

import { getContext, setContext } from 'svelte';

const KEY = Symbol('breadcrumb');

export type Crumb = {
  label: string;
  /** Omitted on the current node (renders as bold, not a link). */
  href?: string;
  /** 'space' → mono kicker + accent dot; 'node' → sans link. */
  kind?: 'space' | 'node';
  /** Accent var for the space dot (from accentVar(slug)). */
  accent?: string;
};

export type PinTarget = { id: string; label: string };

export class BreadcrumbStore {
  crumbs = $state<Crumb[]>([]);
  pin = $state<PinTarget | null>(null);

  set(crumbs: Crumb[], opts: { pin?: PinTarget | null } = {}): void {
    this.crumbs = crumbs;
    this.pin = opts.pin ?? null;
  }

  clear(): void {
    this.crumbs = [];
    this.pin = null;
  }
}

export function provideBreadcrumb(): BreadcrumbStore {
  const store = new BreadcrumbStore();
  setContext(KEY, store);
  return store;
}

export function useBreadcrumb(): BreadcrumbStore {
  return getContext<BreadcrumbStore>(KEY);
}
