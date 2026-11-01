import { fetchJSON } from '$lib/api';
import type { ConversationItem } from '$lib/conversation';

export const RELATION_STUB_LIMIT = 10;

type Page = { total: number; limit: number; items: ConversationItem[] };

/**
 * The project page's conversations block: the lens's row in the lens's order,
 * «lo que pide» (ADR-141 § 2: unread, then ours, then what moved last).
 * Keyed and filtered by the project's id: a project slug only names a project
 * inside its workspace (ADR-024), so the slug would mix in another space's
 * project of the same name.
 */
export function relationStubQueryOptions(projectId: string | null) {
  return {
    queryKey: ['conversations', { project_ids: projectId, limit: RELATION_STUB_LIMIT, orden: 'pide' }] as const,
    queryFn: ({ signal }: { signal: AbortSignal }) => fetchJSON<Page>(relationStubUrl(projectId!), signal),
    enabled: projectId !== null,
  };
}

export function relationStubUrl(projectId: string): string {
  const p = new URLSearchParams({ project_ids: projectId, limit: String(RELATION_STUB_LIMIT), orden: 'pide' });
  return `/api/conversations?${p}`;
}

/**
 * The project's «Falta» strip: a page in the endpoint's plain order (next
 * step, oldest first), which `lineMissing` needs to know whether the page
 * holds every due step. Not the block's order, so not the block's request.
 */
export function projectStepsQueryOptions(projectId: string | null) {
  return {
    queryKey: ['conversations', { project_ids: projectId, limit: RELATION_STUB_LIMIT }] as const,
    queryFn: ({ signal }: { signal: AbortSignal }) => fetchJSON<Page>(projectStepsUrl(projectId!), signal),
    enabled: projectId !== null,
  };
}

export function projectStepsUrl(projectId: string): string {
  const p = new URLSearchParams({ project_ids: projectId, limit: String(RELATION_STUB_LIMIT) });
  return `/api/conversations?${p}`;
}
