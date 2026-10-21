/**
 * Añadir al plan, sin pantalla (ADR-139 p3 A): el esqueleto común, lo que se
 * deduce antes de preguntar y cómo el único control «Cuándo» se convierte en
 * filas. El diálogo (`create/CreateEventDialog.svelte`) dibuja; esto decide.
 *
 * EL ESQUELETO, IGUAL PARA LOS OCHO TIPOS: Qué · Cuándo · Dónde · Más. El tipo
 * no cambia el orden ni la forma, solo qué líneas hay dentro de cada bloque
 * (`skeletonFor`). Y UN SOLO CONTROL DE FECHA: un día, y si hace falta «+ hora»,
 * «+ hasta» y «+ repetir». Desaparecen «Todo el día», «Varios días», «Fin» y la
 * fecha pedida dos veces: Hour decide por dentro si es una fila con fin o una
 * tanda (`planWhen`).
 *
 * La línea del título es UNA línea de texto libre cuyo destino depende del tipo
 * (`skeletonFor(type).title`). Entiende texto (`quick-line`): «ensayo jue
 * 10-14 Mercat» reparte lo que lee en las fichas y deja el resto de título.
 */

import { blockDays, blockLimit } from './block';
import { addDaysIso } from './planner';
import { hourMark, localeDayMonth, localeWeekdayShort, wallClockToInstant } from './datetime';
import type { TravelDirection } from './date';
import type { PerformanceCreate, PerformanceSeriesCreate, PerformanceStatus } from './performance';

/** The seven kinds of the calendar, in pill order (ADR-078 §1). */
export const EVENT_TYPE_KEYS = [
  'performance',
  'rehearsal',
  'travel_day',
  'day_off',
  'residency',
  'press',
  'other',
] as const;
export type EventTypeKey = (typeof EVENT_TYPE_KEYS)[number];

/**
 * The six `date` kinds — the list minus the performance, which is not a date
 * row. Editar fecha draws the same words (a date can change kind, never become
 * a performance), so the order and the words stay one decision in one place.
 */
export type DateTypeKey = Exclude<EventTypeKey, 'performance'>;
export const DATE_TYPE_KEYS = EVENT_TYPE_KEYS.filter((k): k is DateTypeKey => k !== 'performance');

/** One home for what a kind is called. */
export const TYPE_LABEL_KEYS: Record<EventTypeKey | 'unavailable', string> = {
  performance: 'create.type_performance',
  rehearsal: 'create.type_rehearsal',
  travel_day: 'create.type_travel',
  day_off: 'create.type_day_off',
  residency: 'create.type_residency',
  press: 'create.type_press',
  other: 'create.type_other',
  unavailable: 'create.type_unavailable',
};

/** Lo que se pone en el plan: los siete de siempre y la indisponibilidad. */
export type QuickType = EventTypeKey | 'unavailable';

/** A la vista; el resto, bajo «Otro». Una parada de Tab cada grupo. */
export const QUICK_PRIMARY = ['performance', 'rehearsal', 'travel_day', 'unavailable'] as const;
export const QUICK_MORE = ['residency', 'day_off', 'press', 'other'] as const;

export function isMoreType(type: QuickType): boolean {
  return (QUICK_MORE as readonly string[]).includes(type);
}

/** La certeza tiene una sola forma en el alta: «Opción · Confirmado». */
export type Certainty = 'option' | 'confirmed';
export const CERTAINTIES = ['option', 'confirmed'] as const;

export type Skeleton = {
  /** Qué escribe la línea grande: la sala de una función, el título de una
      fecha, la nota de una indisponibilidad. */
  title: 'venue' | 'title' | 'note';
  when: {
    /** «+ hora»: una función no lleva horas al crearse (ADR-090 P3), ni un
        día libre, ni una indisponibilidad (son días). */
    hours: boolean;
    /** Nace con la hora puesta (un ensayo es a una hora; un viaje, un día). */
    hoursOpen: boolean;
    /** «+ hasta» ya abierto: residencia, día off e indisponibilidad suelen
        durar más de un día. */
    untilOpen: boolean;
    /** «+ repetir» (días de la semana): una tanda. Un viaje no (la tanda no
        lleva dirección), una indisponibilidad tampoco (es un tramo). */
    repeat: boolean;
  };
  where: 'venue' | 'place' | 'trip' | 'none';
  /** De quién es: un proyecto, o (indisponibilidad) una persona de un espacio. */
  owner: 'project' | 'person';
  more: {
    line: boolean;
    attach: boolean;
    bolo: boolean;
    label: boolean;
    rank: boolean;
  };
};

export function skeletonFor(type: QuickType): Skeleton {
  const date = (over: Partial<Skeleton['when']> = {}): Skeleton['when'] => ({
    hours: true,
    hoursOpen: false,
    untilOpen: false,
    repeat: true,
    ...over,
  });
  const more = (over: Partial<Skeleton['more']> = {}): Skeleton['more'] => ({
    line: true,
    attach: true,
    bolo: false,
    label: false,
    rank: false,
    ...over,
  });
  switch (type) {
    case 'performance':
      return {
        title: 'venue',
        when: date({ hours: false }),
        where: 'venue',
        owner: 'project',
        more: more({ attach: false, bolo: true, rank: true }),
      };
    case 'rehearsal':
    case 'press':
      return { title: 'title', when: date({ hoursOpen: true }), where: 'place', owner: 'project', more: more() };
    case 'other':
      return {
        title: 'title',
        when: date({ hoursOpen: true }),
        where: 'place',
        owner: 'project',
        more: more({ label: true }),
      };
    case 'residency':
      return { title: 'title', when: date({ hours: false, untilOpen: true }), where: 'place', owner: 'project', more: more() };
    case 'day_off':
      return { title: 'title', when: date({ hours: false, untilOpen: true }), where: 'none', owner: 'project', more: more() };
    case 'travel_day':
      return { title: 'title', when: date({ repeat: false }), where: 'trip', owner: 'project', more: more() };
    case 'unavailable':
      return {
        title: 'note',
        when: { hours: false, hoursOpen: false, untilOpen: true, repeat: false },
        where: 'none',
        owner: 'person',
        more: { line: false, attach: false, bolo: false, label: false, rank: false },
      };
  }
}

/* ── Cuándo ─────────────────────────────────────────────────────────── */

export type When = {
  /** ISO day: siempre hay uno (el de la vista). */
  day: string;
  /** «+ hasta»: vacío o igual al día es un solo día. */
  until: string;
  until_on: boolean;
  /** «+ hora». */
  timed: boolean;
  start: string;
  end: string;
  /** «+ repetir»: qué días de la semana del tramo (JS getDay()). */
  repeat: boolean;
  weekdays: number[];
  exceptions: string[];
};

export const ALL_WEEKDAYS = [0, 1, 2, 3, 4, 5, 6];

export type WhenError = { field: 'day' | 'until' | 'end' | 'repeat'; key: string };

/** Lo que el control de fecha dice, en filas. */
export type WhenPlan =
  | { shape: 'one'; starts_at: string; ends_at: string | null; all_day: boolean; days: string[] }
  | { shape: 'series'; starts: string[]; ends: string[] | null; all_day: boolean; days: string[] }
  | { shape: 'range'; from: string; to: string; days: string[] }
  | { shape: 'error'; error: WhenError };

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
const midnight = (day: string) => `${day}T00:00:00.000Z`;

/** Los días que cubre el tramo, con la regla de repetir si está puesta. */
export function whenDays(when: When): string[] {
  const hasUntil = when.until_on && ISO_DAY.test(when.until) && when.until > when.day;
  if (!hasUntil) return ISO_DAY.test(when.day) ? [when.day] : [];
  return blockDays({
    from: when.day,
    to: when.until,
    weekdays: when.repeat ? when.weekdays : ALL_WEEKDAYS,
    exceptions: when.repeat ? when.exceptions : [],
  });
}

/**
 * El único control de fecha, convertido en lo que el servidor escribe. Hour
 * decide la forma, no la persona:
 * - Una indisponibilidad es siempre un tramo (desde, hasta).
 * - Un día solo es una fila.
 * - Varios días SIN hora y sin regla de días son UNA fila con fin (una
 *   residencia del 16 al 19), salvo una función, que es de un día: la suya es
 *   una tanda (ADR-084 §1).
 * - Varios días CON hora, o con «repetir», son una tanda: cada día a su hora,
 *   cada uno convertido por su cuenta (un salto de horario no lo descuadra).
 * - Un viaje de varios días es una fila de días enteros (la tanda no lleva
 *   dirección).
 *
 * Una hora escrita es hora local del espacio (ADR-078 §11): `tz`.
 */
export function planWhen(type: QuickType, when: When, tz: string): WhenPlan {
  const fail = (field: WhenError['field'], key: string): WhenPlan => ({ shape: 'error', error: { field, key } });
  if (!ISO_DAY.test(when.day)) return fail('day', 'create.pick_start');
  if (when.until_on && when.until && (!ISO_DAY.test(when.until) || when.until < when.day)) {
    return fail('until', 'create.end_before_start');
  }
  const sk = skeletonFor(type);
  const hasUntil = when.until_on && when.until > when.day;
  const timed = sk.when.hours && when.timed && !(type === 'travel_day' && hasUntil);

  if (type === 'unavailable') {
    const to = hasUntil ? when.until : when.day;
    return { shape: 'range', from: when.day, to, days: whenDays({ ...when, repeat: false }) };
  }

  const days = whenDays({ ...when, repeat: sk.when.repeat && when.repeat });
  if (hasUntil) {
    const limit = blockLimit(days.length);
    if (limit === 'too_many') return fail('repeat', 'block.too_many');
    if (days.length === 0) return fail('repeat', 'block.too_few');
  }

  const series = hasUntil && days.length > 1 && (type === 'performance' || timed || (sk.when.repeat && when.repeat));

  if (timed) {
    if (!/^\d{2}:\d{2}$/.test(when.start)) return fail('end', 'create.pick_start');
    if (when.end && when.end < when.start) return fail('end', 'create.end_before_start');
    const at = (day: string, clock: string) => wallClockToInstant(`${day}T${clock}`, tz);
    const starts = days.map((d) => at(d, when.start));
    const ends = when.end ? days.map((d) => at(d, when.end)) : null;
    if (starts.some((s) => !s) || ends?.some((e) => !e)) return fail('end', 'create.pick_start');
    if (series) {
      return { shape: 'series', starts: starts as string[], ends: ends as string[] | null, all_day: false, days };
    }
    return { shape: 'one', starts_at: starts[0]!, ends_at: ends?.[0] ?? null, all_day: false, days };
  }

  if (series) {
    return { shape: 'series', starts: days.map(midnight), ends: null, all_day: true, days };
  }
  // Un solo día, o un tramo de días enteros en una fila (con la regla de días
  // reducida a un solo día, ese día).
  const first = days[0] ?? when.day;
  const last = hasUntil && !(sk.when.repeat && when.repeat) ? when.until : first;
  return {
    shape: 'one',
    starts_at: midnight(first),
    ends_at: last > first ? midnight(last) : null,
    all_day: true,
    days: hasUntil && !(sk.when.repeat && when.repeat) ? days : [first],
  };
}

/* ── Deducir antes de preguntar ─────────────────────────────────────── */

/**
 * El proyecto sin preguntar: el del ámbito fijado; si no, el único; si no, el
 * último con el que se añadió algo (si sigue activo). Si nada de eso, se
 * pregunta.
 */
export function deduceProject(opts: {
  preset: string | null;
  projectIds: readonly string[];
  last?: string | null;
}): string {
  if (opts.preset) return opts.preset;
  if (opts.projectIds.length === 1) return opts.projectIds[0];
  if (opts.last && opts.projectIds.includes(opts.last)) return opts.last;
  return '';
}

/**
 * El espacio de una indisponibilidad: el del proyecto elegido; si no, el que
 * fija el ámbito; si no, el único. Una indisponibilidad nunca se reparte.
 */
export function deduceWorkspace(opts: {
  projectWorkspace: string | null;
  preset: string | null;
  workspaceIds: readonly string[];
}): string {
  if (opts.projectWorkspace && opts.workspaceIds.includes(opts.projectWorkspace)) return opts.projectWorkspace;
  if (opts.preset) return opts.preset;
  return opts.workspaceIds.length === 1 ? opts.workspaceIds[0] : '';
}

/** Quien marca la indisponibilidad suele ser quien no puede: yo, si estoy en
    el equipo de ese espacio; si no, toda la compañía (vacío). */
export function deducePerson(
  me: string | null,
  team: readonly { person_id: string; workspace_id: string }[],
  workspaceId: string,
): string {
  if (!me) return '';
  return team.some((m) => m.person_id === me && m.workspace_id === workspaceId) ? me : '';
}

export type NearPerformance = {
  id: string;
  performed_at: string;
  city: string | null;
  venue_name: string | null;
};

export type TripGuess = {
  direction: TravelDirection;
  origin: string;
  destination: string;
  performance_id: string;
};

/** Cuántos días alrededor de un viaje se mira para encontrar su función. */
export const TRIP_WINDOW_DAYS = 3;

/**
 * Un viaje va hacia una función o vuelve de ella. La más cercana del proyecto
 * en los días siguientes (o el mismo): ida, con su ciudad de destino. Si no hay
 * ninguna después pero sí antes: vuelta, desde su ciudad. Si no hay ninguna
 * cerca, no se adivina.
 */
export function deduceTrip(day: string, perfs: readonly NearPerformance[]): TripGuess | null {
  if (!ISO_DAY.test(day)) return null;
  const ahead = addDaysIso(day, TRIP_WINDOW_DAYS);
  const behind = addDaysIso(day, -TRIP_WINDOW_DAYS);
  const sorted = [...perfs].sort((a, b) => (a.performed_at < b.performed_at ? -1 : 1));
  const next = sorted.find((p) => p.performed_at.slice(0, 10) >= day && p.performed_at.slice(0, 10) <= ahead);
  if (next) {
    return { direction: 'outbound', origin: '', destination: next.city ?? '', performance_id: next.id };
  }
  const prev = [...sorted]
    .reverse()
    .find((p) => p.performed_at.slice(0, 10) < day && p.performed_at.slice(0, 10) >= behind);
  if (prev) {
    return { direction: 'return', origin: prev.city ?? '', destination: '', performance_id: prev.id };
  }
  return null;
}

/** Lo deducido solo llena lo vacío: lo escrito a mano manda. */
export function fillEmpty<T extends Record<string, string>>(current: T, guess: Partial<T>): T {
  const out = { ...current };
  for (const key of Object.keys(guess) as (keyof T)[]) {
    const v = guess[key];
    if (typeof v === 'string' && v && !String(current[key] ?? '').trim()) out[key] = v as T[keyof T];
  }
  return out;
}

/* ── Certeza ────────────────────────────────────────────────────────── */

/** Una fecha y una función nacen como opción (ADR-095 §7); quien marca que no
    puede, lo marca en firme. */
export function defaultCertainty(type: QuickType): Certainty {
  return type === 'unavailable' ? 'confirmed' : 'option';
}

/** El estado de la función: opción (con su rango, si lo hay) o confirmada. */
export function performanceStatus(c: Certainty, rank: '' | '1' | '2' | '3'): PerformanceStatus {
  if (c === 'confirmed') return 'confirmed';
  return rank ? (`hold_${rank}` as const) : 'hold';
}

export function dateStatus(c: Certainty): 'tentative' | 'confirmed' {
  return c === 'option' ? 'tentative' : 'confirmed';
}

export function availabilityCertainty(c: Certainty): 'tentative' | 'unavailable' {
  return c === 'option' ? 'tentative' : 'unavailable';
}

/* ── El borrador ────────────────────────────────────────────────────── */

export type Draft = {
  type: QuickType;
  /** La línea tal como se escribe (`quick-line`): de ella salen el título y
      lo que se reconoce. */
  said: string;
  /** Lo que la línea no reconoció: lo que se guarda como título. */
  title: string;
  project: string;
  line: string;
  when: When;
  venue: string;
  city: string;
  origin: string;
  direction: TravelDirection;
  performance: string;
  bolo: string;
  label: string;
  certainty: Certainty;
  rank: '' | '1' | '2' | '3';
  notice: number | null;
  workspace: string;
  person: string;
};

export function freshDraft(day: string, type: QuickType = 'performance'): Draft {
  const sk = skeletonFor(type);
  return {
    type,
    said: '',
    title: '',
    project: '',
    line: '',
    when: {
      day,
      until: '',
      until_on: sk.when.untilOpen,
      timed: sk.when.hoursOpen,
      start: '10:00',
      end: '',
      repeat: false,
      weekdays: [...ALL_WEEKDAYS],
      exceptions: [],
    },
    venue: '',
    city: '',
    origin: '',
    direction: 'outbound',
    performance: '',
    bolo: '',
    label: '',
    certainty: defaultCertainty(type),
    rank: '',
    notice: null,
    workspace: '',
    person: '',
  };
}

/**
 * ¿Hay algo escrito? Solo lo que la persona teclea o fija a mano cuenta: lo
 * que Hour propone (proyecto, día, bolo) no hace borrador. Con borrador, cerrar
 * no lo tira: vuelve al reabrir, con «Descartar» a la vista.
 */
export function draftWritten(d: Draft): boolean {
  const text = [d.said, d.title, d.venue, d.city, d.origin, d.label].some((s) => s.trim() !== '');
  return text || Boolean(d.when.until_on && d.when.until) || d.when.repeat;
}

/**
 * Cambiar de tipo conserva lo escrito y abre lo que el tipo nuevo abre por
 * defecto, sin cerrar lo que la persona abrió. La certeza vuelve a la del tipo
 * solo si no se había tocado (la de partida del anterior).
 */
export function switchType(d: Draft, next: QuickType): Draft {
  if (d.type === next) return d;
  const was = skeletonFor(d.type);
  const sk = skeletonFor(next);
  const when: When = {
    ...d.when,
    // An open «hasta» left empty goes with the type that opened it.
    until_on: sk.when.untilOpen || (d.when.until_on && d.when.until !== ''),
    timed: sk.when.hours ? d.when.timed || (sk.when.hoursOpen && !was.when.hours) : false,
    repeat: sk.when.repeat ? d.when.repeat : false,
  };
  // La línea grande sigue diciendo lo mismo: si pasa de ser la sala a ser el
  // título (o al revés), el texto se queda en la línea.
  const certainty = d.certainty === defaultCertainty(d.type) ? defaultCertainty(next) : d.certainty;
  return { ...d, type: next, when, certainty };
}

/** Tras añadir: se queda el tipo, el proyecto y la certeza (la gira de otoño
    son cinco funciones seguidas); lo demás vuelve a empezar en el mismo día. */
export function afterCreate(d: Draft): Draft {
  const next = freshDraft(d.when.day, d.type);
  return {
    ...next,
    project: d.project,
    line: d.line,
    workspace: d.workspace,
    person: d.person,
    certainty: d.certainty,
  };
}

/* ── Lo que se manda ────────────────────────────────────────────────── */

const orNull = (s: string) => s.trim() || null;

/** POST /api/performances(/series): una función, o la tanda si son varios días. */
export function performanceBody(
  d: Draft,
  plan: Extract<WhenPlan, { shape: 'one' | 'series' }>,
): PerformanceCreate | PerformanceSeriesCreate {
  const days = plan.days;
  const common = {
    project_id: d.project,
    venue_name: orNull(d.title),
    city: orNull(d.city),
    status: performanceStatus(d.certainty, d.rank),
    line_id: d.line || null,
    bolo_id: d.bolo || null,
  };
  return days.length > 1 ? { ...common, performed_at: days } : { ...common, performed_at: days[0] };
}

/**
 * POST /api/dates o /api/dates/series. Lo propio de cada tipo va solo en el
 * suyo: el servidor rechaza una dirección en un ensayo, y una etiqueta fuera
 * de «Otros» (por diseño). Un viaje guarda su destino también en `city`, que
 * es lo que leen las bandas de ausencia (ADR-089).
 */
export function dateBody(
  d: Draft,
  plan: Extract<WhenPlan, { shape: 'one' | 'series' }>,
): { series: boolean; body: Record<string, unknown> } {
  const isTrip = d.type === 'travel_day';
  const common: Record<string, unknown> = {
    project_id: d.project,
    kind: d.type,
    all_day: plan.all_day,
    title: orNull(d.title),
    venue_name: isTrip ? null : orNull(d.venue),
    city: orNull(d.city),
    status: dateStatus(d.certainty),
    line_id: d.line || null,
  };
  if (d.type === 'other') common.label = orNull(d.label);
  if (plan.shape === 'series') {
    return { series: true, body: { ...common, starts: plan.starts, ends: plan.ends } };
  }
  const body: Record<string, unknown> = {
    ...common,
    starts_at: plan.starts_at,
    ends_at: plan.ends_at,
    performance_id: d.performance || null,
  };
  if (isTrip) {
    body.travel_direction = d.direction;
    body.origin_city = orNull(d.origin);
    body.destination_city = orNull(d.city);
  }
  return { series: false, body };
}

/** POST /api/availability: un tramo, de una persona o de toda la compañía. */
export function availabilityBody(d: Draft, plan: Extract<WhenPlan, { shape: 'range' }>) {
  return {
    workspace_id: d.workspace,
    person_id: d.person || null,
    starts_on: plan.from,
    ends_on: plan.to,
    certainty: availabilityCertainty(d.certainty),
    note: orNull(d.title),
  };
}

/* ── Lo que dice la ficha de «Cuándo» ───────────────────────────────── */

/**
 * «sáb 14 nov», «14 – 19 nov», «jue 12 nov · 10h–14h», «2 – 30 nov · 9 días».
 * Una línea, para la ficha; el detalle está al abrirla.
 */
export function whenLabel(type: QuickType, when: When, tag: string, daysUnit: string): string {
  if (!ISO_DAY.test(when.day)) return '';
  const sk = skeletonFor(type);
  const hasUntil = when.until_on && ISO_DAY.test(when.until) && when.until > when.day;
  let out = hasUntil ? `${localeDayMonth(when.day, tag)} – ${localeDayMonth(when.until, tag)}` : `${localeWeekdayShort(when.day, tag)} ${localeDayMonth(when.day, tag)}`;
  if (sk.when.hours && when.timed && /^\d{2}:\d{2}$/.test(when.start) && !(type === 'travel_day' && hasUntil)) {
    out += ` · ${hourMark(when.start)}${/^\d{2}:\d{2}$/.test(when.end) ? `–${hourMark(when.end)}` : ''}`;
  }
  if (hasUntil && sk.when.repeat && when.repeat) out += ` · ${whenDays(when).length} ${daysUnit}`;
  return out;
}
