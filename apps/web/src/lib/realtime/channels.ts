/**
 * Realtime channel naming — keep the format in one place so subscribers and
 * publishers can't drift. Channel names are opaque strings to Supabase
 * Realtime; the convention is purely Hour's. See D-PRE-06.
 *
 * The `:` separator is conventional in Supabase docs and unambiguous because
 * UUIDs (the IDs we pass) never contain `:`.
 */

export type WorkspaceChannel = `workspace:${string}`;
export type WorkspacePresenceChannel = `workspace:${string}:presence`;
export type ProjectChannel = `project:${string}`;
export type ShowChannel = `show:${string}`;

export const channelName = {
  /** Broadcast/presence boundary at the workspace level. */
  workspace: (workspaceId: string): WorkspaceChannel => `workspace:${workspaceId}`,

  /** Presence sub-channel: who's currently connected to this workspace. */
  workspacePresence: (workspaceId: string): WorkspacePresenceChannel =>
    `workspace:${workspaceId}:presence`,

  /** Project-scoped broadcast (notes, status changes inside a Room). */
  project: (projectId: string): ProjectChannel => `project:${projectId}`,

  /** Show-scoped broadcast (gig-level edits, road-sheet collab triggers). */
  show: (showId: string): ShowChannel => `show:${showId}`,
} as const;
