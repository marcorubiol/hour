/**
 * ⌘K «crear» (ADR-139 «después»): what the palette offers to make, read from
 * what was typed, and what the shell deduces for the dialog it opens. Pure:
 * the palette draws, the creation store opens, this decides.
 *
 * WHAT IS OFFERED. Typing finds the actions in any of the four languages:
 * a verb («nueva», «crear», «new», «afegeix», «ajouter»…) offers the four
 * base ones; a kind word («ensayo», «viatge», «conversa», «tâche»…) offers
 * that kind, even half-typed. Whatever follows travels to the dialog as its
 * title. Any other text offers the four base ones too, with the WHOLE text as
 * title: you type «Mercat de les Flors», pick «Nueva función», and the title
 * is already there. An empty query offers nothing: the tree stays the tree.
 *
 * WHO. Never what the person cannot make: without editing the plan (the
 * Planner off, or no `edit:performance` anywhere) neither a performance nor
 * a date; without Converses (or the lens off) no conversation; a task only
 * where some space on screen takes one (a guest of a bolo writes none,
 * `$lib/workspace-role`).
 */

import { accentVarFor } from '$lib/utils/accent';
import { spaceName } from '$lib/utils/identity';
import type { NavWorkspace, resolveScope } from '$lib/nav';
import type { QuickType } from '$lib/quick-add';
import type { TaskTarget } from '$lib/task';

export type CreateKind =
  | 'performance'
  | 'date'
  | 'rehearsal'
  | 'travel_day'
  | 'residency'
  | 'day_off'
  | 'press'
  | 'other'
  | 'task'
  | 'conversation';

export interface PaletteCreate {
  kind: CreateKind;
  /** What follows the words that named the action: the dialog's title. */
  title: string;
}

export interface CreateCan {
  /** The Planner is on and the person edits performances somewhere. */
  plan: boolean;
  /** The selling lens is on and the person edits conversations somewhere. */
  converse: boolean;
  /** Some space on screen takes a task from the person (not a guest's). */
  task: boolean;
}

/** The four offered for a bare verb or free text, in this order. */
export const BASE_CREATES: readonly CreateKind[] = ['performance', 'date', 'task', 'conversation'];

export const CREATE_LABEL_KEYS: Record<CreateKind, string> = {
  performance: 'palette.new_performance',
  date: 'palette.new_date',
  rehearsal: 'palette.new_rehearsal',
  travel_day: 'palette.new_travel',
  residency: 'palette.new_residency',
  day_off: 'palette.new_day_off',
  press: 'palette.new_press',
  other: 'palette.new_other',
  task: 'palette.new_task',
  conversation: 'palette.new_conversation',
};

/**
 * The quick add's type for a kind. «Nueva fecha» names no type, so it opens
 * on the commonest date, a rehearsal; the type chip is right there.
 */
export function createEventType(kind: CreateKind): QuickType | null {
  if (kind === 'task' || kind === 'conversation') return null;
  if (kind === 'date') return 'rehearsal';
  return kind;
}

/** Lowercased and stripped of diacritics: «Conversación» → «conversacion». */
export function fold(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();
}

/** ca · es · en · fr, folded. The words that say «make one». */
const VERBS = [
  'nou', 'nova', 'afegeix', 'afegir', 'crea', 'crear',
  'nuevo', 'nueva', 'anadir', 'crear',
  'new', 'add', 'create',
  'nouveau', 'nouvelle', 'nouvel', 'ajouter', 'ajoute', 'creer',
];

/** The words that name each kind, folded, with the trade's (a concert). */
const KIND_WORDS: Record<CreateKind, readonly string[]> = {
  performance: ['funcio', 'funcion', 'actuacio', 'actuacion', 'performance', 'show', 'gig', 'representation', 'concert', 'concierto'],
  date: ['data', 'fecha', 'date', 'esdeveniment', 'evento', 'event', 'evenement'],
  rehearsal: ['assaig', 'ensayo', 'rehearsal', 'repetition'],
  travel_day: ['viatge', 'viaje', 'travel', 'trip', 'voyage', 'deplacement'],
  residency: ['residencia', 'residency', 'residence'],
  day_off: ['descans', 'descanso', 'off', 'relache'],
  press: ['premsa', 'prensa', 'press', 'presse'],
  other: ['altres', 'altre', 'otros', 'otro', 'other', 'autre', 'autres'],
  task: ['tasca', 'tarea', 'task', 'todo', 'tache'],
  conversation: ['conversa', 'conversacion', 'conversation', 'contacte', 'contacto', 'contact'],
};

/** A half-typed word counts from three letters; a shorter one must be whole. */
function startsWord(typed: string, word: string): boolean {
  return typed === word || (typed.length >= 3 && word.startsWith(typed));
}

function kindsNamed(typed: string): CreateKind[] {
  return (Object.keys(KIND_WORDS) as CreateKind[]).filter((k) => KIND_WORDS[k].some((w) => startsWord(typed, w)));
}

export function allowed(kind: CreateKind, can: CreateCan): boolean {
  if (kind === 'task') return can.task;
  if (kind === 'conversation') return can.converse;
  return can.plan;
}

/** The create actions for what was typed, best first; none for an empty query. */
export function paletteCreates(query: string, can: CreateCan): PaletteCreate[] {
  const words = query.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];
  const folded = words.map(fold);

  // Leading verbs are consumed; the last word may still be half a verb.
  let i = 0;
  while (i < words.length && VERBS.some((v) => (i === words.length - 1 ? startsWord(folded[i], v) : folded[i] === v))) i++;
  const verb = i > 0;

  const named = i < words.length ? kindsNamed(folded[i]) : [];
  const offer = (kinds: readonly CreateKind[], title: string) =>
    kinds.filter((k) => allowed(k, can)).map((kind) => ({ kind, title }));

  if (named.length > 0) return offer(named, words.slice(i + 1).join(' '));
  return offer(BASE_CREATES, words.slice(verb ? i : 0).join(' '));
}

type Scope = ReturnType<typeof resolveScope>;

/**
 * What the pinned scope says about a new thing: a single pinned line gives
 * its project and line; else a single pinned project; and the one workspace
 * the scope reaches (or the only one there is), for an unavailability.
 */
export function scopeCreatePresets(
  scope: Scope,
  workspaceIds: readonly string[],
): { projectId: string | null; lineId: string | null; workspaceId: string | null } {
  const projectId =
    scope.lines.length === 1
      ? scope.lines[0].projectId
      : scope.lines.length === 0 && scope.projects.length === 1
        ? scope.projects[0].id
        : null;
  const lineId = scope.lines.length === 1 ? scope.lines[0].id : null;
  let workspaceId: string | null = workspaceIds.length === 1 ? workspaceIds[0] : null;
  if (!scope.isEmpty) {
    const ids = new Set([
      ...scope.workspaceIds,
      ...scope.projects.map((p) => p.workspaceId),
      ...scope.lines.map((l) => l.workspaceId),
    ]);
    workspaceId = ids.size === 1 ? [...ids][0] : workspaceId;
  }
  return { projectId, lineId, workspaceId };
}

/**
 * The task's parent from the scope: the pinned line, else the pinned
 * project, else the scope's one space (or the first), like Hoy's composer.
 */
export function scopeTaskTarget(scope: Scope, workspaces: readonly NavWorkspace[]): TaskTarget {
  if (scope.lines.length === 1) {
    const l = scope.lines[0];
    return { kind: 'line', id: l.id, name: l.name, accent: l.accent, lineKind: l.kind };
  }
  if (scope.lines.length === 0 && scope.projects.length === 1) {
    const p = scope.projects[0];
    return { kind: 'project', id: p.id, name: p.name, accent: p.accent };
  }
  const { workspaceId } = scopeCreatePresets(scope, workspaces.map((w) => w.id));
  const ws = workspaces.find((w) => w.id === workspaceId) ?? workspaces[0];
  return ws
    ? { kind: 'space', id: ws.id, name: spaceName(ws.name), accent: accentVarFor(ws) }
    : { kind: 'space', id: '', name: '', accent: 'var(--text-faint)' };
}
