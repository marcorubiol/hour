/**
 * La vuelta a la lista de Conversaciones (ADR-176): la ficha de una
 * conversación y el grupo de un bolo vuelven a la lista como se dejó (el
 * chip, la vista, los filtros, el alcance), no a su portada. La lente apunta
 * aquí su dirección cada vez que cambia; sólo en el navegador (los efectos
 * no corren en el servidor), así que el estado del módulo no se comparte
 * entre peticiones.
 */

let last = $state<string | null>(null);

/** La lente: su dirección sin lo que tiene abierto al lado. */
export function rememberConversationsList(url: URL): void {
  const params = new URLSearchParams(url.search);
  params.delete('abierta');
  params.delete('grupo');
  const qs = params.toString();
  last = `${url.pathname}${qs ? `?${qs}` : ''}`;
}

/** Adónde vuelve una ficha: la lista como se dejó, o su portada. */
export function conversationsListHref(): string {
  return last ?? '/h/conversations';
}
