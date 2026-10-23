/**
 * The reads behind «Te espera» (ADR-121 § 2), shared by the Desk and the
 * Planner's margin (ADR-138 § 6): same keys and URLs, so the two surfaces
 * read one cache and `buildDeskFeed` → `rankWaiting` gets the same input.
 * The scope narrowing stays with each page (both narrow by project or space).
 */

import { fetchJSON } from './api';
import type { DeskConvInput } from './desk-feed';
import type { OverviewResponse } from './conversation-overview';
import type { TaskItem } from './task';

/** Conversations with their derived relation and next step (the Desk's own read). */
export function waitingConversationsQueryOptions() {
  return {
    queryKey: ['conversations', 'today'] as const,
    queryFn: ({ signal }: { signal: AbortSignal }) =>
      fetchJSON<{ items: (DeskConvInput & { workspace_id: string })[] }>('/api/conversations?limit=100', signal),
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
      const p = new URLSearchParams();
      if (filterIds.projectIds.length > 0) p.set('project_ids', filterIds.projectIds.join(','));
      if (filterIds.workspaceIds.length > 0) p.set('workspace_ids', filterIds.workspaceIds.join(','));
      if (lineIds.length > 0) p.set('line_ids', lineIds.join(','));
      return fetchJSON<OverviewResponse>(`/api/conversations/overview?${p}`, signal);
    },
  };
}
