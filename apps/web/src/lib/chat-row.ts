/**
 * La fila de chat de Conversaciones (ADR-176): lo que se lee de un vistazo,
 * como en una app de mensajería. Puro: sin red y con `now` inyectable.
 */

import { hourMark, localeDayMonthNear, localeWeekdayShort, timeInTz } from './datetime';
import { LOCALE_TAG, t, type Locale } from './i18n';
import { eventKindLabel, type ConversationEventKind, type ConversationItem } from './conversation';
import { relationLabel, type Relation } from './conversation-relation';
import type { TurnEvent, TurnRow } from './conversation-overview';
import { rowTurn, type RowTurn } from './conversation-row';

function dayInZone(iso: string, tz: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(
    new Date(iso),
  );
}

const DAY_MS = 86_400_000;

/**
 * Cuándo, en la columna de la hora: hoy, la hora; ayer, «ayer»; esta semana,
 * el día de la semana; antes, el día y el mes (con el año si no es de los
 * doce meses de alrededor).
 */
export function chatWhen(iso: string, locale: Locale, tz: string, now: Date = new Date()): string {
  const day = dayInZone(iso, tz);
  const today = dayInZone(now.toISOString(), tz);
  if (day === today) return hourMark(timeInTz(iso, tz));
  const days = Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${day}T00:00:00Z`)) / DAY_MS);
  if (days === 1) return t('chat.yesterday', locale);
  const tag = LOCALE_TAG[locale];
  if (days > 1 && days < 7) return localeWeekdayShort(day, tag);
  return localeDayMonthNear(day, today, tag);
}

/**
 * Con quién es la fila (ADR-177 § 2 y § 3): la forma de su monograma y las
 * palabras de al lado del nombre. Una organización que es una sola persona y
 * se llama como ella (`solo`, de `conversation_feed`, la única regla) se
 * enseña como persona: redonda y «por libre», sin «organización». Si no, cuadrada, con su tipo; sin tipo (o «otra»), sólo la
 * ciudad, nunca «otro». La ciudad ya llega elegida (la de la organización y,
 * si no tiene, la de la persona). La forma nunca va sola: siempre con la
 * palabra.
 */
export interface ChatWho {
  shape: 'person' | 'organization';
  /** «sala», «Girona»: van tras el nombre, separadas por «·». */
  words: string[];
}

export function chatWho(
  c: { kind?: string | null; solo?: boolean | null; city?: string | null },
  locale: Locale,
): ChatWho {
  const city = c.city?.trim() || null;
  // `kind = 'solo'` (115) es «por libre» dicho por alguien: el feed ya lo da en `solo`, el resto de lecturas no.
  if (c.solo || c.kind === 'solo') return { shape: 'person', words: [t('chat.solo', locale), ...(city ? [city] : [])] };
  const kind = c.kind && c.kind !== 'other' ? t(`organization.kind_${c.kind}`, locale).toLocaleLowerCase(LOCALE_TAG[locale]) : null;
  return { shape: 'organization', words: [kind, city].filter((w): w is string => Boolean(w)) };
}

/**
 * Lo que una conversación dice en su fila, esté donde esté (ADR-177; mesa,
 * punto 6: «la fila de los demás sitios como la del chat»): Conversaciones,
 * «Te espera» de Hoy, la ficha de la sala y la del proyecto leen la misma
 * regla. `last` es el último correo, mensaje o llamada con dirección y no
 * automático (el del turno): lo que Hour apunta solo («Planificador: función
 * confirmada») nunca es lo último que se dijo.
 */
export interface ChatSource {
  /** Su contacto, si no es el título: quien dijo lo último cuando vino de fuera. */
  person: string | null;
  last: TurnEvent | null;
  relation?: Relation | null;
  /** Un seguimiento vencido: la fila dice su nota. */
  due?: 'reply' | 'follow_up' | null;
  next_action_note?: string | null;
}

/** Quién dijo lo último y qué: tú, su contacto, o qué fue (una llamada, una reunión). */
export function chatLast(c: ChatSource, locale: Locale): { lead: string | null; last: string | null } {
  if (c.due === 'follow_up') return { lead: t('chat.follow_up', locale), last: c.next_action_note ?? null };
  const ev = c.last;
  // Nada dicho aún: sin contactar lo dice; una contactada por sello dice su relación.
  if (!ev) return { lead: null, last: c.relation && c.relation !== 'never' ? relationLabel(c.relation, locale) : t('chat.never', locale) };
  const kind = ev.kind as ConversationEventKind | null | undefined;
  if (kind && kind !== 'email' && kind !== 'message') return { lead: eventKindLabel(kind, locale), last: ev.subject ?? null };
  return { lead: ev.direction === 'outbound' ? t('threads.you', locale) : c.person, last: ev.subject ?? null };
}

/** Una palabra de la línea de contexto; `ink` la pone en tinta (lo que nos toca). */
export interface ChatContext {
  text: string;
  ink?: boolean;
}

/**
 * El turno en palabras (ADR-177 § 5): «Nos toca responder», «Volver a
 * escribir», «Esperando su respuesta». En tinta lo que nos toca.
 */
export function chatTurn(
  row: TurnRow & { next_action_at: string | null },
  now: Date,
  locale: Locale,
): (ChatContext & { reason: RowTurn['reason'] }) | null {
  const turn = rowTurn(row, now, locale);
  return turn ? { text: turn.word, ink: turn.tone === 'ours' || turn.tone === 'late', reason: turn.reason } : null;
}

/** Una conversación leída por PostgREST (`/api/conversations`, la ficha de la organización). */
export interface ChatItem {
  not_now_at: string | null;
  not_now_until: string | null;
  last_contacted_at: string | null;
  first_contacted_at: string | null;
  contacted_undated: boolean | null;
  reply_settled_at: string | null;
  next_action_at: string | null;
  next_action_note: string | null;
  relation?: Relation | null;
  /** El último correo, mensaje o llamada con dirección, no automático (`TURN_EMBEDS`). */
  last_turn?: TurnEvent[] | null;
  last_in?: { occurred_at: string }[] | null;
  organization?: { name: string; kind: string | null; city: string | null } | null;
  /** Su contacto principal. */
  person?: { full_name: string; city?: string | null } | null;
  /** Con quién, por la regla de la lente (`conversation_feed`). */
  place?: ConversationItem['place'];
}

export interface ChatLine extends ChatWho {
  lead: string | null;
  last: string | null;
  /** Null: no hay turno (ni respuesta, ni seguimiento, ni esperando la suya). */
  turn: ReturnType<typeof chatTurn>;
}

const sameName = (a: string | null | undefined, b: string | null | undefined) =>
  Boolean(a && b && a.trim().toLowerCase() === b.trim().toLowerCase());

/**
 * La fila de chat de una conversación leída fuera del feed. Con quién sale de
 * `place` cuando la lectura es la de la lente (`conversation_feed`, su regla
 * de «por libre»); sin él, de su organización (su ciudad, si no la de su
 * contacto) y «por libre» si su tipo lo dice o si su contacto se llama como
 * ella (lo que esa lectura sabe: no cuenta las demás personas de la casa).
 */
export function chatLine(item: ChatItem, now: Date, locale: Locale): ChatLine {
  const org = item.organization ?? null;
  const person = item.person?.full_name ?? null;
  const place = item.place ?? {
    kind: org?.kind ?? null,
    solo: org?.kind === 'solo' || sameName(org?.name, person),
    city: org?.city || item.person?.city || null,
  };
  const turn = chatTurn(
    {
      not_now_at: item.not_now_at ?? null,
      not_now_until: item.not_now_until ?? null,
      last: item.last_turn?.[0] ?? null,
      last_in: item.last_in?.[0] ?? null,
      last_contacted_at: item.last_contacted_at ?? null,
      first_contacted_at: item.first_contacted_at ?? null,
      contacted_undated: item.contacted_undated ?? false,
      reply_settled_at: item.reply_settled_at ?? null,
      next_action_at: item.next_action_at ?? null,
    },
    now,
    locale,
  );
  const { lead, last } = chatLast(
    {
      person: person && !sameName(person, org?.name) ? person : null,
      last: item.last_turn?.[0] ?? null,
      relation: item.relation,
      due: turn?.reason === 'follow_up' ? 'follow_up' : null,
      next_action_note: item.next_action_note,
    },
    locale,
  );
  return { ...chatWho(place, locale), lead, last, turn };
}

