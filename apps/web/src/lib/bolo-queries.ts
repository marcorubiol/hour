/**
 * Las dos lecturas del selector función↔bolo (`_tasks.md § 36`). Las dos van
 * por la puerta de `read:money` y las dos callan: un fallo se trata como
 * «nada que ofrecer» (`retry: false`, y la pantalla esconde el campo), nunca
 * como un error a la vista, porque enmascarado y vacío no se distinguen.
 *
 * La clave empieza por `money-bolos` a propósito: quien ya invalida el feed de
 * Books (crear un trato, un pago) refresca también estas opciones.
 */

import { fetchJSON } from './api';
import type { BoloLite } from './bolo-pick';

export function projectBolosQueryOptions(projectId: string, enabled = true) {
  return {
    queryKey: ['money-bolos', 'project', projectId] as const,
    enabled: enabled && Boolean(projectId),
    retry: false,
    queryFn: ({ signal }: { signal: AbortSignal }) =>
      fetchJSON<{ items: BoloLite[] }>(
        `/api/money/bolos?project_ids=${encodeURIComponent(projectId)}&limit=500`,
        signal,
      ),
  };
}

/**
 * ¿Lee dinero en este proyecto? Solo para distinguir «sin bolos» de «no te
 * toca» cuando el feed viene vacío. Un fallo cuenta como «no».
 */
export function moneyAccessQueryOptions(projectId: string, enabled = true) {
  return {
    queryKey: ['money-access', projectId] as const,
    enabled: enabled && Boolean(projectId),
    retry: false,
    staleTime: 5 * 60_000,
    queryFn: ({ signal }: { signal: AbortSignal }) =>
      fetchJSON<{ read_money: boolean }>(
        `/api/money/access?project_id=${encodeURIComponent(projectId)}`,
        signal,
      ),
  };
}

export function performanceBoloQueryOptions(performanceId: string, enabled = true) {
  return {
    queryKey: ['money-bolos', 'performance', performanceId] as const,
    enabled: enabled && Boolean(performanceId),
    retry: false,
    queryFn: async ({ signal }: { signal: AbortSignal }) => {
      const body = await fetchJSON<{
        items: Array<{ performance_id: string; bolo_id: string | null }>;
      }>(`/api/money/performance-bolos?performance_ids=${encodeURIComponent(performanceId)}`, signal);
      // Sin fila: no lee dinero aquí. Con fila: el enlace, o null si no tiene.
      const row = body.items.find((r) => r.performance_id === performanceId);
      return row ? { readable: true as const, bolo_id: row.bolo_id } : { readable: false as const };
    },
  };
}
