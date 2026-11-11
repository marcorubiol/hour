/**
 * «Apuntar llamada» desde la cabecera de Conversaciones (121 A, ADR-182):
 * se empieza por con quién, que es lo que se recuerda al colgar, y la
 * conversación sale de esa persona u organización. Lo que se guarda es lo
 * mismo que apunta el cuadro de escribir: un `conversation_event` `call` con
 * su dirección, por `POST /api/conversations/:id/events`, así que cuenta para
 * el turno igual.
 *
 * Puro: sin red y con `now` inyectable. La búsqueda es del servidor
 * (`GET /api/conversations/call-targets`); aquí, lo que se dice de cada fila
 * y qué conversación se elige.
 */

import { localDayISO } from './datetime';
import { LOCALE_TAG, t, type Locale } from './i18n';
import { chatWho, type ChatWho } from './chat-row';
import type { ConversationEventCreate, ConversationEventKind, MessageApp } from './conversation';

/** Una conversación de con quién se habla, en un proyecto. */
export interface CallConversation {
  id: string;
  project_id: string;
  project_name: string | null;
  /** La última vez que se tocó (`touchedAt`). */
  touched_at: string | null;
}

/** Una fila de «¿Con quién?»: una persona del espacio o una organización. */
export interface CallTarget {
  kind: 'person' | 'organization';
  workspace_id: string;
  /** `person_id` de una persona; `id` de una organización. */
  id: string;
  name: string;
  /** Persona: su cargo («programadora»). */
  title: string | null;
  /** Persona: su casa, la organización de su dossier. */
  house: string | null;
  /** El tipo de la organización (la de la fila, o la casa de la persona). */
  org_kind: string | null;
  city: string | null;
  /** Del equipo (reparto, técnica o «voy»): sale, pero una llamada interna no es una conversación. */
  team: boolean;
  /** La última tocada primero. */
  conversations: CallConversation[];
}

export interface CallTargetsResponse {
  persons: CallTarget[];
  organizations: CallTarget[];
}

const same = (a: string | null | undefined, b: string | null | undefined) =>
  Boolean(a && b && a.trim().toLowerCase() === b.trim().toLowerCase());

/**
 * Cuándo se tocó una conversación: el último contacto o la última escritura,
 * la que sea más tarde. Null si no hay ninguna de las dos.
 */
export function touchedAt(c: { last_contacted_at: string | null; updated_at: string | null }): string | null {
  const a = c.last_contacted_at ? Date.parse(c.last_contacted_at) : NaN;
  const b = c.updated_at ? Date.parse(c.updated_at) : NaN;
  if (Number.isNaN(a) && Number.isNaN(b)) return null;
  if (Number.isNaN(b) || (!Number.isNaN(a) && a >= b)) return c.last_contacted_at;
  return c.updated_at;
}

/** La última tocada primero; sin fecha, al final. Una vez cada una. */
export function byLastTouched<T extends { id: string; touched_at: string | null }>(convs: readonly T[]): T[] {
  const once = [...new Map(convs.map((c) => [c.id, c])).values()];
  const at = (c: T) => (c.touched_at ? Date.parse(c.touched_at) : -Infinity);
  return once.sort((a, b) => at(b) - at(a));
}

/**
 * Personas y organizaciones, una vez. Una organización que es una sola
 * persona y se llama como ella ya sale como esa persona (ADR-177 § 3): la
 * organización se quita para no dar dos filas con el mismo nombre.
 */
export function mergeCallTargets(
  persons: readonly (CallTarget & { organization_id: string | null })[],
  organizations: readonly CallTarget[],
): CallTargetsResponse {
  const shadowed = new Set(
    persons.filter((p) => p.organization_id && same(p.house, p.name)).map((p) => `${p.workspace_id}:${p.organization_id}`),
  );
  return {
    persons: persons.map(({ organization_id: _drop, ...p }) => p),
    organizations: organizations.filter((o) => !shadowed.has(`${o.workspace_id}:${o.id}`)),
  };
}

/**
 * Con quién es la fila (ADR-177 § 2 y § 3): la forma del monograma y las
 * palabras de al lado. Del equipo, redonda y «del equipo». Una organización,
 * su tipo y su ciudad (`chatWho`). Una persona de fuera lleva su casa
 * («programadora de Teatre de la Llum») y su ciudad; si su casa es ella misma
 * (o se dice «por libre»), «por libre».
 */
export function callTargetWho(target: CallTarget, locale: Locale): ChatWho {
  const city = target.city?.trim() || null;
  if (target.team) return { shape: 'person', words: [t('call.team', locale)] };
  if (target.kind === 'organization') return chatWho({ kind: target.org_kind, city }, locale);
  if (target.org_kind === 'solo' || same(target.house, target.name)) {
    return { shape: 'person', words: [t('chat.solo', locale), ...(city ? [city] : [])] };
  }
  const title = target.title?.trim() || null;
  const house = target.house?.trim() || null;
  const home = title && house ? t('call.title_of', locale, { title, house }) : (house ?? title);
  return { shape: 'person', words: [home, city].filter((w): w is string => Boolean(w)) };
}

/** La segunda línea: cuántas conversaciones y de qué proyectos, o que no hay. */
export function callTargetConversations(target: CallTarget, locale: Locale): string {
  if (target.team) return t('call.team_not', locale);
  const n = target.conversations.length;
  if (n === 0) return t('call.no_conversation', locale);
  const projects = [...new Set(target.conversations.map((c) => c.project_name).filter((p): p is string => Boolean(p)))];
  const count = t(n === 1 ? 'call.conversations_one' : 'call.conversations_other', locale, { n });
  return projects.length > 0 ? `${count} · ${new Intl.ListFormat(LOCALE_TAG[locale], { type: 'conjunction' }).format(projects)}` : count;
}

/** «HH:MM» de un instante, en la hora de quien mira. */
export function localTime(now: Date): string {
  return `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
}

/**
 * Cuándo fue la llamada. Sin tocar la hora, nada: el servidor pone ahora
 * (como el cuadro de escribir hoy). Cambiada, ese día a esa hora en la zona
 * de quien mira.
 */
export function callOccurredAt(when: { day: string; time: string; edited: boolean }): string | undefined {
  if (!when.edited) return undefined;
  const at = new Date(`${when.day}T${when.time || '12:00'}:00`);
  return Number.isNaN(at.getTime()) ? undefined : at.toISOString();
}

/** Una hora cambiada que aún no ha llegado: la base no la acepta (22023). */
export function callInFuture(when: { day: string; time: string; edited: boolean }, now: Date = new Date()): boolean {
  if (!when.edited) return false;
  if (when.day > localDayISO(now)) return true;
  const at = callOccurredAt(when);
  return at ? Date.parse(at) > now.getTime() : false;
}

// ── Apuntar un contacto: una pieza para las dos puertas (tarea 134) ──────
// El cuadro de escribir de una conversación («+ Apuntar», ADR-185 § 4) y la
// llamada desde la lente («+ → Llamada», ADR-182) apuntan lo mismo con el
// mismo formulario (`ContactLogFields`): qué fue, por dónde si es un
// mensaje, quién empezó, cuándo. La nota es el campo de texto de cada puerta.

/** Qué se apunta, en el orden en que más se apunta. */
export const LOG_KINDS = ['call', 'meeting', 'message', 'email', 'note'] as const satisfies readonly ConversationEventKind[];

export interface ContactLog {
  kind: ConversationEventKind;
  /** Un mensaje: por qué app (ADR-186). */
  via: MessageApp;
  /** Quién empezó; vacío en una reunión o un apunte, que no tienen «quién». */
  direction: 'outbound' | 'inbound' | '';
  day: string;
  time: string;
  /** «Otro día»: el día y la hora se eligen; si no, es ahora (lo sella el servidor). */
  edited: boolean;
}

/** Lo que más se apunta: una llamada que hice yo, ahora. */
export function freshContactLog(kind: ConversationEventKind = 'call', now: Date = new Date()): ContactLog {
  return { kind, via: 'whatsapp', direction: hasWho(kind) ? 'outbound' : '', day: localDayISO(now), time: localTime(now), edited: false };
}

/** Una reunión es de los dos y un apunte no tiene a nadie delante: sin «quién». */
export function hasWho(kind: ConversationEventKind): boolean {
  return kind !== 'note' && kind !== 'meeting';
}

/** Cambiar qué fue conserva quién empezó si sigue teniendo sentido. */
export function withKind(log: ContactLog, kind: ConversationEventKind): ContactLog {
  return { ...log, kind, direction: hasWho(kind) ? log.direction || 'outbound' : '' };
}

/** El cuerpo del POST `/api/conversations/:id/events`, igual desde las dos puertas. */
export function contactEvent(log: ContactLog, note: string): ConversationEventCreate {
  const occurred_at = callOccurredAt(log);
  return {
    kind: log.kind,
    ...(log.kind === 'message' ? { via: log.via } : {}),
    direction: hasWho(log.kind) ? log.direction || null : null,
    body: note.trim() || null,
    ...(occurred_at ? { occurred_at } : {}),
  };
}

/** El cuerpo del POST: el mismo que manda el cuadro de escribir para una llamada. */
export function callEvent(input: {
  direction: 'outbound' | 'inbound';
  note: string;
  day: string;
  time: string;
  edited: boolean;
}): ConversationEventCreate {
  const { note, ...when } = input;
  return contactEvent({ ...when, kind: 'call', via: 'whatsapp' }, note);
}
