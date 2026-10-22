/**
 * El orden de la lista de Conversaciones (plan `build/plans/2026-10-22-
 * conversations-list.md` § 4): una regla para toda la lente, y un menú de
 * cuatro en la URL (`?orden=`).
 *
 *   · `pide` (por defecto): no leídos; después te toca (las respuestas, la más
 *     reciente arriba, ADR-126 § 1; después los seguimientos, el más vencido
 *     primero), el mismo orden que el bloque «Te toca»; después lo último.
 *   · `movimiento`: lo último que se movió primero.
 *   · `paso`: por próximo paso, el más cercano primero (el orden de antes en
 *     Difusión, para quien trabaja por agenda).
 *   · `nombre`: por la sala.
 *
 * Los filtros de bloque (te toca, caliente, se enfría) no pasan por aquí:
 * ordenan en el orden de su bloque (ADR-118 § 7).
 *
 * Sin red, sin reloj y sin textos: cada fila llega ya con su clave.
 */

export const ORDERS = ['pide', 'movimiento', 'paso', 'nombre'] as const;
export type Orden = (typeof ORDERS)[number];
export const DEFAULT_ORDER: Orden = 'pide';

export function isOrden(value: unknown): value is Orden {
  return typeof value === 'string' && (ORDERS as readonly string[]).includes(value);
}

/** `?orden=` de la URL; sin él, o con uno que no existe, el de por defecto. */
export function parseOrden(raw: string | null | undefined): Orden {
  return isOrden(raw) ? raw : DEFAULT_ORDER;
}

/** Lo que el orden lee de una fila. */
export interface OrderKey {
  id: string;
  /** No leídos (registro y su hilo del equipo). */
  unread: number;
  /** Por qué te toca (`dueReason`), o null. */
  due: 'reply' | 'follow_up' | null;
  /** La respuesta pendiente (su `occurred_at`) o el seguimiento (`next_action_at`). */
  dueAt: string | null;
  /** Lo último que se movió; sin nada, su alta. */
  lastAt: string | null;
  title: string;
  nextActionAt: string | null;
}

function time(iso: string | null): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isNaN(t) ? null : t;
}

/** Más reciente primero; lo que no tiene fecha, al final. */
function desc(a: string | null, b: string | null): number {
  const ta = time(a);
  const tb = time(b);
  if (ta === tb) return 0;
  if (ta === null) return 1;
  if (tb === null) return -1;
  return tb - ta;
}

/** Lo más cercano primero; lo que no tiene fecha, al final. */
function asc(a: string | null, b: string | null): number {
  const ta = time(a);
  const tb = time(b);
  if (ta === tb) return 0;
  if (ta === null) return 1;
  if (tb === null) return -1;
  return ta - tb;
}

const names = new Intl.Collator(undefined, { sensitivity: 'base', numeric: true });

/** «Lo que pide»: no leídos, te toca (respuestas y después seguimientos), lo último. */
export function comparePide(a: OrderKey, b: OrderKey): number {
  const unread = Number(b.unread > 0) - Number(a.unread > 0);
  if (unread) return unread;
  const due = Number(b.due !== null) - Number(a.due !== null);
  if (due) return due;
  if (a.due && b.due) {
    if (a.due !== b.due) return a.due === 'reply' ? -1 : 1;
    const at = a.due === 'reply' ? desc(a.dueAt, b.dueAt) : asc(a.dueAt, b.dueAt);
    if (at) return at;
  }
  return desc(a.lastAt, b.lastAt) || a.id.localeCompare(b.id);
}

export function compareOrder(orden: Orden): (a: OrderKey, b: OrderKey) => number {
  switch (orden) {
    case 'movimiento':
      return (a, b) => desc(a.lastAt, b.lastAt) || a.id.localeCompare(b.id);
    case 'paso':
      return (a, b) => asc(a.nextActionAt, b.nextActionAt) || desc(a.lastAt, b.lastAt) || a.id.localeCompare(b.id);
    case 'nombre':
      return (a, b) => names.compare(a.title, b.title) || a.id.localeCompare(b.id);
    default:
      return comparePide;
  }
}

/** Las filas en el orden pedido, sin tocar la entrada. */
export function sortByOrder<K extends OrderKey>(rows: readonly K[], orden: Orden): K[] {
  return [...rows].sort(compareOrder(orden));
}
