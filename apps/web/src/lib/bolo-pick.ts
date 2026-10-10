/**
 * Colgar una función de su bolo (ADR-087 · `_tasks.md § 36`).
 *
 * El bolo es el trato con UNA sala, y lleva 1..N funciones. Marco decidió el
 * 2026-08-28 que el gesto primario del alta es colgar de un bolo que ya
 * existe (el trato se cierra hablando, antes de llegar al calendario), así que
 * el selector ofrece los bolos del proyecto y no crea ninguno: crear un trato
 * es de Books, con su caché y su estado.
 *
 * LA PUERTA ES `read:money`, y no se dice. Las opciones salen de
 * `list_money_bolos`, que solo devuelve filas a quien lee dinero en ese
 * proyecto. Sin filas no hay selector: quien no lee dinero y un proyecto sin
 * tratos se ven igual, que es la regla de la casa para el dinero (enmascarado
 * y vacío son indistinguibles a propósito, como el resumen de Desk). Así nadie
 * enlaza desde la pantalla un bolo que después no ve, aunque la API se lo
 * permita (escribir el enlace es `edit:performance`).
 *
 * Funciones puras: la pantalla las monta, aquí no hay red ni estado.
 */

import { t, type Locale } from '$lib/i18n';

/** Lo que el selector necesita de una fila de `GET /api/money/bolos`. */
export type BoloLite = {
  id: string;
  venue_name: string | null;
  city: string | null;
  status: string;
  function_count: number;
};

/** Un trato muerto no recibe funciones nuevas; si ya era el suyo, se queda. */
const CLOSED = new Set(['cancelled']);

/** «Teatre Lliure · Barcelona · 2 funciones». La sala va primero: es el bolo. */
export function boloLabel(bolo: BoloLite, locale: Locale): string {
  const place = [bolo.venue_name, bolo.city].filter(Boolean).join(' · ');
  const count =
    bolo.function_count === 1
      ? t('perf.bolo_functions_one', locale)
      : t('perf.bolo_functions_other', locale, { n: bolo.function_count });
  return `${place || t('perf.bolo_unnamed', locale)} · ${count}`;
}

/**
 * Las opciones del selector, «sin bolo» siempre la primera. El orden es el de
 * la RPC (próxima función primero), que ya es el de Books. Un bolo cancelado
 * sale, salvo que sea el enlace actual: esconderlo dejaría el desplegable
 * diciendo «sin bolo» sobre una función que sí tiene uno.
 */
export function boloOptions(
  bolos: readonly BoloLite[],
  locale: Locale,
  currentId: string | null = null,
): Array<{ value: string; label: string }> {
  return [
    { value: '', label: t('perf.bolo_none', locale) },
    ...bolos
      .filter((b) => !CLOSED.has(b.status) || b.id === currentId)
      .map((b) => ({ value: b.id, label: boloLabel(b, locale) })),
  ];
}

/**
 * Sala y ciudad que el bolo aporta al alta: solo las que el formulario tiene
 * vacías. Lo escrito a mano manda; elegir un bolo no pisa nada.
 */
export function boloPrefill(
  bolo: Pick<BoloLite, 'venue_name' | 'city'> | null | undefined,
  current: { venue: string; city: string },
): { venue: string; city: string } {
  if (!bolo) return current;
  return {
    venue: current.venue.trim() ? current.venue : (bolo.venue_name ?? current.venue),
    city: current.city.trim() ? current.city : (bolo.city ?? current.city),
  };
}

/**
 * Lo que la ficha de una función dice de su trato, en la línea de contexto
 * (función · proyecto · línea · bolo): «bolo de 2 funciones», o «sin bolo».
 * Solo se dibuja para quien lee dinero; para los demás la ficha calla.
 */
export function boloOf(bolo: Pick<BoloLite, 'function_count'> | null, locale: Locale): string {
  if (!bolo) return t('perf.bolo_of_none', locale);
  return bolo.function_count === 1
    ? t('perf.bolo_of_one', locale)
    : t('perf.bolo_of_other', locale, { n: bolo.function_count });
}

/**
 * Lo que el PATCH de la ficha lleva sobre el bolo: nada si no cambió. Mandar
 * siempre el valor del selector reescribiría el enlace con cada guardado, y si
 * el enlace no se pudo leer, lo borraría.
 */
export function boloPatch(
  original: string | null,
  picked: string,
): { bolo_id?: string | null } {
  const next = picked || null;
  return next === original ? {} : { bolo_id: next };
}
