/**
 * La lectura común de Conversaciones (ADR-138, fase 3 de etiquetas; plan
 * `build/plans/2026-10-19-conversations-tags.md` § 2 y § 3): conversaciones con
 * fuera e hilos del equipo en una sola lista, tal como la da la RPC
 * `conversation_feed`. Cada fila se lee con su regla de hoy en la base; aquí
 * solo se ordena, se nombra y se deriva el turno.
 *
 * El turno que se enseña sale de `turnOf`/`dueReason` (`$lib/conversation-
 * overview`), el mismo módulo del panel y de Desk (ADR-118 § 7: un bloque y su
 * filtro no cuentan distinto). La RPC escribe la misma regla en SQL solo para
 * ordenar y cortar la página; el orden final de la página es el de aquí.
 *
 * Sin red, sin reloj y sin textos: `now` se inyecta.
 */

import { dueReason, turnOf, type TurnEvent } from './conversation-overview';
import { comparePide, type OrderKey } from './conversation-order';
import type { FeedThread } from './threads';

/** Una conversación de la lista: con quién, etiquetas, no leídos y lo que lee el turno. */
export interface FeedConversation {
  kind: 'conversation';
  id: string;
  workspace_id: string;
  project_id: string;
  line_id: string | null;
  created_at: string;
  /** La organización, o el contacto principal si no hay (ADR-102). */
  title: string | null;
  /** El contacto principal, si no es el título. */
  person: string | null;
  /** Sus claves; vacío se lee Difusión (`tagKeysOf`). */
  tags: string[];
  /** Registro + su hilo del equipo. */
  unread_count: number;
  /** Entrantes de fuera, no automáticos, después de tu lectura (`conversation_read`). */
  event_unread: number;
  /** Mensajes ajenos de su hilo del equipo después de su `thread_read`. */
  thread_unread: number;
  thread_id: string | null;
  /** El último correo, mensaje o llamada con dirección, no automático. */
  last: TurnEvent | null;
  last_in: { occurred_at: string } | null;
  /** Lo último que se movió: un evento, su hilo o el sello de contacto. */
  last_at: string | null;
  last_contacted_at: string | null;
  reply_settled_at: string | null;
  next_action_at: string | null;
  next_action_note: string | null;
  not_now_at: string | null;
  not_now_until: string | null;
}

/** Un hilo de la lista: la forma de `thread_feed`. */
export type FeedThreadRow = FeedThread & { kind: 'thread' };

export type FeedRow = FeedConversation | FeedThreadRow;

/** Lo que devuelve la RPC. */
export interface ConversationFeedResponse {
  items: FeedRow[];
  more: boolean;
}

/** Una conversación como la pinta la lista: con su turno ya derivado. */
export type FeedConversationView = FeedConversation & {
  /** `ours` = te toca (respuesta pendiente); `theirs` = les toca; null = sin turno. */
  turn: 'ours' | 'theirs' | null;
  /** Por qué te toca: una respuesta o un seguimiento vencido (`dueReason`). */
  due: 'reply' | 'follow_up' | null;
};

export type FeedRowView = FeedConversationView | FeedThreadRow;

/** Lo que devuelve `GET /api/conversations/feed`. */
export interface ConversationFeedView {
  me: string;
  items: FeedRowView[];
  more: boolean;
  /** user_id → nombre, de los autores de los hilos. */
  authors: Record<string, string>;
}

/**
 * Lo que el turno lee de una fila. Solo «no esta vez» cierra el turno
 * (`closed` = `notNowInForce`, que la relación mira lo primero), así que el
 * resto de hechos de la relación no hacen falta aquí.
 */
export function feedTurnRow(r: FeedConversation) {
  return {
    not_now_at: r.not_now_at,
    not_now_until: r.not_now_until,
    last: r.last,
    last_in: r.last_in,
    last_contacted_at: r.last_contacted_at,
    first_contacted_at: null,
    contacted_undated: false,
    reply_settled_at: r.reply_settled_at,
    next_action_at: r.next_action_at,
  };
}

/** El turno de una conversación de la lista, con la regla del panel. */
export function conversationView(r: FeedConversation, now: Date): FeedConversationView {
  const row = feedTurnRow(r);
  return { ...r, turn: turnOf(row, now)?.side ?? null, due: dueReason(row, now) };
}

/** Las filas de la RPC con su turno derivado. */
export function feedView(items: readonly FeedRow[], now: Date): FeedRowView[] {
  return sortFeed(items.map((r) => (r.kind === 'conversation' ? conversationView(r, now) : r)));
}

/** La clave de una fila: una conversación por su id, un hilo por el suyo. */
export function feedKey(r: Pick<FeedConversation, 'kind' | 'id'> | Pick<FeedThreadRow, 'kind' | 'thread_id'>): string {
  return r.kind === 'conversation' ? `c:${r.id}` : `t:${r.thread_id}`;
}

/** Lo que el orden lee de una fila (`$lib/conversation-order`): un hilo no tiene turno. */
export function feedOrderKey(r: FeedRowView): OrderKey {
  if (r.kind === 'thread') {
    return { id: r.thread_id, unread: r.unread_count, due: null, dueAt: null, lastAt: r.last_message_at, title: '', nextActionAt: null };
  }
  return {
    id: r.id,
    unread: r.unread_count,
    due: r.due,
    dueAt: r.due === 'reply' ? (r.last?.occurred_at ?? null) : r.due === 'follow_up' ? r.next_action_at : null,
    lastAt: r.last_at ?? r.created_at,
    title: r.title ?? '',
    nextActionAt: r.next_action_at,
  };
}

/**
 * El orden de la lista (plan de la lista § 4, «lo que pide»): lo que tiene no
 * leídos arriba; después lo que te toca (respuestas, la más reciente arriba;
 * después seguimientos, el más vencido primero); después lo último. A
 * igualdad, por id, para que la lista no baile. La misma regla que la tabla.
 */
export function compareFeed(a: FeedRowView, b: FeedRowView): number {
  return comparePide(feedOrderKey(a), feedOrderKey(b));
}

export function sortFeed(rows: readonly FeedRowView[]): FeedRowView[] {
  return [...rows].sort(compareFeed);
}

/**
 * Abrir una conversación la deja leída (`mark_conversation_read`): sin esperar
 * a la recarga, su fila pierde los no leídos del registro. Los de su hilo del
 * equipo se quedan: se leen al verlo (`markReadWhenSeen`), no al abrir la
 * ficha. La lista se reordena con la misma regla.
 */
export function markConversationRead(view: ConversationFeedView, conversationId: string): ConversationFeedView {
  let changed = false;
  const items = view.items.map((r) => {
    if (r.kind !== 'conversation' || r.id !== conversationId || r.event_unread === 0) return r;
    changed = true;
    return { ...r, event_unread: 0, unread_count: r.thread_unread };
  });
  return changed ? { ...view, items: sortFeed(items) } : view;
}
