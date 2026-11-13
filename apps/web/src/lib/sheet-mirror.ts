/**
 * Ficha de sala y ficha de espectáculo son espejo (ADR-177 § 4): los mismos
 * bloques, girados. En la de la organización, una fila por proyecto con su
 * color y, debajo, sus bolos con importe; en la del proyecto, una fila por
 * sala con sus bolos. Y la línea de hechos con dinero del proyecto
 * («6 funciones confirmadas · vendido 9.600 € · siguiente: sáb 7 mar · Olot»).
 *
 * Sin red: `today` (día local, `YYYY-MM-DD`) se inyecta. El importe sólo
 * llega a quien lee dinero (`list_money_bolos`); sin él, la línea del bolo va
 * sin cifra y la de hechos sin «vendido», nunca con un cero que mienta.
 */

import { t, type Locale, type Voice } from './i18n';
import { dayMonthYearTs } from './datetime';
import { boloStatusLabel, fmtCurrency, isContracted, totalsByCurrency } from './money';

/** Lo que el espejo necesita de un bolo: el de `conversations_bolos` o el de Cuentas. */
export interface MirrorBolo {
  status: string;
  function_count: number;
  first_performed_at: string | null;
  last_performed_at: string | null;
  city: string | null;
  fee_amount?: number | null;
  fee_currency?: string | null;
}

const DEAD = new Set(['cancelled']);

/** El día de un `performed_at`, como lo lee el resto de fichas (`orgBolos`). */
function dayOf(ts: string): string {
  return ts.slice(0, 10);
}

export interface ProjectFacts {
  /** Funciones de los bolos firmes (confirmado, hecho, facturado, cobrado). */
  firmFunctions: number;
  /** Lo vendido, por moneda: la suma del caché de los bolos firmes que lo tienen. */
  sold: [string, number][];
  /** La próxima función de un bolo vivo, desde hoy. */
  next: { at: string; city: string | null } | null;
}

/** La línea de hechos con dinero de la ficha del proyecto. */
export function projectFacts(bolos: readonly MirrorBolo[], today: string): ProjectFacts {
  const live = bolos.filter((b) => !DEAD.has(b.status));
  const firm = live.filter((b) => isContracted(b.status));
  const firmFunctions = firm.reduce((n, b) => n + b.function_count, 0);
  const sold = totalsByCurrency(
    firm.filter((b) => typeof b.fee_amount === 'number'),
    (b) => b.fee_currency || 'EUR',
    (b) => b.fee_amount ?? 0,
  );
  const coming = live
    .filter((b) => b.first_performed_at && dayOf(b.first_performed_at) >= today)
    .sort((a, b) => a.first_performed_at!.localeCompare(b.first_performed_at!));
  const n = coming[0];
  return { firmFunctions, sold, next: n ? { at: n.first_performed_at!, city: n.city } : null };
}

export interface SalaGroup<B> {
  /** La conversación con la sala: la fila lleva a ella. Null, un bolo apuntado sin conversación. */
  conversationId: string | null;
  name: string | null;
  bolos: B[];
}

/**
 * Los bolos del proyecto, una fila por sala (su conversación, ADR-102), en el
 * orden de su bolo más cercano. Un bolo sin conversación va solo, con el
 * nombre de su sala. Los cancelados no cuentan.
 */
export function bolosBySala<B extends MirrorBolo & { conversation_id: string | null; venue_name: string | null }>(
  bolos: readonly B[],
  today: string,
): SalaGroup<B>[] {
  const groups = new Map<string, SalaGroup<B>>();
  for (const b of orderBolos(bolos, today)) {
    const key = b.conversation_id ?? `venue:${b.venue_name ?? ''}`;
    const g = groups.get(key);
    if (g) {
      g.bolos.push(b);
      g.name ??= b.venue_name;
    } else {
      groups.set(key, { conversationId: b.conversation_id, name: b.venue_name, bolos: [b] });
    }
  }
  return [...groups.values()];
}

/**
 * Los bolos en el orden en que importan: los que vienen, el más cercano
 * primero; después los pasados, el último primero; los que no tienen fecha,
 * al final. Un cancelado no se cuenta.
 */
export function orderBolos<B extends MirrorBolo>(bolos: readonly B[], today: string): B[] {
  const live = bolos.filter((b) => !DEAD.has(b.status));
  const day = (b: B) => {
    const ts = b.last_performed_at ?? b.first_performed_at;
    return ts ? dayOf(ts) : null;
  };
  const coming = live.filter((b) => day(b) !== null && day(b)! >= today);
  const past = live.filter((b) => day(b) !== null && day(b)! < today);
  const undated = live.filter((b) => day(b) === null);
  coming.sort((a, b) => (a.first_performed_at ?? '').localeCompare(b.first_performed_at ?? ''));
  past.sort((a, b) => day(b)!.localeCompare(day(a)!));
  return [...coming, ...past, ...undated];
}

/** Una línea de bolo bajo su fila: el día, dónde, cuántas funciones, el estado y el importe. */
export interface BoloLine {
  id: string;
  day: string;
  /** Su función (la primera): la línea lleva a ella. */
  href: string | null;
  where: string | null;
  functions: string | null;
  status: string;
  /** «2.400 €»; null si no hay caché o quien mira no lee dinero. */
  amount: string | null;
}

/**
 * La línea de un bolo, como la dibujan las dos fichas. `where` lo pone quien sabe qué eje falta;
 * `voice`, la ficha abierta en vista previa, que habla el oficio de su espacio (tarea 142).
 */
export function boloLine(
  b: MirrorBolo & { id: string },
  opts: { locale: Locale; href: string | null; where?: string | null; voice?: Voice },
): BoloLine {
  return {
    id: b.id,
    day: b.first_performed_at ? dayMonthYearTs(b.first_performed_at) : t('conversations.bolo_undated', opts.locale, undefined, opts.voice),
    href: opts.href,
    where: opts.where ?? null,
    functions: b.function_count > 1 ? t('perf.bolo_functions_other', opts.locale, { n: b.function_count }, opts.voice) : null,
    status: boloStatusLabel(b.status, opts.locale),
    amount: typeof b.fee_amount === 'number' ? fmtCurrency(b.fee_amount, b.fee_currency ?? null, opts.locale) : null,
  };
}
