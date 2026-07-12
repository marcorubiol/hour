/**
 * Creation store (ADR-056) — one home for opening the three creation
 * dialogs (line/template picker, project, space) from anywhere in the
 * shell: home cards, ⌘K actions, empty states. The dialogs themselves are
 * mounted ONCE in /h/+layout.svelte; this context only carries the
 * open-state + presets, so pages never mount their own copies (one
 * implementation, philosophy.md).
 */

import { getContext, setContext } from 'svelte';

const KEY = Symbol('creation');

export class CreationStore {
  lineOpen = $state(false);
  projectOpen = $state(false);
  workspaceOpen = $state(false);

  /** Presets consumed by the dialogs when opening from a scoped surface. */
  lineWorkspaceId = $state<string | null>(null);
  lineProjectId = $state<string | null>(null);
  projectWorkspaceId = $state<string | null>(null);

  openLine(preset?: { workspaceId?: string; projectId?: string }) {
    this.lineWorkspaceId = preset?.workspaceId ?? null;
    this.lineProjectId = preset?.projectId ?? null;
    this.lineOpen = true;
  }

  openProject(preset?: { workspaceId?: string }) {
    this.projectWorkspaceId = preset?.workspaceId ?? null;
    this.projectOpen = true;
  }

  openWorkspace() {
    this.workspaceOpen = true;
  }
}

export function provideCreation(): CreationStore {
  const store = new CreationStore();
  setContext(KEY, store);
  return store;
}

export function useCreation(): CreationStore {
  return getContext<CreationStore>(KEY);
}
