/**
 * «Lo conozco» (ADR-138 § 5): un miembro del equipo conoce a un contacto.
 *
 * La marca es personal y va por el dossier (`person_acquaintance`), no por la
 * conversación. Nace privada y se comparte una a una; lo que llega aquí ya lo
 * filtró la RLS: las propias y las compartidas de dossiers que quien llama lee.
 * Este módulo solo responde, para una persona o para una fila de varias, si la
 * conoces tú y quién más del equipo lo ha dicho.
 */

import { fetchJSON } from '$lib/api';
import { LOCALE_TAG, t, type Locale } from '$lib/i18n';

export interface Acquaintance {
  workspace_id: string;
  person_id: string;
  user_id: string;
  shared: boolean;
}

/** GET /api/acquaintances: las marcas que quien llama lee, y el nombre de sus dueños. */
export interface AcquaintanceView {
  me: string;
  items: Acquaintance[];
  names: Record<string, string>;
}

/** Lo que una ficha o una fila dicen: si la conoces tú, si lo compartes, y quién más. */
export interface Known {
  mine: boolean;
  shared: boolean;
  /** Los nombres de pila de los demás que lo comparten, en orden alfabético. */
  others: string[];
}

export const NOT_KNOWN: Known = { mine: false, shared: false, others: [] };

/** El nombre de pila: «La conoce Marco», no «Marco Rubiol». */
export function firstName(fullName: string): string {
  return fullName.trim().split(/\s+/)[0] ?? '';
}

/**
 * Para los contactos de una fila (o uno solo, en la ficha de persona): la
 * conoces si conoces a alguno; `shared` si compartes alguna de esas marcas;
 * `others`, sin repetir, quien más ha compartido conocer a alguno. Un dueño
 * sin nombre legible (ya no comparte espacio con quien llama) no se nombra.
 */
export function knownAmong(
  view: AcquaintanceView | null | undefined,
  workspaceId: string,
  personIds: readonly string[],
): Known {
  if (!view || personIds.length === 0) return NOT_KNOWN;
  const wanted = new Set(personIds);
  let mine = false;
  let shared = false;
  const others = new Set<string>();
  for (const a of view.items) {
    if (a.workspace_id !== workspaceId || !wanted.has(a.person_id)) continue;
    if (a.user_id === view.me) {
      mine = true;
      shared ||= a.shared;
    } else if (a.shared) {
      const name = view.names[a.user_id];
      if (name) others.add(firstName(name));
    }
  }
  if (!mine && others.size === 0) return NOT_KNOWN;
  return { mine, shared, others: [...others].sort((a, b) => a.localeCompare(b)) };
}

/** «Marco», «Marco y Anouk», «Anouk, Marco y Pau»: la lista del idioma. */
export function namesList(names: readonly string[], locale: Locale): string {
  return new Intl.ListFormat(LOCALE_TAG[locale], { type: 'conjunction' }).format(names);
}

/** «La conoce Marco», «La conocen Marco y Anouk»; nada si nadie más lo comparte. */
export function knownByLabel(others: readonly string[], locale: Locale): string | null {
  if (others.length === 0) return null;
  const key = others.length === 1 ? 'acquaintance.known_by_one' : 'acquaintance.known_by_many';
  return t(key, locale, { names: namesList(others, locale) });
}

/** El tooltip de la marca de una fila: «La conoces», «La conoce Anouk», o las dos. */
export function knownTitle(known: Known, locale: Locale): string | null {
  const parts = [known.mine ? t('acquaintance.mine_row', locale) : null, knownByLabel(known.others, locale)];
  const said = parts.filter((p): p is string => Boolean(p));
  return said.length > 0 ? said.join('. ') : null;
}

/** Una sola caché para la lista, la ficha de persona y la de conversación. */
export const ACQUAINTANCES_KEY = ['acquaintances'] as const;

export function acquaintancesQueryOptions() {
  return {
    queryKey: ACQUAINTANCES_KEY,
    queryFn: ({ signal }: { signal: AbortSignal }) => fetchJSON<AcquaintanceView>('/api/acquaintances', signal),
  };
}
