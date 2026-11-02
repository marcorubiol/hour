/**
 * Las consultas del público (ADR-173). Una clave por pieza para que una
 * escritura refresque lo que toca: `audience-lists` (la vista Público y quién
 * la ve) y `audience` (la página de una lista).
 */

import { fetchJSON } from '$lib/api';
import type { AudienceDetail, AudienceListResponse } from '$lib/audience';

export function audienceListQueryOptions(workspaceIds: readonly string[]) {
  const ids = [...workspaceIds].sort();
  return {
    queryKey: ['audience-lists', ids] as const,
    enabled: ids.length > 0,
    queryFn: ({ signal }: { signal: AbortSignal }) =>
      fetchJSON<AudienceListResponse>(`/api/audience?workspace_ids=${ids.join(',')}`, signal),
  };
}

export function audienceQueryOptions(id: string) {
  return {
    queryKey: ['audience', id] as const,
    enabled: Boolean(id),
    queryFn: ({ signal }: { signal: AbortSignal }) => fetchJSON<AudienceDetail>(`/api/audience/${id}`, signal),
  };
}
