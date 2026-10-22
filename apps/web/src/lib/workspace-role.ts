/**
 * What the caller's role in each workspace lets the frame of /h offer (comms
 * carril 2, fase 3; plan 2026-10-22 § 3.4). The data never depends on this:
 * RLS decides what is read, and the RPC what is written. This only stops the
 * screen from offering a door that would answer 403.
 *
 * A bolo invitation leaves its person as `guest` of the company's space (ADR-104):
 * they read their bolo's performances, their board and its threads, and
 * nothing else of that space; they write no task, no availability, no
 * project, no calendar feed. In practice they also own a personal space of
 * their own (signup makes one), so «guest» is per workspace, never per
 * person: a door is offered when at least one workspace on screen lets it
 * through, and it points at that workspace, never at the first one.
 *
 * Like the lenses (ADR-132) and access, only an explicit answer narrows:
 * a workspace whose role has not arrived reads as able.
 */

import type { NavWorkspace } from './nav';

export type WorkspaceRole = 'owner' | 'admin' | 'member' | 'viewer' | 'guest';

/** Roles that read and write the space's own directories: tasks, availability (ADR-104). */
const INTERNAL: ReadonlySet<string> = new Set(['owner', 'admin', 'member', 'viewer']);
/** Roles that create projects and publish a calendar feed (`create_project`, `create_calendar_share`). */
const WRITERS: ReadonlySet<string> = new Set(['owner', 'admin', 'member']);

type WithRole = Pick<NavWorkspace, 'my_role'>;

/** A guest of this space: here through a bolo (or a project) only. */
export function isGuestIn(w: WithRole | null | undefined): boolean {
  return w?.my_role === 'guest';
}

/** Writes the space's tasks and availability (`is_workspace_internal_member`). */
export function writesTasksIn(w: WithRole): boolean {
  return w.my_role == null || INTERNAL.has(w.my_role);
}

/** Creates a project or a calendar feed in the space. */
export function writesSpaceIn(w: WithRole): boolean {
  return w.my_role == null || WRITERS.has(w.my_role);
}

/** The workspaces, in their order, where tasks can be written. */
export function taskWorkspaces<T extends WithRole>(workspaces: readonly T[]): T[] {
  return workspaces.filter(writesTasksIn);
}

/** The workspaces, in their order, where a project or a feed can be made. */
export function spaceWriteWorkspaces<T extends WithRole>(workspaces: readonly T[]): T[] {
  return workspaces.filter(writesSpaceIn);
}

/**
 * Where «Ajustes» and the other doors without a space go: the first space the
 * person belongs to as more than a guest, else the first one. A technician
 * invited for one night lands on their own space's settings, not on the
 * company's, where there is nothing they can change.
 */
export function homeWorkspace<T extends WithRole>(workspaces: readonly T[]): T | undefined {
  return workspaces.find((w) => !isGuestIn(w)) ?? workspaces[0];
}

/**
 * Settings sections a space offers. A guest changes nothing of the space
 * (trade, lenses, tags, privacy, mailboxes, people are its admins'), so in a
 * space where they are a guest only their profile is theirs.
 */
export function settingsSectionsFor<S extends string>(
  w: WithRole | null | undefined,
  all: readonly S[],
  personal: readonly S[],
): S[] {
  return isGuestIn(w) ? all.filter((s) => personal.includes(s)) : [...all];
}

/** The caller's own workspace memberships, as `membership` gives them (RLS: own rows). */
export interface OwnMembership {
  workspace_id: string;
  workspace_role: string | null;
}

/** Each workspace with the caller's role in it; null where there is no row to say. */
export function withMyRole<T extends { id: string }>(
  items: readonly T[],
  memberships: readonly OwnMembership[],
): (T & { my_role: WorkspaceRole | null })[] {
  const roles = new Map(memberships.map((m) => [m.workspace_id, m.workspace_role]));
  return items.map((w) => ({ ...w, my_role: (roles.get(w.id) as WorkspaceRole | null | undefined) ?? null }));
}
