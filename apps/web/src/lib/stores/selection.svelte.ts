/**
 * Selection store — which entity is currently selected in the sidebar
 * (House → Room) and what's anchored as the active scope for filtering.
 * Same SSR-safety pattern as lens.svelte.ts (class + factory + context).
 */

import { getContext, setContext } from 'svelte';
import type { EntityType } from '../reserved-slugs';

export interface SelectionEntity {
  type: EntityType | 'workspace';
  slug: string;
}

export class SelectionStore {
  workspace = $state<string | null>(null);
  entity = $state<SelectionEntity | null>(null);

  setWorkspace(slug: string) {
    this.workspace = slug;
  }

  setEntity(entity: SelectionEntity | null) {
    this.entity = entity;
  }

  clear() {
    this.entity = null;
  }
}

const KEY = Symbol('selection');

export function provideSelection(): SelectionStore {
  const store = new SelectionStore();
  setContext(KEY, store);
  return store;
}

export function useSelection(): SelectionStore {
  const store = getContext<SelectionStore | undefined>(KEY);
  if (!store) {
    throw new Error('useSelection() called outside a SelectionStore provider');
  }
  return store;
}
