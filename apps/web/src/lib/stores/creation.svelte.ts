/**
 * Creation store (ADR-056) — one home for opening the creation dialogs from
 * anywhere in the shell: home cards, ⌘K actions, empty states, the lenses'
 * own buttons. The dialogs themselves are mounted ONCE in /h/+layout.svelte;
 * this context only carries the open-state + presets, so pages never mount
 * their own copies (one implementation, philosophy.md).
 *
 * Containers: line/template picker, project, space. Since the ⌘K «crear»
 * actions (ADR-139 «después»), also what goes INTO them: the quick add
 * (`CreateEventDialog`: a performance and every date type), a task (Hoy's
 * `TaskComposer`, in a dialog) and a conversation
 * (`CreateConversationDialog`, the lens's own «Añadir conversación»).
 *
 * What a preset leaves out, the shell deduces from the pinned scope
 * (`scopeCreatePresets`). The day is the one thing the shell cannot know: a
 * page that shows days (the Planner) lends its view's day with `hostEvents`,
 * and without one the quick add proposes today.
 */

import { getContext, setContext } from 'svelte';
import type { QuickType } from '$lib/quick-add';

const KEY = Symbol('creation');

/** What a door already knows when it opens the quick add. */
export interface EventPreset {
  /** YYYY-MM-DD; absent = the host's view day, else today. */
  date?: string | null;
  /** absent = the draft's own type. */
  type?: QuickType | null;
  /** A lane's project: wins over the scope's. */
  projectId?: string | null;
  /** Typed in ⌘K: the quick add's title. */
  title?: string | null;
}

/** What a page that shows days lends while mounted (the Planner). Read
 *  through getters, so the shell sees the page's live values. */
export interface EventHost {
  /** The day a door without one proposes: the view's (`defaultCreateDay`). */
  day: () => string;
  /** The availability and team feeds answer: an unavailability can be written. */
  readonly canUnavailable: boolean;
}

class CreationStore {
  lineOpen = $state(false);
  projectOpen = $state(false);
  workspaceOpen = $state(false);
  eventOpen = $state(false);
  taskOpen = $state(false);
  conversationOpen = $state(false);

  /** Presets consumed by the dialogs when opening from a scoped surface. */
  lineWorkspaceId = $state<string | null>(null);
  lineProjectId = $state<string | null>(null);
  projectWorkspaceId = $state<string | null>(null);
  event = $state<EventPreset>({});
  taskTitle = $state('');
  /** The conversation's «who» (its organization) and the tag it is born with. */
  conversationWho = $state('');
  conversationTag = $state<string | null>(null);

  /** Raw: a page's getters must stay getters, not a proxy's snapshot. */
  eventHost = $state.raw<EventHost | null>(null);

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

  /** The quick add. The day is settled NOW: the host reads its screen. */
  openEvent(preset: EventPreset = {}) {
    this.event = { ...preset, date: preset.date ?? this.eventHost?.day() ?? null };
    this.eventOpen = true;
  }

  openTask(preset?: { title?: string | null }) {
    this.taskTitle = preset?.title?.trim() ?? '';
    this.taskOpen = true;
  }

  openConversation(preset?: { who?: string | null; tag?: string | null }) {
    this.conversationWho = preset?.who?.trim() ?? '';
    this.conversationTag = preset?.tag ?? null;
    this.conversationOpen = true;
  }

  /** A page lends its day while mounted; the returned function takes it back. */
  hostEvents(host: EventHost): () => void {
    this.eventHost = host;
    return () => {
      if (this.eventHost === host) this.eventHost = null;
    };
  }
}

export { CreationStore };

export function provideCreation(): CreationStore {
  const store = new CreationStore();
  setContext(KEY, store);
  return store;
}

export function useCreation(): CreationStore {
  return getContext<CreationStore>(KEY);
}
