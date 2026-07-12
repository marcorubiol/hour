/**
 * Shared TanStack query options for the nav data (workspaces + projects +
 * all lines) consumed by the shell ⌘K palette, the scope strip, and the
 * Today/Calendar/Money lenses. Reusing the exact same query keys means every
 * consumer reads one warm cache instead of refetching.
 */

import { fetchJSON } from './api';
import type { NavWorkspace, RawLine, RawProject } from './nav';

export function workspacesQueryOptions() {
  return {
    queryKey: ['workspaces'] as const,
    queryFn: ({ signal }: { signal: AbortSignal }) =>
      fetchJSON<{ items: NavWorkspace[] }>('/api/workspaces', signal),
  };
}

/** Same key + fetch the project/line detail pages and the create-project
 *  dialog already use — one warm cache across the app. */
export function activeProjectsQueryOptions() {
  return {
    queryKey: ['projects', { status: 'active' }] as const,
    queryFn: ({ signal }: { signal: AbortSignal }) =>
      fetchJSON<{ items: RawProject[] }>('/api/projects?status=active', signal),
  };
}

export function allLinesQueryOptions() {
  return {
    queryKey: ['lines', 'all'] as const,
    queryFn: ({ signal }: { signal: AbortSignal }) =>
      fetchJSON<{ items: RawLine[] }>('/api/lines?status=any', signal),
  };
}
