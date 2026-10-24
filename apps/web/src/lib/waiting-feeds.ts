/**
 * The reads behind «Te espera» (ADR-121 § 2), shared by the Desk and the
 * Planner's margin (ADR-138 § 6): same keys and URLs, so the two surfaces
 * read one cache and `buildDeskFeed` → `rankWaiting` gets the same input.
 * The scope narrowing stays with each page (both narrow by project or space).
 */

import { fetchJSON } from './api';
import type { DeskConvInput } from './desk-feed';
import type { LastMailoutResponse, OverviewResponse } from './conversation-overview';
import type { TaskItem } from './task';

/** Conversations with their derived relation and next step (the Desk's own read). */
export function waitingConversationsQueryOptions() {
  return {
    queryKey: ['conversations', 'today'] as const,
    queryFn: ({ signal }: { signal: AbortSignal }) =>
      // `lean`: the rows only; neither surface reads the count, the bolos or the mailout.
      fetchJSON<{ items: (DeskConvInput & { workspace_id: string })[] }>('/api/conversations?limit=100&lean=1', signal),
  };
}

/** Open tasks: the Desk's key, which its writes update in place. */
export function waitingTasksQueryOptions() {
  return {
    queryKey: ['tasks', 'open'] as const,
    queryFn: ({ signal }: { signal: AbortSignal }) =>
      fetchJSON<{ items: TaskItem[] }>('/api/tasks?status=open&limit=200', signal),
  };
}

function scopeParams(filterIds: { projectIds: string[]; workspaceIds: string[] }): URLSearchParams {
  const p = new URLSearchParams();
  if (filterIds.projectIds.length > 0) p.set('project_ids', filterIds.projectIds.join(','));
  if (filterIds.workspaceIds.length > 0) p.set('workspace_ids', filterIds.workspaceIds.join(','));
  return p;
}

/** The Conversations overview of a scope (its «te toca» replies wait today). */
export function conversationOverviewQueryOptions(
  filterIds: { projectIds: string[]; workspaceIds: string[] },
  lineIds: string[],
  enabled: boolean,
) {
  return {
    queryKey: ['conversation-overview', filterIds.projectIds, filterIds.workspaceIds, lineIds] as const,
    enabled,
    queryFn: ({ signal }: { signal: AbortSignal }) => {
      const p = scopeParams(filterIds);
      if (lineIds.length > 0) p.set('line_ids', lineIds.join(','));
      return fetchJSON<OverviewResponse>(`/api/conversations/overview?${p}`, signal);
    },
  };
}

/**
 * The last mailout of a scope: Hoy's news and Difusión's block, one key. Its
 * own read since 2026-10-24, so neither waits for it to draw the rest. Under
 * the `conversation-overview` prefix: what invalidates the panel refreshes it.
 */
export function lastMailoutQueryOptions(filterIds: { projectIds: string[]; workspaceIds: string[] }, enabled: boolean) {
  return {
    queryKey: ['conversation-overview', 'last-mailout', filterIds.projectIds, filterIds.workspaceIds] as const,
    enabled,
    queryFn: ({ signal }: { signal: AbortSignal }) =>
      fetchJSON<LastMailoutResponse>(`/api/conversations/last-mailout?${scopeParams(filterIds)}`, signal),
  };
}
