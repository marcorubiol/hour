/**
 * Lo apartado de «Te espera», en la sesión (ADR-232): una lectura por
 * arranque de `GET /api/me/set-aside`, como lo visto de la ayuda. Apartar y
 * traer escriben en la sesión al momento y en la base después; si la
 * escritura falla, la fila vuelve a su sitio y la página lo dice.
 *
 * Sin la tabla (un origen sin `20261120030000`) la lectura falla en silencio,
 * no hay nada apartado y no se ofrece «ahora no»: la página es la de antes.
 *
 * La regla de qué se aparta y qué es antiguo es pura y está en `$lib/set-aside`.
 */
import { mutateJSON } from '$lib/api';
import type { SetAside } from '$lib/set-aside';

/** `ready`: the read answered, so the table is there and «ahora no» can be offered. */
export const setAside = $state<{ items: SetAside; ready: boolean }>({ items: {}, ready: false });

let probe: Promise<void> | null = null;

async function load(): Promise<void> {
  try {
    const res = await fetch('/api/me/set-aside');
    if (!res.ok) return;
    const body = (await res.json()) as { items?: SetAside };
    setAside.items = { ...(body.items ?? {}), ...setAside.items };
    setAside.ready = true;
  } catch {
    // Nada apartado: cada fila sigue en su sitio.
  }
}

/** Lee lo apartado como mucho una vez por arranque. */
export function ensureSetAside(): Promise<void> {
  probe ??= load();
  return probe;
}

/**
 * Aparta la fila `key` hasta `until`, o la trae con `until` nulo. Lanza si la
 * escritura falla, después de devolver la fila a como estaba.
 */
export async function putAside(key: string, until: string | null): Promise<void> {
  const before = setAside.items;
  const next = { ...before };
  if (until) next[key] = until;
  else delete next[key];
  setAside.items = next;
  try {
    await mutateJSON('POST', '/api/me/set-aside', { key, until });
  } catch (err) {
    setAside.items = before;
    throw err;
  }
}
