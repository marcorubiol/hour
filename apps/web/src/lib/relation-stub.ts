import { fetchJSON } from '$lib/api';
import type { ConversationItem } from '$lib/conversation';

export const RELATION_STUB_LIMIT = 10;

/**
 * The project page's page of a project's conversations, next step first. The
 * page's «Falta» strip reads the same options: one key, one request. Keyed
 * and filtered by the project's id: a project slug only names a project
 * inside its workspace (ADR-024), so the slug would mix in another space's
 * project of the same name.
 */
export function relationStubQueryOptions(projectId: string | null) {
  return {
    queryKey: ['conversations', { project_ids: projectId, limit: RELATION_STUB_LIMIT }] as const,
    queryFn: ({ signal }: { signal: AbortSignal }) =>
      fetchJSON<{ total: number; limit: number; items: ConversationItem[] }>(relationStubUrl(projectId!), signal),
    enabled: projectId !== null,
  };
}

export function relationStubUrl(projectId: string): string {
  const p = new URLSearchParams({ project_ids: projectId, limit: String(RELATION_STUB_LIMIT) });
  return `/api/conversations?${p}`;
}
