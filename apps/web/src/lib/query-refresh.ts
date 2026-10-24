/**
 * DESPUÉS DE UNA ESCRITURA SE VUELVE A LEER TODO, TAMBIÉN LO QUE YA ESTABA EN CAMINO.
 *
 * `invalidateQueries` sola no basta. TanStack reinicia una lectura en vuelo
 * solo si la consulta ya tiene datos; una consulta en su PRIMERA lectura (una
 * búsqueda recién tecleada, un filtro recién elegido) conserva esa lectura y
 * la invalidación se suma a su promesa en vez de lanzar otra. Si esa GET salió
 * antes de que la escritura se confirmara, vuelve con la fila de antes, entra
 * como fresca y nadie la vuelve a pedir: el pintado optimista se pierde y se
 * queda el valor viejo.
 *
 * Visto en Conversaciones (2026-10-24, la causa de los rojos intermitentes de
 * `conversation-write.spec.ts`): búsqueda tecleada, «no esta vez» guardado
 * 160 ms después, la primera GET de la búsqueda salió tras el PATCH y antes de
 * su commit, y la fila volvió a «Contactada» hasta el siguiente foco. El
 * historial de una conversación ya lo había sufrido (ConversationHistory).
 *
 * Cancelar primero hace que la invalidación lance cada lectura activa después
 * de la escritura. Una lectura cancelada sigue mostrando lo que mostraba
 * (placeholder o datos anteriores) hasta que llega la respuesta nueva.
 */

import type { QueryClient, QueryKey } from '@tanstack/svelte-query';

export async function refreshAfterWrite(queryClient: QueryClient, queryKey: QueryKey): Promise<void> {
  await queryClient.cancelQueries({ queryKey });
  await queryClient.invalidateQueries({ queryKey });
}
