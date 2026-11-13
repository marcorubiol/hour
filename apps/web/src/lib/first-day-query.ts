/**
 * La lectura de la lista de arranque (tarea 137): qué tiene ya un espacio.
 * Una clave por espacio, compartida por Hoy y los vacíos de Conversaciones y
 * el Planificador. Fuera de la caché del dispositivo (`persist: false`): es
 * cosa del primer día, y una respuesta vieja pintaría un paso por hacer que
 * ya está hecho. Se lee de nuevo al volver a Hoy y al cerrar un alta.
 */

import { fetchJSON } from './api';
import type { StartResponse } from './first-day';

export const START_QUERY_KEY = 'workspace-start';

export function startQueryOptions(workspaceId: string | null | undefined, enabled = true) {
  return {
    queryKey: [START_QUERY_KEY, workspaceId ?? ''] as const,
    enabled: enabled && Boolean(workspaceId),
    staleTime: 0,
    meta: { persist: false },
    queryFn: ({ signal }: { signal: AbortSignal }) =>
      fetchJSON<StartResponse>(`/api/workspaces/${workspaceId}/start`, signal),
  };
}
