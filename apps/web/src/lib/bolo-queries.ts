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
import type { MoneyBolo } from './money';
import type { ExpenseItem } from './expense';

/**
 * Los bolos del proyecto, la fila entera de Cuentas: el selector lee lo suyo
 * (`BoloLite`) y la ficha del proyecto, el caché (ADR-177 § 4).
 */
export function projectBolosQueryOptions(projectId: string, enabled = true) {
  return {
    queryKey: ['money-bolos', 'project', projectId] as const,
    enabled: enabled && Boolean(projectId),
    retry: false,
    queryFn: ({ signal }: { signal: AbortSignal }) =>
      fetchJSON<{ items: MoneyBolo[] }>(
        `/api/money/bolos?project_ids=${encodeURIComponent(projectId)}&limit=500`,
        signal,
      ),
  };
}

/** The ceiling of the scope's feed: past it the oldest rows drop (Cuentas says so). */
export const SCOPE_BOLOS_CAP = 500;

/**
 * Los bolos del ámbito, el feed de Cuentas: Hoy y el gasto desde el marco (163)
 * leen la misma URL con la misma clave, una respuesta.
 */
export function scopeBolosQueryOptions(k: { projectIds: string[]; workspaceIds: string[] }, enabled = true) {
  const params = new URLSearchParams({ limit: String(SCOPE_BOLOS_CAP) });
  if (k.projectIds.length > 0) params.set('project_ids', k.projectIds.join(','));
  if (k.workspaceIds.length > 0) params.set('workspace_ids', k.workspaceIds.join(','));
  return {
    queryKey: ['money-bolos', { p: k.projectIds, w: k.workspaceIds }] as const,
    enabled,
    queryFn: ({ signal }: { signal: AbortSignal }) =>
      fetchJSON<{ items: MoneyBolo[] }>(`/api/money/bolos?${params}`, signal),
  };
}

/** Los gastos del ámbito: Cuentas y el calentamiento del marco (`$lib/lens-warm`), una clave. */
export function scopeExpensesQueryOptions(k: { projectIds: string[]; workspaceIds: string[] }, enabled = true) {
  const params = new URLSearchParams();
  if (k.projectIds.length > 0) params.set('project_ids', k.projectIds.join(','));
  if (k.workspaceIds.length > 0) params.set('workspace_ids', k.workspaceIds.join(','));
  return {
    queryKey: ['expenses', { p: k.projectIds, w: k.workspaceIds }] as const,
    enabled,
    queryFn: ({ signal }: { signal: AbortSignal }) =>
      fetchJSON<{ items: ExpenseItem[] }>(`/api/expenses?${params}`, signal),
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

/**
 * ¿Lee dinero en ALGÚN proyecto? La puerta de la lente Cuentas (ADR-117): el
 * selector de lentes la esconde y la lente dice «no tienes acceso» en vez de
 * «no hay bolos». Solo un «no» explícito esconde: mientras no responde, o si
 * falla, la lente se pinta (quien la tiene no la ve parpadear ni desaparecer
 * por un fallo de red; los datos siguen gateados por las RPC).
 */
export function moneyAccessAnyQueryOptions() {
  return {
    queryKey: ['money-access', 'any'] as const,
    retry: false,
    staleTime: 5 * 60_000,
    queryFn: ({ signal }: { signal: AbortSignal }) =>
      fetchJSON<{ read_money: boolean }>('/api/money/access', signal),
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
