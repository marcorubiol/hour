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
/** Keys written in this session: the first read must not bring back their old value. */
const touched = new Set<string>();

async function load(): Promise<void> {
  try {
    const res = await fetch('/api/me/set-aside');
    if (!res.ok) return;
    const body = (await res.json()) as { items?: SetAside };
    const read = Object.fromEntries(Object.entries(body.items ?? {}).filter(([k]) => !touched.has(k)));
    setAside.items = { ...read, ...setAside.items };
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

/** Semilla desde `/api/bootstrap`: evita una segunda lectura `/api/me/set-aside` en el arranque. */
export function seedSetAside(items: SetAside): void {
  const read = Object.fromEntries(Object.entries(items ?? {}).filter(([k]) => !touched.has(k)));
  setAside.items = { ...read, ...setAside.items };
  setAside.ready = true;
  probe = Promise.resolve();
}

/**
 * Aparta la fila `key` hasta `until`, o la trae con `until` nulo. Lanza si la
 * escritura falla, después de devolver la fila a como estaba.
 */
export async function putAside(key: string, until: string | null): Promise<void> {
  touched.add(key);
  const had = setAside.items[key];
  write(key, until);
  try {
    await mutateJSON('POST', '/api/me/set-aside', { key, until });
  } catch (err) {
    // Only this key goes back: another write may have landed meanwhile.
    if ((setAside.items[key] ?? null) === until) write(key, had ?? null);
    throw err;
  }
}

function write(key: string, until: string | null): void {
  const next = { ...setAside.items };
  if (until) next[key] = until;
  else delete next[key];
  setAside.items = next;
}
