/**
 * Las organizaciones del espacio para autocompletar el alta de una
 * conversación (ADR-102: la conversación es con la organización).
 */

import { fetchJSON } from './api';

export interface OrganizationOption {
  id: string;
  workspace_id: string;
  name: string;
}

/** Una caché para toda la app: los diálogos de alta la comparten. */
export function organizationsQueryOptions() {
  return {
    queryKey: ['organizations'] as const,
    queryFn: ({ signal }: { signal: AbortSignal }) =>
      fetchJSON<{ items: OrganizationOption[] }>('/api/organizations', signal),
    staleTime: 60_000,
  };
}

/** Los nombres para un `<datalist>`: de esos espacios (todos si no hay ninguno), sin repetir, en orden. */
export function organizationNames(
  items: readonly OrganizationOption[],
  workspaceIds: readonly string[] = [],
): string[] {
  const only = new Set(workspaceIds);
  const names = items.filter((o) => only.size === 0 || only.has(o.workspace_id)).map((o) => o.name);
  return [...new Set(names)].sort((a, b) => a.localeCompare(b));
}
