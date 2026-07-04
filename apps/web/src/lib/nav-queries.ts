/**
 * Shared TanStack query options for the nav data (workspaces + all lines)
 * consumed by the shell ⌘K palette, the scope strip, and the Today/Calendar/
 * Money lenses. Reusing the exact same query keys means every consumer reads
 * one warm cache instead of refetching.
 */

import { fetchJSON } from './api';
import type { NavWorkspace, RawLine } from './nav';

export function workspacesQueryOptions() {
  return {
    queryKey: ['workspaces'] as const,
    queryFn: ({ signal }: { signal: AbortSignal }) =>
      fetchJSON<{ items: NavWorkspace[] }>('/api/workspaces', signal),
  };
}

export function allLinesQueryOptions() {
  return {
    queryKey: ['lines', 'all'] as const,
    queryFn: ({ signal }: { signal: AbortSignal }) =>
      fetchJSON<{ items: RawLine[] }>('/api/lines?status=any', signal),
  };
}
