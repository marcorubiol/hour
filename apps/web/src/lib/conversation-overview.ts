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
 * Ninguna regla lee `conversation.status`: lee la relación derivada
 * (`relationOf`, ADR-138 § 4). «No esta vez» saca una conversación de todo
 * bloque, del turno y de los envíos mientras dura.
 *
 * - **Te toca**: el último correo, mensaje o llamada con dirección es de fuera
 *   (`inbound`), no le hemos contestado y no se marcó «no pide respuesta»;
 *   detrás, los seguimientos vencidos (ADR-126 § 1).
 * - **Caliente**: una sala que ha contestado con actividad en 14 días, o
 *   cualquiera que nos escribió en 14 días.
 * - **Se enfría**: nuestro último correo sin respuesta hace 21 días o más; o
 *   una conversación con respuesta sin nada en 30. En dos grupos (ADR-126 § 8):
 *   las que no contestaron al envío (segunda ronda, en bloque) y las paradas
 *   (las que contestaron alguna vez: una a una).
 * - **La temporada**: de septiembre a agosto por fecha de función; una
 *   conversación sin funciones es de la temporada en curso (está en difusión).
 *   Cuenta relaciones y, aparte, los bolos de la temporada en opción y firmes
 *   (ADR-138 § 3). Con dos líneas de trabajo o más (contando «sin línea»), una
 *   barra por línea (ADR-135).
 */

import {
  RELATIONS,
  countBolos,
  daysSince,
  hasAnswered,
  isRelation,
  lastActivity,
  relationOf,
  type BoloCounts,
  type Relation,
  type RelationInput,
} from './conversation-relation';

export { daysSince, hasAnswered, lastActivity };

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
const FOLLOW_UP_ROWS = 2;

/** Las filas de «Se enfría»: las paradas primero, y siempre sitio para la segunda ronda. */
function coldBlockRows<R extends OverviewInput>(sorted: readonly R[], now: Date, size = BLOCK_ROWS): R[] {
  const stalled = sorted.filter((r) => coolingOf(r, now)?.group === 'stalled');
  const round = sorted.filter((r) => coolingOf(r, now)?.group === 'round');
  const stalledRows = Math.min(stalled.length, size - Math.min(round.length, FOLLOW_UP_ROWS));
  return [...stalled.slice(0, stalledRows), ...round.slice(0, size - stalledRows)];
}

/** Las filas de «Te toca»: respuestas y, con sitio guardado, seguimientos. */
function dueBlockRows<R extends OverviewInput>(sorted: readonly R[], now: Date, size = BLOCK_ROWS): R[] {
  const replies = sorted.filter((r) => dueReason(r, now) === 'reply');
  const followUps = sorted.filter((r) => dueReason(r, now) === 'follow_up');
  const replyRows = Math.min(replies.length, size - Math.min(followUps.length, FOLLOW_UP_ROWS));
  return [...replies.slice(0, replyRows), ...followUps.slice(0, size - replyRows)];
}
const HOT_ROWS = 6;

/** Los canales que cuentan para el turno: una nota no es una interacción. */
export const TURN_KINDS = ['email', 'message', 'call'] as const;

/**
 * Ni te toca, ni tiene turno, ni se enfría: «no esta vez» en vigor. Lo que
 * quede pendiente de una sala que dijo que no se apunta como fecha de volver.
 */
function closed(row: RelationInput, now: Date): boolean {
  return relationOf(row, now) === 'not_now';
}

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
  /** El nombre de su línea, si la tiene y se puede leer. */
  line_name?: string | null;
  not_now_at: string | null;
  not_now_until: string | null;
  last_contacted_at: string | null;
  first_contacted_at: string | null;
  contacted_undated: boolean;
  legacy_status?: string | null;
  regular?: boolean | null;
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
  /** Sus bolos (`conversations_bolos`): estado y primera función viva, sin dinero. */
  bolos?: { status: string; first_performed_at: string | null }[];
}

// ── Turno ──────────────────────────────────────────────────────────────────

type TurnSide = 'ours' | 'theirs';

/** Lo que el turno lee: la relación (por «no esta vez») y lo atendido. */
type TurnRow = RelationInput & Pick<OverviewInput, 'reply_settled_at'>;

export interface Turn {
  side: TurnSide;
  since: string;
  days: number;
}

/**
 * De quién es el turno: de quien no escribió el último. Una conversación en
 * «no esta vez» no tiene turno, ni una cuyo último correo de fuera se marcó
 * «no pide respuesta» (el «perfecto, quedamos así», ADR-126 § 1).
 */
export function turnOf(row: TurnRow, now: Date): Turn | null {
  if (!row.last || closed(row, now)) return null;
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

/** Un seguimiento apuntado para hoy o antes, en una conversación que no está en «no esta vez». */
export function followUpDue(row: RelationInput & Pick<OverviewInput, 'next_action_at'>, now: Date): boolean {
  return Boolean(row.next_action_at) && !closed(row, now) && daysSince(row.next_action_at!.slice(0, 10), now) >= 0;
}

type DueReason = 'reply' | 'follow_up';

/** Por qué te toca, o null: primero una respuesta pendiente, después un seguimiento. */
export function dueReason(row: TurnRow & Pick<OverviewInput, 'next_action_at'>, now: Date): DueReason | null {
  if (turnOf(row, now)?.side === 'ours') return 'reply';
  return followUpDue(row, now) ? 'follow_up' : null;
}

// ── Temperatura ───────────────────────────────────────────────────────────

export function isHot(row: RelationInput, now: Date): boolean {
  if (closed(row, now)) return false;
  if (row.last_in && daysSince(row.last_in.occurred_at, now) <= HOT_DAYS) return true;
  const activity = lastActivity(row);
  return hasAnswered(row) && activity !== null && daysSince(activity, now) <= HOT_DAYS;
}

type CoolingReason = 'no_reply' | 'idle';
/** `round`: no contestó al envío, se recupera con otro; `stalled`: se hablaba de algo, una a una. */
type CoolingGroup = 'round' | 'stalled';

interface Cooling {
  reason: CoolingReason;
  days: number;
  group: CoolingGroup;
}

/**
 * Sin fecha de contacto: se habló (contactada sin fecha, o su estado viejo lo
 * decía), sin ningún evento, sin sello de contacto y sin seguimiento apuntado
 * (lo importado de antes del historial). No se enfría ni te toca: no sabemos
 * cuándo se habló. Se cuenta aparte, en una línea del dashboard con su filtro
 * (`?temp=sin-fecha`; ADR-126 § 8; en `muk-cia` son 151 de 152). Una que
 * nunca se contactó no está «sin fecha»: no hay nada que fechar.
 */
export function isUndated(row: RelationInput & Pick<OverviewInput, 'next_action_at'>, now: Date): boolean {
  return (
    !closed(row, now) &&
    (row.contacted_undated || hasAnswered(row)) &&
    !row.last &&
    lastActivity(row) === null &&
    !row.next_action_at
  );
}

/**
 * Se enfría: le tocaba a la sala y no contesta (nuestro último correo, 21 días),
 * o la conversación abierta lleva 30 días parada. Si te toca a ti, no se enfría:
 * es tuya. Una conversación «contactada» sin ningún evento (de antes del
 * historial, ADR-098) cuenta su sello de contacto como nuestro último correo.
 * Sin ninguna fecha no se enfría: no lo sabemos (`undated`, aparte).
 */
export function coolingOf(row: TurnRow & Pick<OverviewInput, 'next_action_at'>, now: Date): Cooling | null {
  if (closed(row, now)) return null;
  const answered = hasAnswered(row);
  const group: CoolingGroup = answered ? 'stalled' : 'round';
  const turn = turnOf(row, now);
  // Te toca (una respuesta o un seguimiento vencido): es tuya, no se enfría.
  if (turn?.side === 'ours' || followUpDue(row, now)) return null;
  if (turn?.side === 'theirs' && turn.days >= COLD_REPLY_DAYS) return { reason: 'no_reply', days: turn.days, group };
  if (!row.last && !answered && row.last_contacted_at) {
    const days = daysSince(row.last_contacted_at, now);
    if (days >= COLD_REPLY_DAYS) return { reason: 'no_reply', days, group };
  }
  const activity = lastActivity(row);
  if (answered && activity) {
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

export type RelationCounts = Record<Relation, number>;

export function countByRelation(rows: readonly RelationInput[], now: Date): RelationCounts {
  const out = Object.fromEntries(RELATIONS.map((s) => [s, 0])) as RelationCounts;
  for (const r of rows) out[relationOf(r, now)] += 1;
  return out;
}

/**
 * Los bolos de la temporada de unas conversaciones, en opción y firmes. La
 * temporada de un bolo es la de su primera función viva (ADR-131); uno sin
 * funciones todavía es de la temporada en curso, como una conversación.
 */
function seasonBoloCounts(rows: readonly Pick<OverviewInput, 'bolos'>[], season: Season): BoloCounts {
  return countBolos(
    rows.flatMap((r) => r.bolos ?? []).filter(
      (b) => !b.first_performed_at || (b.first_performed_at >= season.start && b.first_performed_at <= season.end),
    ),
  );
}

// ── La temporada por línea (ADR-135) ───────────────────────────────────────

/** El valor de `?linea=` para las conversaciones sin línea. */
export const NO_LINE = 'sin';

export interface SeasonLine {
  /** null: las que no tienen línea, juntas («sin línea»). */
  line_id: string | null;
  name: string | null;
  total: number;
  counts: RelationCounts;
  answered: number;
  bolos: BoloCounts;
}

/**
 * La temporada repartida por línea: la de más conversaciones arriba (a igual,
 * por nombre) y «sin línea» siempre al final, nunca escondida. Con una sola
 * línea o ninguna no hay reparto (lista vacía): el bloque es una barra.
 */
export function seasonByLine(rows: readonly OverviewInput[], now: Date, season: Season = currentSeason(now)): SeasonLine[] {
  const by = new Map<string | null, (typeof rows)[number][]>();
  for (const r of rows) by.set(r.line_id, [...(by.get(r.line_id) ?? []), r]);
  if (by.size < 2) return [];
  return [...by.entries()]
    .map(([line_id, list]) => ({
      line_id,
      name: line_id === null ? null : (list.find((r) => r.line_name)?.line_name ?? null),
      total: list.length,
      counts: countByRelation(list, now),
      answered: list.filter(hasAnswered).length,
      bolos: seasonBoloCounts(list, season),
    }))
    .sort(
      (a, b) =>
        Number(a.line_id === null) - Number(b.line_id === null) ||
        b.total - a.total ||
        (a.name ?? '').localeCompare(b.name ?? ''),
    );
}

/** Las de una línea (`NO_LINE`: las que no tienen). */
function lineRows<R extends Pick<OverviewInput, 'line_id'>>(rows: readonly R[], linea: string): R[] {
  return rows.filter((r) => (linea === NO_LINE ? r.line_id === null : r.line_id === linea));
}

// ── Los filtros de la lista ────────────────────────────────────────────────

type TurnFilter = 'nuestro' | 'suyo';
/** `ronda` y `parada`: los dos grupos de «se enfría» (ADR-126 § 8). */
export type TempFilter = 'caliente' | 'fria' | 'ronda' | 'parada' | 'sin-fecha';
const TEMP_FILTERS: readonly string[] = ['caliente', 'fria', 'ronda', 'parada', 'sin-fecha'];

/** Las cifras del último envío que llevan a alguien (ADR-126 § 9). */
export type MailoutPick = 'respuestas' | 'rebotes';

export interface ListFilter {
  turno?: TurnFilter;
  temp?: TempFilter;
  /** Solo las de la temporada en curso (la barra de la temporada filtra con esto). */
  temporada?: boolean;
  /** Una línea de la temporada (su uuid, o `NO_LINE`): solo con `temporada`. */
  linea?: string;
  /** Un envío y cuáles de sus destinatarios: las que contestaron, o las que rebotaron. */
  envio?: string;
  r?: MailoutPick;
  /** Una relación (la barra de la temporada filtra con esto, ADR-138). */
  relacion?: Relation;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function parseListFilter(params: URLSearchParams): ListFilter {
  const turno = params.get('turno');
  const temp = params.get('temp');
  const temporada = params.get('temporada') === 'actual' || undefined;
  const relacion = params.get('relacion');
  return {
    relacion: isRelation(relacion) ? relacion : undefined,
    turno: turno === 'nuestro' || turno === 'suyo' ? turno : undefined,
    temp: temp && TEMP_FILTERS.includes(temp) ? (temp as TempFilter) : undefined,
    temporada,
    linea: temporada ? parseLinea(params.get('linea')) : undefined,
    ...mailoutFilter(params),
  };
}

export function parseLinea(raw: string | null | undefined): string | undefined {
  return raw === NO_LINE || (raw && UUID_RE.test(raw)) ? raw : undefined;
}

function mailoutFilter(params: URLSearchParams): Pick<ListFilter, 'envio' | 'r'> {
  const envio = params.get('envio');
  const r = params.get('r');
  if (!envio || !UUID_RE.test(envio) || (r !== 'respuestas' && r !== 'rebotes')) return {};
  return { envio, r };
}

export function hasListFilter(f: ListFilter): boolean {
  return Boolean(f.turno || f.temp || f.temporada || f.envio || f.relacion);
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
  if (f.temporada && f.linea) out = lineRows(out, f.linea);
  if (f.relacion) out = out.filter((r) => relationOf(r, now) === f.relacion);
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
  if (f.temp === 'sin-fecha') out = out.filter((r) => isUndated(r, now));
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

/** Paradas primero (se recuperan una a una), y dentro la más fría. */
function sortCold<R extends OverviewInput>(rows: R[], now: Date): R[] {
  const key = (r: R) => {
    const c = coolingOf(r, now)!;
    return [c.group === 'stalled' ? 0 : 1, -c.days];
  };
  return rows.sort((a, b) => {
    const [ga, da] = key(a);
    const [gb, db] = key(b);
    return ga - gb || da - db;
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
  relation: Relation;
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
  days: number;
  group: CoolingGroup;
  subject: string | null;
}

export interface Block<T> {
  count: number;
  rows: T[];
}

export interface ConversationOverview {
  /** Conversaciones del alcance (todas las no borradas). */
  total: number;
  /** Las que siguen vivas: sin «no esta vez» ni dormidas. */
  live: number;
  season: {
    label: string;
    start: string;
    end: string;
    total: number;
    counts: RelationCounts;
    /** Los bolos de la temporada, en opción y firmes (la puerta del Desk lee `option`). */
    bolos: BoloCounts;
    /** Las que han contestado algo: nos escribieron, o su estado lo implica. */
    answered: number;
    /** Una por línea, con dos o más (contando «sin línea»); vacía, una sola barra (ADR-135). */
    lines: SeasonLine[];
  };
  due: Block<DueRow>;
  hot: Block<HotRow>;
  /**
   * `picks`: las de segunda ronda, para «Escribir a estas» (con su proyecto: un
   * envío es de uno). Las paradas no van en bloque. `round`/`stalled`: cuántas
   * hay de cada grupo.
   */
  cold: Block<ColdRow> & { round: number; stalled: number; picks: { id: string; project_id: string }[] };
  /** Abiertas sin ninguna fecha de contacto: fuera de todo bloque, contadas aparte. */
  undated: number;
}

function blockRow(r: OverviewInput, now: Date): BlockRow {
  return {
    id: r.id,
    workspace_id: r.workspace_id,
    project_id: r.project_id,
    title: r.title,
    person: r.person,
    relation: relationOf(r, now),
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
    live: rows.filter((r) => !['not_now', 'dormant'].includes(relationOf(r, now))).length,
    season: {
      ...season,
      total: inSeasonRows.length,
      counts: countByRelation(inSeasonRows, now),
      bolos: seasonBoloCounts(inSeasonRows, season),
      answered: inSeasonRows.filter(hasAnswered).length,
      lines: seasonByLine(inSeasonRows, now, season),
    },
    due: {
      count: due.length,
      rows: dueBlockRows(due, now).map((r) => {
        const reason = dueReason(r, now)!;
        const at = reason === 'reply' ? r.last!.occurred_at : r.next_action_at!.slice(0, 10);
        return {
          ...blockRow(r, now),
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
        return { ...blockRow(r, now), at, days: at ? daysSince(at, now) : null, turn: turnOf(r, now)?.side ?? null };
      }),
    },
    cold: {
      count: cold.length,
      rows: coldBlockRows(cold, now).map((r) => {
        const c = coolingOf(r, now)!;
        return {
          ...blockRow(r, now),
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
    undated: rows.filter((r) => isUndated(r, now)).length,
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

/** Contestó a este envío: salió, y su último correo de fuera es posterior. */
export function mailoutReplied(
  r: MailoutRecipientLite,
  queuedAt: string | null,
  lastInByConversation: ReadonlyMap<string, string>,
): boolean {
  const after = r.sent_at ?? queuedAt;
  const lastIn = lastInByConversation.get(r.conversation_id);
  return LEFT.has(r.status) && Boolean(after) && Boolean(lastIn) && Date.parse(lastIn!) > Date.parse(after!);
}

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
    if (mailoutReplied(r, queuedAt, lastInByConversation)) out.replies += 1;
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
  /** Sent through the simulator (ADR-111): its figures are not real. */
  simulated: boolean;
}

/** `GET /api/conversations/overview`. */
export interface OverviewResponse extends ConversationOverview {
  last_mailout: LastMailout | null;
}
