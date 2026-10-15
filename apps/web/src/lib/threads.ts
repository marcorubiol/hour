/**
 * Hilos internos (ADR-106): las formas que leen la pantalla y los endpoints, y
 * las palabras que la pantalla dice de ellas. Sin red ni Svelte: todo puro, y
 * por eso con sus tests.
 *
 * El tablón del bolo (fase 2) lee por `bolo_board` y los mensajes de sus hilos
 * de una vez; el hilo del equipo de una conversación (fase 3) lee su único
 * hilo por la RLS de `thread`. Los dos escriben por las RPC (`post_message`, `edit_message`,
 * `delete_message`, `mark_thread_read`). La línea de audiencia la da
 * `thread_audience`, y no se pliega nunca (ADR-083, enmienda §6). «De qué se
 * habla» (fase 4, ADR-116) lee por `thread_feed` los hilos con mensajes que
 * el que mira puede leer, y cada fila abre su ficha.
 */

import * as v from 'valibot';
import { hourMark, localeDayMonth, localeMonthShort, localeWeekdayShort, timeInTz } from './datetime';
import { LOCALE_TAG, t, type Locale } from './i18n';

/** El tope de la base (`message_body_length`): de 1 a 10.000 tras recortar. */
export const MESSAGE_MAX = 10_000;

/** Cuántos mensajes trae el tablón como mucho (los más recientes). */
export const BOARD_MESSAGE_LIMIT = 500;

/** Sin realtime (ADR-083 §2): una pantalla abierta recarga sus hilos cada tanto. La cifra es la del plan, sin medir. */
export const THREAD_REFRESH_MS = 30_000;

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

/**
 * Lo que devuelve `GET /api/conversations/:id/thread`: el hilo del equipo de
 * una conversación (sin faceta: lo lee quien lee la conversación, privacidad
 * incluida) con sus mensajes. `thread.thread_id` null: nadie ha escrito aún.
 */
export interface ConversationThreadView {
  me: string;
  thread: BoardThread;
  messages: ThreadMessage[];
  authors: Record<string, string>;
  reads: Record<string, string>;
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

/**
 * El orden del tablón: desplegados primero los que tienen nuevos, después los
 * que tienen mensajes, después los vacíos que quien mira abrió para escribir;
 * plegados, en una fila al final, los vacíos sin abrir. Dentro de cada grupo,
 * el orden de `bolo_board` (General primero, luego las facetas por su orden).
 *
 * «Tiene nuevos» lo decide quien llama (contra la lectura AL ABRIR la ficha):
 * así un hilo no baja de golpe en mitad de la lectura cuando se marca leído.
 */
export function boardLayout<T extends Pick<BoardThread, 'facet_id' | 'message_count'>>(
  threads: T[],
  hasNew: (thread: T) => boolean,
  opened: ReadonlySet<string> = new Set(),
): { open: T[]; folded: T[] } {
  const fresh: T[] = [];
  const talked: T[] = [];
  const unfolded: T[] = [];
  const folded: T[] = [];
  for (const th of threads) {
    if (th.message_count > 0 && hasNew(th)) fresh.push(th);
    else if (th.message_count > 0) talked.push(th);
    else if (opened.has(threadKey(th))) unfolded.push(th);
    else folded.push(th);
  }
  return { open: [...fresh, ...talked, ...unfolded], folded };
}

/**
 * El hilo del equipo de una conversación con la forma de un hilo del tablón:
 * General de su ancla, con recuento y no leídos contados como `bolo_board`
 * (lo ajeno posterior a la lectura). Los mensajes, los que se trajeron.
 */
export function conversationThread(
  thread: { id: string; last_message_at: string | null } | null,
  messages: ThreadMessage[],
  me: string,
  lastReadAt: string | null | undefined,
): BoardThread {
  return {
    thread_id: thread?.id ?? null,
    facet_id: null,
    facet_key: null,
    label: null,
    labels: {},
    message_count: messages.length,
    unread_count: messages.filter((m) => isUnread(m, me, lastReadAt)).length,
    last_message_at: thread?.last_message_at ?? null,
  };
}

/** Un paso de la vista «hilo» de una conversación: lo hablado con fuera o un mensaje del equipo. */
export type TimelineEntry<E> =
  | { kind: 'event'; at: string; event: E }
  | { kind: 'message'; at: string; message: ThreadMessage };

/**
 * La vista «hilo» (ADR-099 §5): el registro con fuera y el hilo del equipo en
 * una sola línea, del más antiguo al más nuevo. Presentación, no un modelo:
 * cada cosa sigue siendo lo que es. A la misma hora, lo de fuera primero (el
 * equipo suele comentar lo que llegó).
 */
export function teamTimeline<E extends { id: string; occurred_at: string }>(
  events: E[],
  messages: ThreadMessage[],
): TimelineEntry<E>[] {
  const out: TimelineEntry<E>[] = [
    ...events.map((event) => ({ kind: 'event' as const, at: event.occurred_at, event })),
    ...messages.map((message) => ({ kind: 'message' as const, at: message.created_at, message })),
  ];
  const id = (x: TimelineEntry<E>) => (x.kind === 'event' ? x.event.id : x.message.id);
  return out.sort(
    (a, b) =>
      Date.parse(a.at) - Date.parse(b.at) ||
      (a.kind === b.kind ? id(a).localeCompare(id(b)) : a.kind === 'event' ? -1 : 1),
  );
}

/** El nombre del bolo sin título propio (no lo tiene): sala y ciudad. */
export function boloPlace(bolo: Pick<BoardBolo, 'venue_name' | 'city'>): string {
  return [bolo.venue_name, bolo.city].filter(Boolean).join(' · ');
}

// ── «de qué se habla» (ADR-116) ─────────────────────────────────────────

/**
 * Un hilo de «de qué se habla», tal como lo da `thread_feed`: con mensajes,
 * legible por quien mira, y con lo justo para decir de qué va y abrir su
 * ficha. Un hilo de bolo nunca trae dinero.
 */
export interface FeedThread {
  thread_id: string;
  workspace_id: string;
  project_id: string;
  anchor_kind: AnchorKind;
  anchor_id: string;
  /** null = General (en un bolo) o el hilo del equipo (en una conversación). */
  facet_id: string | null;
  facet_key: string | null;
  label: string | null;
  labels: Record<string, string>;
  message_count: number;
  unread_count: number;
  last_message_at: string;
  last_message: { author_id: string | null; body: string; created_at: string };
  /** Sala, ciudad, días, y la función que abre el tablón (la próxima, o la última). */
  bolo: {
    venue_name: string | null;
    city: string | null;
    first_day: string | null;
    last_day: string | null;
    performance_slug: string | null;
    performance_id: string | null;
  } | null;
  conversation: { title: string | null } | null;
}

/** Lo que devuelve `GET /api/threads`. */
export interface ThreadFeedView {
  me: string;
  threads: FeedThread[];
  /** user_id → nombre, de los autores que quien mira puede ver. */
  authors: Record<string, string>;
}

/**
 * La ficha que abre una fila: la función con su tablón (`#board`), o la
 * conversación con su hilo del equipo (`#team`). Un bolo sin funciones vivas
 * no tiene dónde abrirse: null, y la fila no es enlace.
 */
export function feedHref(row: Pick<FeedThread, 'anchor_kind' | 'anchor_id' | 'bolo'>, workspaceSlug: string | undefined): string | null {
  if (!workspaceSlug) return null;
  if (row.anchor_kind === 'conversation') return `/h/${workspaceSlug}/conversation/${row.anchor_id}#team`;
  const slug = row.bolo?.performance_slug;
  return slug ? `/h/${workspaceSlug}/performance/${slug}#board` : null;
}

/** El nombre del hilo dentro de su ancla: la faceta (o General) en un bolo, «Equipo» en una conversación. */
export function feedThreadName(row: Pick<FeedThread, 'anchor_kind' | 'facet_key' | 'label' | 'labels'>, locale: Locale): string {
  return row.anchor_kind === 'conversation' ? t('threads.team', locale) : facetName(row, locale);
}

/** De qué se habla: la conversación por su nombre; el bolo por sala y ciudad (no tiene título propio). */
export function feedTitle(row: Pick<FeedThread, 'anchor_kind' | 'bolo' | 'conversation'>): string {
  if (row.anchor_kind === 'conversation') return row.conversation?.title ?? '';
  return row.bolo ? boloPlace(row.bolo) : '';
}

/** Los días de un bolo: «15 may», «15 → 16 may», «30 abr → 2 may». */
export function boloDays(first: string | null, last: string | null, locale: Locale): string {
  if (!first) return '';
  const tag = LOCALE_TAG[locale];
  if (!last || last === first) return localeDayMonth(first, tag);
  const from = first.slice(0, 7) === last.slice(0, 7) ? String(Number(first.slice(8, 10))) : localeDayMonth(first, tag);
  return `${from} → ${Number(last.slice(8, 10))} ${localeMonthShort(last, tag)}`;
}
