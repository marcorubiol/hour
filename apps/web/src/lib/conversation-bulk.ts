/**
 * Acciones en bloque sobre la selección de la lista de Conversaciones (plan
 * `build/plans/2026-10-22-conversations-list.md` § 6.2, fase 2).
 *
 * `POST /api/conversations/bulk` hace por dentro lo que haría la fila, con el
 * JWT de quien llama: la RLS decide cada conversación, y lo que no se puede
 * tocar vuelve como fallo de esa fila, sin abortar el lote. Cada respuesta
 * trae con qué deshacerlo (`undo`: el valor de antes de las que cambió).
 *
 * Un lote viaja en trozos de `BULK_MAX`: una petición del Worker no pasa de 50
 * subpeticiones en el plan Free (suposición sobre el plan de la cuenta, no
 * comprobada), y etiquetar es una RPC por conversación. La pantalla parte la
 * selección y junta las respuestas (`runBulk`).
 *
 * Aquí: el contrato (esquema y tipos), el troceo y las palabras. Sin red.
 */

import * as v from 'valibot';
import { realIsoDate, realIsoInstant } from './datetime';
import { t, type Locale } from './i18n';
import { TAG_KEY_RE } from './conversation-tags';

/** Conversaciones por petición: 1 lectura + 2 del vocabulario + una escritura por fila + reintento. */
export const BULK_MAX = 20;
/** Peticiones de un lote a la vez. */
export const BULK_PARALLEL = 4;
/** Lo más que marca «Seleccionar las N que coinciden» (el tope de la lectura derivada, ADR-118). */
export const MATCHING_MAX = 1000;

const Id = v.pipe(v.string(), v.uuid());
const Ids = v.pipe(v.array(Id), v.minLength(1), v.maxLength(BULK_MAX));
const Instant = v.nullable(realIsoInstant);

/** Lo de antes de una conversación: sus columnas y, al etiquetar, sus etiquetas activas. */
export const RestoreItemSchema = v.object({
  id: Id,
  columns: v.optional(
    v.object({
      not_now_at: v.optional(Instant),
      not_now_until: v.optional(Instant),
      next_action_at: v.optional(Instant),
      next_action_note: v.optional(v.nullable(v.pipe(v.string(), v.maxLength(500)))),
      reply_settled_at: v.optional(Instant),
    }),
  ),
  // Vacío vale aquí: deshacer deja sin etiqueta a la que no tenía ninguna.
  tag_ids: v.optional(v.pipe(v.array(Id), v.maxLength(32))),
});
export type RestoreItem = v.InferOutput<typeof RestoreItemSchema>;

export const BulkSchema = v.variant('action', [
  // «No esta vez», con el día de volver a escribir si lo hay.
  v.object({ action: v.literal('not_now'), ids: Ids, until: v.optional(v.nullable(realIsoDate)) }),
  // La misma fecha y nota a todas; las dos vacías lo quitan.
  v.object({
    action: v.literal('next_step'),
    ids: Ids,
    next_action_at: v.nullable(realIsoDate),
    next_action_note: v.nullable(v.pipe(v.string(), v.trim(), v.maxLength(500))),
  }),
  // «No pide respuesta»: la última respuesta de cada una, atendida.
  v.object({ action: v.literal('settle'), ids: Ids }),
  // Poner o quitar una etiqueta sin tocar las demás.
  v.object({
    action: v.literal('tag'),
    ids: Ids,
    key: v.pipe(v.string(), v.regex(TAG_KEY_RE)),
    op: v.picklist(['add', 'remove']),
  }),
  // Deshacer: lo de antes, tal como lo devolvió la acción.
  v.object({ action: v.literal('restore'), items: v.pipe(v.array(RestoreItemSchema), v.minLength(1), v.maxLength(BULK_MAX)) }),
]);
export type BulkRequest = v.InferOutput<typeof BulkSchema>;
export type BulkAction = BulkRequest['action'];

/**
 * Por qué una conversación se quedó como estaba:
 * - `not_found`: no la lees (o ya no existe);
 * - `forbidden`: la lees y no la editas (o es privada de otra persona);
 * - `not_due`: «no pide respuesta» sin una respuesta suya esperando;
 * - `last_tag`: quitarle la única etiqueta;
 * - `tag_unavailable`: la etiqueta no está activa en su espacio;
 * - `error`: otra cosa (la red, la base).
 */
export type BulkReason = 'not_found' | 'forbidden' | 'not_due' | 'last_tag' | 'tag_unavailable' | 'error';
export const BULK_REASONS: readonly BulkReason[] = ['not_found', 'forbidden', 'not_due', 'last_tag', 'tag_unavailable', 'error'];

export interface BulkResult {
  done: string[];
  failed: { id: string; reason: BulkReason }[];
  /** Lo de antes de las que cambiaron: el cuerpo de `restore`. */
  undo: RestoreItem[];
}

/** Lo que una acción pide además de los ids. */
export type BulkArgs =
  | { action: 'not_now'; until?: string | null }
  | { action: 'next_step'; next_action_at: string | null; next_action_note: string | null }
  | { action: 'settle' }
  | { action: 'tag'; key: string; op: 'add' | 'remove' };

/** Trozos de `size`, en orden. */
export function chunk<T>(list: readonly T[], size = BULK_MAX): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

/** Junta las respuestas de los trozos en una. */
export function mergeResults(parts: readonly BulkResult[]): BulkResult {
  return {
    done: parts.flatMap((p) => p.done),
    failed: parts.flatMap((p) => p.failed),
    undo: parts.flatMap((p) => p.undo),
  };
}

/** Los cuerpos de un lote: una acción partida en trozos, o el deshacer de otra. */
export function bulkBodies(args: BulkArgs, ids: readonly string[]): BulkRequest[] {
  return chunk([...new Set(ids)]).map((part) => ({ ...args, ids: part }) as BulkRequest);
}
export function restoreBodies(undo: readonly RestoreItem[]): BulkRequest[] {
  return chunk(undo).map((items) => ({ action: 'restore', items }));
}

/**
 * Corre los cuerpos `BULK_PARALLEL` a la vez y junta lo que vuelve. Un trozo
 * que falla entero (la red, un 500) cuenta sus conversaciones como `error`:
 * el resto del lote sigue.
 */
export async function runBulk(
  bodies: readonly BulkRequest[],
  post: (body: BulkRequest) => Promise<BulkResult>,
): Promise<BulkResult> {
  const parts: BulkResult[] = new Array(bodies.length);
  let next = 0;
  async function worker() {
    while (next < bodies.length) {
      const i = next++;
      const body = bodies[i];
      try {
        parts[i] = await post(body);
      } catch {
        const ids = body.action === 'restore' ? body.items.map((x) => x.id) : body.ids;
        parts[i] = { done: [], failed: ids.map((id) => ({ id, reason: 'error' as const })), undo: [] };
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(BULK_PARALLEL, bodies.length) }, worker));
  return mergeResults(parts);
}

// ── Palabras ───────────────────────────────────────────────────────────────

const DONE_WORD: Record<Exclude<BulkAction, 'restore'>, string> = {
  not_now: 'bulk.done_not_now',
  next_step: 'bulk.done_next_step',
  settle: 'bulk.done_settle',
  tag: 'bulk.done_tag',
};

/** El título del aviso: «23 en no esta vez», «23 etiquetadas»… */
export function bulkDoneTitle(action: Exclude<BulkAction, 'restore'>, n: number, locale: Locale): string {
  return t(`${DONE_WORD[action]}_${n === 1 ? 'one' : 'other'}`, locale, { n });
}

/** El mensaje del aviso: cuántas no se pudieron, y por qué, o null si todas. */
export function bulkFailedLine(result: Pick<BulkResult, 'failed'>, locale: Locale): string | null {
  if (result.failed.length === 0) return null;
  const counts = new Map<BulkReason, number>();
  for (const f of result.failed) counts.set(f.reason, (counts.get(f.reason) ?? 0) + 1);
  const why = BULK_REASONS.filter((r) => counts.has(r))
    .map((r) => t(`bulk.reason_${r}`, locale, { n: counts.get(r)! }))
    .join(' · ');
  return t(result.failed.length === 1 ? 'bulk.failed_one' : 'bulk.failed_other', locale, { n: result.failed.length, why });
}
