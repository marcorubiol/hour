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
 * (The per-entity pin toggle this bar used to carry died 2026-07-17 with
 * the rest of the manual pin UI — scopes are built in the rail and ⌘K.)
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

export class BreadcrumbStore {
  crumbs = $state<Crumb[]>([]);

  set(crumbs: Crumb[]): void {
    this.crumbs = crumbs;
  }

  clear(): void {
    this.crumbs = [];
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
