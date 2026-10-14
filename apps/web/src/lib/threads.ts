/**
 * Hilos internos (ADR-106): las formas que leen la pantalla y los endpoints, y
 * las palabras que la pantalla dice de ellas. Sin red ni Svelte: todo puro, y
 * por eso con sus tests.
 *
 * El tablón del bolo (fase 2) lee por `bolo_board` y los mensajes de sus hilos
 * de una vez; escribe por las RPC (`post_message`, `edit_message`,
 * `delete_message`, `mark_thread_read`). La línea de audiencia la da
 * `thread_audience`, y no se pliega nunca (ADR-083, enmienda §6).
 */

import * as v from 'valibot';
import { hourMark, localeDayMonth, localeWeekdayShort, timeInTz } from './datetime';
import { LOCALE_TAG, t, type Locale } from './i18n';

/** El tope de la base (`message_body_length`): de 1 a 10.000 tras recortar. */
export const MESSAGE_MAX = 10_000;

/** Cuántos mensajes trae el tablón como mucho (los más recientes). */
export const BOARD_MESSAGE_LIMIT = 500;

export type AnchorKind = 'bolo' | 'conversation';

export interface BoardBolo {
  id: string;
  project_id: string;
  line_id: string | null;
  venue_name: string | null;
  city: string | null;
  country: string | null;
}

/** Una función del bolo: día, hora y sala, nunca dinero. */
export interface BoardPerformance {
  id: string;
  slug: string | null;
  performed_at: string;
  start_at: string | null;
  venue_name: string | null;
  city: string | null;
}

/** Un hilo que el que mira puede leer, exista ya o no (`thread_id` null: nadie ha escrito). */
export interface BoardThread {
  thread_id: string | null;
  /** null = General: estar en el contenedor, no una faceta. */
  facet_id: string | null;
  facet_key: string | null;
  label: string | null;
  labels: Record<string, string>;
  message_count: number;
  unread_count: number;
  last_message_at: string | null;
}

export interface ThreadMessage {
  id: string;
  thread_id: string;
  author_id: string | null;
  performance_id: string | null;
  body: string;
  created_at: string;
  edited_at: string | null;
}

/** Lo que devuelve `bolo_board`. */
export interface BoloBoard {
  bolo: BoardBolo | null;
  performances: BoardPerformance[];
  threads: BoardThread[];
}

/** Lo que devuelve `GET /api/boards/:performanceId`: el tablón con sus mensajes. */
export interface BoardView extends BoloBoard {
  /** El que mira (sus mensajes se editan y no cuentan como nuevos). */
  me: string;
  messages: ThreadMessage[];
  /** user_id → nombre, de los autores que el que mira puede ver. */
  authors: Record<string, string>;
  /** thread_id → hasta dónde había leído el que mira. */
  reads: Record<string, string>;
  /** Hay más mensajes de los que se trajeron (`BOARD_MESSAGE_LIMIT`). */
  truncated: boolean;
}

export type AudienceReason =
  | { kind: 'container'; level: string }
  | { kind: 'facet'; facet_key: string; label: string | null; labels: Record<string, string> }
  | { kind: 'conversation' };

export interface ThreadAudience {
  count: number;
  reason: AudienceReason;
  people: { user_id: string; name: string | null }[];
}

// ── esquemas de escritura ───────────────────────────────────────────────

const Uuid = v.pipe(v.string(), v.uuid());
const Body = v.pipe(v.string(), v.trim(), v.minLength(1), v.maxLength(MESSAGE_MAX));

export const MessageCreateSchema = v.object({
  anchor_kind: v.picklist(['bolo', 'conversation']),
  anchor_id: Uuid,
  facet_id: v.optional(v.nullable(Uuid)),
  performance_id: v.optional(v.nullable(Uuid)),
  body: Body,
});
export type MessageCreate = v.InferOutput<typeof MessageCreateSchema>;

export const MessageEditSchema = v.object({ body: Body });

export const AudienceQuerySchema = v.object({
  anchor_kind: v.picklist(['bolo', 'conversation']),
  anchor_id: Uuid,
  facet_id: v.optional(v.pipe(v.string(), v.transform((s) => s || null), v.nullable(Uuid))),
});

// ── palabras ────────────────────────────────────────────────────────────

/**
 * El nombre de una faceta: el que le dio el espacio en su idioma, el que le dio
 * sin idioma, y si es estándar y nadie la renombró, su clave i18n.
 */
export function facetName(
  facet: { facet_key: string | null; label: string | null; labels?: Record<string, string> | null },
  locale: Locale,
): string {
  if (facet.facet_key === null) return t('threads.general', locale);
  return facet.labels?.[locale] || facet.label || t(`facet.${facet.facet_key}`, locale);
}

/** «Lo ven 5, por estar en el bolo» · «… por permiso de Técnica» · «… quien ve esta conversación». */
export function audienceLine(audience: Pick<ThreadAudience, 'count' | 'reason'>, locale: Locale): string {
  const r = audience.reason;
  const why =
    r.kind === 'facet'
      ? t('threads.why_facet', locale, { facet: facetName(r, locale) })
      : r.kind === 'conversation'
        ? t('threads.why_conversation', locale)
        : r.level === 'bolo'
          ? t('threads.why_bolo', locale)
          : t('threads.why_container', locale);
  return audience.count === 1
    ? t('threads.seen_by_one', locale, { why })
    : t('threads.seen_by', locale, { n: audience.count, why });
}

/**
 * La etiqueta de una función dentro de su bolo: «sáb 15 · 11h». Sin hora de
 * inicio, solo el día. La hora en la zona de la sala, el reloj del Planner.
 */
export function performanceTag(p: Pick<BoardPerformance, 'performed_at' | 'start_at'>, locale: Locale, tz: string): string {
  const tag = LOCALE_TAG[locale];
  const day = `${localeWeekdayShort(p.performed_at, tag)} ${Number(p.performed_at.slice(8, 10))}`;
  return p.start_at ? `${day} · ${hourMark(timeInTz(p.start_at, tz))}` : day;
}

/**
 * Cuándo se escribió un mensaje, en la zona de quien mira: hoy, solo la hora;
 * otro día, «15 mar · 11h32».
 */
export function messageWhen(iso: string, locale: Locale, tz: string, now: Date = new Date()): string {
  const day = dayInZone(iso, tz);
  const time = hourMark(timeInTz(iso, tz));
  return day === dayInZone(now.toISOString(), tz) ? time : `${localeDayMonth(day, LOCALE_TAG[locale])} · ${time}`;
}

function dayInZone(iso: string, tz: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(
    new Date(iso),
  );
}

// ── forma ───────────────────────────────────────────────────────────────

/** La clave estable de un hilo en pantalla, exista ya o no: su faceta (General = ''). */
export function threadKey(thread: Pick<BoardThread, 'facet_id'>): string {
  return thread.facet_id ?? '';
}

/** Los mensajes de cada hilo, del más antiguo al más nuevo (se lee de arriba abajo, como una conversación). */
export function messagesByThread(messages: ThreadMessage[]): Map<string, ThreadMessage[]> {
  const out = new Map<string, ThreadMessage[]>();
  for (const m of messages) {
    const list = out.get(m.thread_id);
    if (list) list.push(m);
    else out.set(m.thread_id, [m]);
  }
  for (const list of out.values()) {
    list.sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at) || a.id.localeCompare(b.id));
  }
  return out;
}

/**
 * Nuevo para quien mira: no lo escribió él y llegó después de lo último que
 * leyó. Sin lectura registrada, todo lo ajeno es nuevo. Es la misma regla que
 * cuenta `unread_count` en `bolo_board`.
 */
export function isUnread(m: Pick<ThreadMessage, 'author_id' | 'created_at'>, me: string, lastReadAt: string | null | undefined): boolean {
  if (m.author_id === me) return false;
  return !lastReadAt || Date.parse(m.created_at) > Date.parse(lastReadAt);
}

/** El primer mensaje nuevo de un hilo, donde la pantalla pinta la raya de «nuevos». */
export function firstUnreadId(messages: ThreadMessage[], me: string, lastReadAt: string | null | undefined): string | null {
  return messages.find((m) => isUnread(m, me, lastReadAt))?.id ?? null;
}

/**
 * Las opciones del selector «de qué función habla». Solo con más de una
 * función tiene sentido preguntar: con una, el bolo y la función son lo mismo.
 */
export function performanceOptions(
  performances: BoardPerformance[],
  locale: Locale,
  tz: string,
): { value: string; label: string }[] {
  if (performances.length < 2) return [];
  return [
    { value: '', label: t('threads.about_bolo', locale) },
    ...performances.map((p) => ({ value: p.id, label: performanceTag(p, locale, tz) })),
  ];
}

/** El nombre del bolo sin título propio (no lo tiene): sala y ciudad. */
export function boloPlace(bolo: Pick<BoardBolo, 'venue_name' | 'city'>): string {
  return [bolo.venue_name, bolo.city].filter(Boolean).join(' · ');
}
