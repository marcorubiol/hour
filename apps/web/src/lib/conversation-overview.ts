/**
 * Conversations como dashboard (ADR-117, propuesta A): turno y temperatura de
 * la difusión, derivados, nunca guardados. El módulo puro detrás de
 * `GET /api/conversations/overview` y de los filtros `?turno=`/`?temp=` de la
 * lista: los dos llaman a lo mismo, así que un bloque y su filtro no pueden
 * contar distinto.
 *
 * Sin red, sin reloj y sin textos: `now` se inyecta y las etiquetas las pone la
 * pantalla (el patrón de `desk-feed.ts`). Días de calendario en la zona de quien
 * llama: «hace 2 días» es lo que dice el calendario, no 48 horas.
 *
 * Las reglas (ADR-117 § 5, puntos de partida para ajustar con uso):
 * - **Te toca**: el último correo, mensaje o llamada con dirección es de fuera
 *   (`inbound`), no le hemos contestado y no se marcó «no pide respuesta»;
 *   detrás, los seguimientos vencidos. Una confirmada no pide respuesta por
 *   correo, solo por seguimiento (ADR-126 § 1).
 * - **Caliente**: en conversación o hold con actividad en 14 días, o cualquier
 *   sala que nos escribió en 14 días.
 * - **Se enfría**: nuestro último correo sin respuesta hace 21 días o más; o
 *   una conversación abierta sin nada en 30; o ninguna fecha. En dos grupos
 *   (ADR-126 § 8): las que no contestaron al envío (contactada, recurrente:
 *   segunda ronda, en bloque) y las paradas (en conversación, hold: una a una).
 * - **La temporada**: de septiembre a agosto por fecha de función; una
 *   conversación sin funciones es de la temporada en curso (está en difusión).
 */

import { CONVERSATION_STATUSES, type ConversationStatus } from './conversation';
import type { FeedThread } from './threads';

/** Caliente: actividad o un correo de ellos en estos días. */
export const HOT_DAYS = 14;
/** Se enfría: nuestro último correo sin respuesta desde hace estos días. */
export const COLD_REPLY_DAYS = 21;
/** Se enfría: una conversación abierta sin ningún movimiento en estos días. */
export const COLD_IDLE_DAYS = 30;
/** Filas que enseña cada bloque; el resto, en la lista. */
export const BLOCK_ROWS = 5;
/**
 * Sitio guardado en «Te toca» para los seguimientos vencidos: son lo único que
 * apuntaste tú, y diez respuestas no deben esconderlos (ADR-126 § 7).
 */
export const FOLLOW_UP_ROWS = 2;

/** Las filas de «Se enfría»: las paradas primero, y siempre sitio para la segunda ronda. */
export function coldBlockRows<R extends OverviewInput>(sorted: readonly R[], now: Date, size = BLOCK_ROWS): R[] {
  const stalled = sorted.filter((r) => coolingOf(r, now)?.group === 'stalled');
  const round = sorted.filter((r) => coolingOf(r, now)?.group === 'round');
  const stalledRows = Math.min(stalled.length, size - Math.min(round.length, FOLLOW_UP_ROWS));
  return [...stalled.slice(0, stalledRows), ...round.slice(0, size - stalledRows)];
}

/** Las filas de «Te toca»: respuestas y, con sitio guardado, seguimientos. */
export function dueBlockRows<R extends OverviewInput>(sorted: readonly R[], now: Date, size = BLOCK_ROWS): R[] {
  const replies = sorted.filter((r) => dueReason(r, now) === 'reply');
  const followUps = sorted.filter((r) => dueReason(r, now) === 'follow_up');
  const replyRows = Math.min(replies.length, size - Math.min(followUps.length, FOLLOW_UP_ROWS));
  return [...replies.slice(0, replyRows), ...followUps.slice(0, size - replyRows)];
}
export const HOT_ROWS = 6;

/** Los canales que cuentan para el turno: una nota no es una interacción. */
export const TURN_KINDS = ['email', 'message', 'call'] as const;

/** Ni te toca ni se enfría: la sala dijo que no, o se dejó dormir a propósito. */
const CLOSED: ReadonlySet<ConversationStatus> = new Set(['declined', 'dormant']);
/**
 * Sin turno por correo: las cerradas y la confirmada, cuyo último correo suele
 * ser el «perfecto, quedamos así» que no pide nada. Lo que quede pendiente de
 * una confirmada se apunta como seguimiento (ADR-126 § 1).
 */
const NO_TURN: ReadonlySet<ConversationStatus> = new Set([...CLOSED, 'confirmed']);
/** Esperamos su respuesta a un correo nuestro (la regla de 21 días). */
const AWAITING: ReadonlySet<ConversationStatus> = new Set(['contacted', 'in_conversation', 'hold', 'recurring']);
/**
 * Estados que ya implican una respuesta de la sala: una confirmada o una
 * rechazada no está «sin respuesta», aunque lo hablado no esté en el
 * historial (ADR-126 § 2).
 */
const ANSWERED: ReadonlySet<ConversationStatus> = new Set(['in_conversation', 'hold', 'confirmed', 'declined', 'recurring']);

/** Ha contestado: nos escribió alguna vez, o su estado ya lo dice. */
export function hasAnswered(row: Pick<OverviewInput, 'status' | 'last_in'>): boolean {
  return Boolean(row.last_in) || ANSWERED.has(row.status);
}

/** Conversación abierta: la regla de 30 días y la mitad de «caliente». */
const OPEN: ReadonlySet<ConversationStatus> = new Set(['in_conversation', 'hold']);

/** El último evento con dirección de una conversación (embebido, limit 1). */
export interface TurnEvent {
  direction: 'inbound' | 'outbound';
  occurred_at: string;
  kind?: string | null;
  subject?: string | null;
}

/** Lo que el dashboard lee de cada conversación del alcance. */
export interface OverviewInput {
  id: string;
  workspace_id: string;
  project_id: string;
  line_id: string | null;
  status: ConversationStatus;
  last_contacted_at: string | null;
  next_action_at: string | null;
  next_action_note: string | null;
  /** La organización, o el contacto si no hay (ADR-102). */
  title: string;
  /** El contacto principal, si lo hay y no es el título. */
  person: string | null;
  /** Último correo, mensaje o llamada con dirección. */
  last: TurnEvent | null;
  /** Último que vino de fuera. */
  last_in: Pick<TurnEvent, 'occurred_at'> | null;
  /** «No pide respuesta»: lo de fuera hasta este instante ya está atendido (ADR-126 § 1). */
  reply_settled_at?: string | null;
  /** Días (YYYY-MM-DD) de sus funciones vivas, directas o por su bolo. */
  performance_days: string[];
}

// ── Días ───────────────────────────────────────────────────────────────────

function localMidnight(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

/** Días de calendario desde `iso` hasta hoy (0 = hoy). Una fecha sola (YYYY-MM-DD) se lee como ese día. */
export function daysSince(iso: string, now: Date): number {
  const at = /^\d{4}-\d{2}-\d{2}$/.test(iso) ? new Date(`${iso}T12:00:00`) : new Date(iso);
  if (Number.isNaN(at.getTime())) return 0;
  return Math.round((localMidnight(now) - localMidnight(at)) / 86_400_000);
}

function latest(...isos: (string | null | undefined)[]): string | null {
  let out: string | null = null;
  for (const iso of isos) if (iso && (!out || Date.parse(iso) > Date.parse(out))) out = iso;
  return out;
}

/** El último movimiento que se sabe: un evento con dirección o el sello de contacto. */
export function lastActivity(row: Pick<OverviewInput, 'last' | 'last_in' | 'last_contacted_at'>): string | null {
  return latest(row.last?.occurred_at, row.last_in?.occurred_at, row.last_contacted_at);
}

// ── Turno ──────────────────────────────────────────────────────────────────

export type TurnSide = 'ours' | 'theirs';

export interface Turn {
  side: TurnSide;
  since: string;
  days: number;
}

/**
 * De quién es el turno: de quien no escribió el último. Una conversación
 * cerrada (rechazada o en pausa) o confirmada no tiene turno, ni una cuyo
 * último correo de fuera se marcó «no pide respuesta».
 */
export function turnOf(
  row: Pick<OverviewInput, 'status' | 'last' | 'reply_settled_at'>,
  now: Date,
): Turn | null {
  if (!row.last || NO_TURN.has(row.status)) return null;
  if (row.last.direction === 'inbound' && isSettled(row.last.occurred_at, row.reply_settled_at)) return null;
  return {
    side: row.last.direction === 'inbound' ? 'ours' : 'theirs',
    since: row.last.occurred_at,
    days: daysSince(row.last.occurred_at, now),
  };
}

/** Lo de fuera hasta `settledAt` ya está atendido. */
function isSettled(at: string, settledAt: string | null | undefined): boolean {
  return Boolean(settledAt) && Date.parse(at) <= Date.parse(settledAt!);
}

/** Un seguimiento apuntado para hoy o antes, en una conversación que no está cerrada. */
export function followUpDue(row: Pick<OverviewInput, 'status' | 'next_action_at'>, now: Date): boolean {
  return Boolean(row.next_action_at) && !CLOSED.has(row.status) && daysSince(row.next_action_at!.slice(0, 10), now) >= 0;
}

export type DueReason = 'reply' | 'follow_up';

/** Por qué te toca, o null: primero una respuesta pendiente, después un seguimiento. */
export function dueReason(
  row: Pick<OverviewInput, 'status' | 'last' | 'next_action_at' | 'reply_settled_at'>,
  now: Date,
): DueReason | null {
  if (turnOf(row, now)?.side === 'ours') return 'reply';
  return followUpDue(row, now) ? 'follow_up' : null;
}

// ── Temperatura ───────────────────────────────────────────────────────────

export function isHot(row: Pick<OverviewInput, 'status' | 'last' | 'last_in' | 'last_contacted_at'>, now: Date): boolean {
  if (CLOSED.has(row.status)) return false;
  if (row.last_in && daysSince(row.last_in.occurred_at, now) <= HOT_DAYS) return true;
  const activity = lastActivity(row);
  return OPEN.has(row.status) && activity !== null && daysSince(activity, now) <= HOT_DAYS;
}

export type CoolingReason = 'no_reply' | 'idle' | 'no_history';
/** `round`: no contestó al envío, se recupera con otro; `stalled`: se hablaba de algo, una a una. */
export type CoolingGroup = 'round' | 'stalled';

export interface Cooling {
  reason: CoolingReason;
  /** null: no se sabe de ninguna fecha. */
  days: number | null;
  group: CoolingGroup;
}

const ROUND: ReadonlySet<ConversationStatus> = new Set(['contacted', 'recurring']);

/**
 * Se enfría: le tocaba a la sala y no contesta (nuestro último correo, 21 días),
 * o la conversación abierta lleva 30 días parada. Si te toca a ti, no se enfría:
 * es tuya. Una conversación «contactada» sin ningún evento (de antes del
 * historial, ADR-098) cuenta su sello de contacto como nuestro último correo.
 * Sin ninguna fecha (alta a mano, importada) también se enfría: son justo las
 * olvidadas, y no salían en ningún bloque.
 */
export function coolingOf(
  row: Pick<OverviewInput, 'status' | 'last' | 'last_in' | 'last_contacted_at' | 'reply_settled_at' | 'next_action_at'>,
  now: Date,
): Cooling | null {
  if (!AWAITING.has(row.status)) return null;
  const group: CoolingGroup = ROUND.has(row.status) ? 'round' : 'stalled';
  const turn = turnOf(row, now);
  // Te toca (una respuesta o un seguimiento vencido): es tuya, no se enfría.
  if (turn?.side === 'ours' || followUpDue(row, now)) return null;
  if (turn?.side === 'theirs' && turn.days >= COLD_REPLY_DAYS) return { reason: 'no_reply', days: turn.days, group };
  if (!row.last && !row.last_in && row.status === 'contacted' && row.last_contacted_at) {
    const days = daysSince(row.last_contacted_at, now);
    if (days >= COLD_REPLY_DAYS) return { reason: 'no_reply', days, group };
  }
  const activity = lastActivity(row);
  // Sin ninguna fecha y sin nada apuntado: olvidada. Con un seguimiento futuro, no.
  if (!activity && !turn && !row.next_action_at) return { reason: 'no_history', days: null, group };
  if (OPEN.has(row.status) && activity) {
    const days = daysSince(activity, now);
    if (days >= COLD_IDLE_DAYS) return { reason: 'idle', days, group };
  }
  return null;
}

// ── Temporada ──────────────────────────────────────────────────────────────

export interface Season {
  /** «26-27» */
  label: string;
  start: string;
  end: string;
}

/** La temporada de un día: de septiembre a agosto (ADR-117 § 3). */
export function seasonOf(day: string): Season {
  const y = Number(day.slice(0, 4));
  const startYear = Number(day.slice(5, 7)) >= 9 ? y : y - 1;
  const yy = (n: number) => String(n % 100).padStart(2, '0');
  return { label: `${yy(startYear)}-${yy(startYear + 1)}`, start: `${startYear}-09-01`, end: `${startYear + 1}-08-31` };
}

export function currentSeason(now: Date): Season {
  const m = String(now.getMonth() + 1).padStart(2, '0');
  return seasonOf(`${now.getFullYear()}-${m}-01`);
}

/** De la temporada: tiene una función en ella, o no tiene ninguna todavía. */
export function inSeason(row: Pick<OverviewInput, 'performance_days'>, season: Season): boolean {
  return row.performance_days.length === 0 || row.performance_days.some((d) => d >= season.start && d <= season.end);
}

/**
 * Las conversaciones que cuenta la temporada: las de sus fechas y, si hay
 * líneas de difusión fijadas en la barra, solo las de esas líneas.
 */
export function seasonRows<R extends Pick<OverviewInput, 'performance_days' | 'line_id'>>(
  rows: readonly R[],
  season: Season,
  lineIds: readonly string[] = [],
): R[] {
  const lines = new Set(lineIds);
  return rows.filter((r) => inSeason(r, season) && (lines.size === 0 || (r.line_id !== null && lines.has(r.line_id))));
}

export type StatusCounts = Record<ConversationStatus, number>;

export function countByStatus(rows: readonly Pick<OverviewInput, 'status'>[]): StatusCounts {
  const out = Object.fromEntries(CONVERSATION_STATUSES.map((s) => [s, 0])) as StatusCounts;
  for (const r of rows) out[r.status] += 1;
  return out;
}

// ── Los filtros de la lista ────────────────────────────────────────────────

export type TurnFilter = 'nuestro' | 'suyo';
/** `ronda` y `parada`: los dos grupos de «se enfría» (ADR-126 § 8). */
export type TempFilter = 'caliente' | 'fria' | 'ronda' | 'parada';
const TEMP_FILTERS: readonly string[] = ['caliente', 'fria', 'ronda', 'parada'];

export interface ListFilter {
  turno?: TurnFilter;
  temp?: TempFilter;
  /** Solo las de la temporada en curso (la barra de la temporada filtra con esto). */
  temporada?: boolean;
}

export function parseListFilter(params: URLSearchParams): ListFilter {
  const turno = params.get('turno');
  const temp = params.get('temp');
  return {
    turno: turno === 'nuestro' || turno === 'suyo' ? turno : undefined,
    temp: temp && TEMP_FILTERS.includes(temp) ? (temp as TempFilter) : undefined,
    temporada: params.get('temporada') === 'actual' || undefined,
  };
}

export function hasListFilter(f: ListFilter): boolean {
  return Boolean(f.turno || f.temp || f.temporada);
}

/**
 * Las conversaciones de un filtro de bloque, en el orden de su bloque. `te toca`
 * es lo mismo que cuenta el bloque: respuestas pendientes y seguimientos.
 */
export function applyListFilter<R extends OverviewInput>(
  rows: readonly R[],
  f: ListFilter,
  now: Date,
  lineIds: readonly string[] = [],
): R[] {
  let out = f.temporada ? seasonRows(rows, currentSeason(now), lineIds) : [...rows];
  if (f.turno === 'nuestro') out = sortDue(out.filter((r) => dueReason(r, now) !== null), now);
  if (f.turno === 'suyo') {
    out = out
      .filter((r) => turnOf(r, now)?.side === 'theirs')
      .sort((a, b) => Date.parse(a.last!.occurred_at) - Date.parse(b.last!.occurred_at));
  }
  if (f.temp === 'caliente') out = sortHot(out.filter((r) => isHot(r, now)));
  if (f.temp === 'fria') out = sortCold(out.filter((r) => coolingOf(r, now) !== null), now);
  if (f.temp === 'ronda') out = sortCold(out.filter((r) => coolingOf(r, now)?.group === 'round'), now);
  if (f.temp === 'parada') out = sortCold(out.filter((r) => coolingOf(r, now)?.group === 'stalled'), now);
  return out;
}

/**
 * Respuestas primero, la más reciente arriba: lo que escribieron ayer no
 * queda debajo de lo que lleva semanas (ADR-126 § 1; «tarde» lo marca la
 * fila). Después los seguimientos, el más vencido primero.
 */
function sortDue<R extends OverviewInput>(rows: R[], now: Date): R[] {
  const key = (r: R) =>
    dueReason(r, now) === 'reply'
      ? [0, -Date.parse(r.last!.occurred_at)]
      : [1, Date.parse(r.next_action_at!)];
  return rows.sort((a, b) => {
    const [ga, ta] = key(a);
    const [gb, tb] = key(b);
    return ga - gb || ta - tb;
  });
}

function sortHot<R extends OverviewInput>(rows: R[]): R[] {
  return rows.sort((a, b) => Date.parse(lastActivity(b) ?? '') - Date.parse(lastActivity(a) ?? ''));
}

/** Paradas primero (se recuperan una a una), y dentro la más fría; sin fecha, al final. */
function sortCold<R extends OverviewInput>(rows: R[], now: Date): R[] {
  const key = (r: R) => {
    const c = coolingOf(r, now)!;
    return [c.group === 'stalled' ? 0 : 1, c.days === null ? 1 : 0, -(c.days ?? 0)];
  };
  return rows.sort((a, b) => {
    const [ga, na, da] = key(a);
    const [gb, nb, db] = key(b);
    return ga - gb || na - nb || da - db;
  });
}

// ── Los bloques ────────────────────────────────────────────────────────────

/** Una fila de un bloque: lo que la pantalla pinta y a dónde lleva. */
export interface BlockRow {
  id: string;
  workspace_id: string;
  project_id: string;
  title: string;
  person: string | null;
  status: ConversationStatus;
}

export interface DueRow extends BlockRow {
  reason: DueReason;
  /** El evento de ellos (respuesta) o el día del seguimiento. */
  at: string;
  days: number;
  kind: string | null;
  subject: string | null;
  note: string | null;
}

export interface HotRow extends BlockRow {
  at: string | null;
  days: number | null;
  turn: TurnSide | null;
}

export interface ColdRow extends BlockRow {
  reason: CoolingReason;
  days: number | null;
  group: CoolingGroup;
  subject: string | null;
}

export interface Block<T> {
  count: number;
  rows: T[];
}

export interface ConversationOverview {
  /** Conversaciones vivas en el alcance. */
  total: number;
  season: {
    label: string;
    start: string;
    end: string;
    total: number;
    counts: StatusCounts;
    /** Las que han contestado algo: nos escribieron, o su estado lo implica. */
    answered: number;
  };
  due: Block<DueRow>;
  hot: Block<HotRow>;
  /**
   * `picks`: las de segunda ronda, para «Escribir a estas» (con su proyecto: un
   * envío es de uno). Las paradas no van en bloque. `round`/`stalled`: cuántas
   * hay de cada grupo.
   */
  cold: Block<ColdRow> & { round: number; stalled: number; picks: { id: string; project_id: string }[] };
}

function blockRow(r: OverviewInput): BlockRow {
  return {
    id: r.id,
    workspace_id: r.workspace_id,
    project_id: r.project_id,
    title: r.title,
    person: r.person,
    status: r.status,
  };
}

export function buildOverview(
  rows: readonly OverviewInput[],
  now: Date,
  opts: { lineIds?: readonly string[] } = {},
): ConversationOverview {
  const season = currentSeason(now);
  const inSeasonRows = seasonRows(rows, season, opts.lineIds);

  const due = applyListFilter(rows, { turno: 'nuestro' }, now);
  const hot = applyListFilter(rows, { temp: 'caliente' }, now);
  const cold = applyListFilter(rows, { temp: 'fria' }, now);

  return {
    total: rows.length,
    season: {
      ...season,
      total: inSeasonRows.length,
      counts: countByStatus(inSeasonRows),
      answered: inSeasonRows.filter(hasAnswered).length,
    },
    due: {
      count: due.length,
      rows: dueBlockRows(due, now).map((r) => {
        const reason = dueReason(r, now)!;
        const at = reason === 'reply' ? r.last!.occurred_at : r.next_action_at!.slice(0, 10);
        return {
          ...blockRow(r),
          reason,
          at,
          days: daysSince(at, now),
          kind: reason === 'reply' ? (r.last!.kind ?? null) : null,
          subject: reason === 'reply' ? (r.last!.subject ?? null) : null,
          note: r.next_action_note,
        };
      }),
    },
    hot: {
      count: hot.length,
      rows: hot.slice(0, HOT_ROWS).map((r) => {
        const at = lastActivity(r);
        return { ...blockRow(r), at, days: at ? daysSince(at, now) : null, turn: turnOf(r, now)?.side ?? null };
      }),
    },
    cold: {
      count: cold.length,
      rows: coldBlockRows(cold, now).map((r) => {
        const c = coolingOf(r, now)!;
        return {
          ...blockRow(r),
          reason: c.reason,
          days: c.days,
          group: c.group,
          subject: c.reason === 'no_reply' ? (r.last?.subject ?? null) : null,
        };
      }),
      round: cold.filter((r) => coolingOf(r, now)!.group === 'round').length,
      stalled: cold.filter((r) => coolingOf(r, now)!.group === 'stalled').length,
      picks: cold.filter((r) => coolingOf(r, now)!.group === 'round').map((r) => ({ id: r.id, project_id: r.project_id })),
    },
  };
}

// ── Último envío ───────────────────────────────────────────────────────────

export interface MailoutRecipientLite {
  conversation_id: string;
  status: string;
  sent_at?: string | null;
  suppressed_reason?: string | null;
  suppressed_at?: string | null;
}

export interface MailoutFigures {
  recipients: number;
  sent: number;
  delivered: number;
  bounced: number;
  complained: number;
  unsubscribed: number;
  replies: number;
}

const LEFT = new Set(['sent', 'delivered', 'bounced', 'complained']);

/**
 * Las cifras de un envío. Respuesta: la conversación tiene un correo de ellos
 * posterior a la salida del suyo (el último de fuera basta: si hay alguno
 * después, el último también lo es). Baja: suprimida por baja desde que el
 * envío se puso en cola.
 */
export function mailoutFigures(
  recipients: readonly MailoutRecipientLite[],
  queuedAt: string | null,
  lastInByConversation: ReadonlyMap<string, string>,
): MailoutFigures {
  const out: MailoutFigures = { recipients: recipients.length, sent: 0, delivered: 0, bounced: 0, complained: 0, unsubscribed: 0, replies: 0 };
  const queued = queuedAt ? Date.parse(queuedAt) : null;
  for (const r of recipients) {
    if (LEFT.has(r.status)) out.sent += 1;
    if (r.status === 'delivered' || r.status === 'complained') out.delivered += 1;
    if (r.status === 'bounced') out.bounced += 1;
    if (r.status === 'complained') out.complained += 1;
    if (r.suppressed_reason === 'unsubscribe' && r.suppressed_at && (queued === null || Date.parse(r.suppressed_at) >= queued)) {
      out.unsubscribed += 1;
    }
    const after = r.sent_at ?? queuedAt;
    const lastIn = lastInByConversation.get(r.conversation_id);
    if (LEFT.has(r.status) && after && lastIn && Date.parse(lastIn) > Date.parse(after)) out.replies += 1;
  }
  return out;
}

/** El último envío del alcance, como lo devuelve el dashboard. */
export interface LastMailout {
  id: string;
  workspace_id: string;
  subject: string | null;
  from_address: string | null;
  status: string;
  queued_at: string | null;
  figures: MailoutFigures;
}

/** `GET /api/conversations/overview`. */
export interface OverviewResponse extends ConversationOverview {
  last_mailout: LastMailout | null;
  /** Hilos del equipo con mensajes nuevos («Del equipo»): los primeros y cuántos son. */
  team: { count: number; threads: FeedThread[]; authors: Record<string, string> };
}
