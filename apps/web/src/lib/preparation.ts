/**
 * «Qué preparamos para una función»: the list of a project (ADR-221, fases 2-3).
 *
 * The list is decided once, in the project's settings, and holds for all its
 * performances. It has two kinds of thing:
 *
 *   · of the APP (`status`, `hours`, `team`, `sheet`): the app closes them by
 *     itself when the data exists. They cannot be deleted, only turned off.
 *   · BY HAND (`m_…`): the project's own, a name and a box ("Enviar el rider").
 *     Created, renamed and deleted in the settings; closed per performance.
 *
 * Stored in `project.custom_fields.preparation` (JSON), written through
 * `update_project`:
 *
 *   { "items": [ { "id": "status", "on": true }, { "id": "m_k3j9x2ab", "name": "Enviar el rider", "on": true } ] }
 *
 * The state of a hand thing in each performance lives in
 * `performance.custom_fields.preparation`, by thing id, written through
 * `set_performance_preparation`:
 *
 *   { "m_k3j9x2ab": { "estado": "hecho" | "no_aplica", "por": <user id>, "nombre": <name>, "cuando": <instant> } }
 *
 * Deleting a thing from the list does not delete what was marked in past
 * performances: that state just stops being read.
 *
 * No list (or a damaged one) is the default: the four, in this order, on.
 * Reading is forgiving: an unknown id is dropped, a repeated one counts once,
 * a hand thing without a name is dropped, and an app thing the list lacks (the
 * app grew one) is appended on.
 *
 * Pure, without network or clock.
 */

/** The things the app knows by itself, in the default order. */
export const APP_THINGS = ['status', 'hours', 'team', 'sheet'] as const;
export type AppThing = (typeof APP_THINGS)[number];

/** A hand thing's id: `m_` and a few lowercase letters or digits. */
export const MANUAL_ID_RE = /^m_[a-z0-9]{4,16}$/;
/** What the whole list can hold (the app's four count), and how long a name is. */
export const PREPARATION_MAX = 20;
export const MANUAL_NAME_MAX = 60;

/**
 * How many days before the performance an open thing has hurry (the only thing
 * drawn in amber, fase 4). `days` absent is the default (the road sheet: 14,
 * the day it starts to be asked; the rest: never); `null` is «never»; a number
 * is the project's own. Only the performance's day is counted, so «0» is «the
 * same day». «Estado» takes no days: its hurry is the hold's own deadline.
 */
export const SHEET_HURRY_DAYS = 14;
export const HURRY_DAYS_MAX = 365;

export interface AppPreparationThing {
  id: AppThing;
  on: boolean;
  days?: number | null;
}
export interface ManualPreparationThing {
  id: string;
  name: string;
  on: boolean;
  days?: number | null;
}
export type PreparationThing = AppPreparationThing | ManualPreparationThing;
export type Preparation = readonly PreparationThing[];

export const isManualThing = (x: PreparationThing): x is ManualPreparationThing => 'name' in x;

export const DEFAULT_PREPARATION: Preparation = APP_THINGS.map((id) => ({ id, on: true }));

const isAppThing = (id: unknown): id is AppThing => typeof id === 'string' && (APP_THINGS as readonly string[]).includes(id);

/** A `days` as stored: a whole number 0..365, `null` for never, `undefined` for absent or damaged (the default). */
function readDays(raw: unknown): number | null | undefined {
  if (raw === null) return null;
  return typeof raw === 'number' && Number.isInteger(raw) && raw >= 0 && raw <= HURRY_DAYS_MAX ? raw : undefined;
}

/** A name as stored: trimmed, one line, at most `MANUAL_NAME_MAX`. */
export const cleanManualName = (name: unknown): string =>
  typeof name === 'string' ? name.replace(/\s+/g, ' ').trim().slice(0, MANUAL_NAME_MAX) : '';

/** A fresh hand-thing id; `random` is injectable for tests. */
export function newManualId(random: () => number = Math.random): string {
  let s = '';
  while (s.length < 8) s += Math.floor(random() * 36).toString(36);
  return `m_${s}`;
}

/** The list a project's `custom_fields` (or the API's `preparation`) says. */
export function readPreparation(raw: unknown): Preparation {
  const items = (raw as { items?: unknown } | null | undefined)?.items;
  if (!Array.isArray(items)) return DEFAULT_PREPARATION;
  const seen = new Set<string>();
  const out: PreparationThing[] = [];
  for (const it of items) {
    const id = (it as { id?: unknown } | null)?.id;
    if (typeof id !== 'string' || seen.has(id)) continue;
    const on = (it as { on?: unknown }).on !== false;
    const days = readDays((it as { days?: unknown }).days);
    const withDays = days === undefined || id === 'status' ? {} : { days };
    if (isAppThing(id)) {
      seen.add(id);
      out.push({ id, on, ...withDays });
    } else if (MANUAL_ID_RE.test(id) && out.filter(isManualThing).length < PREPARATION_MAX - APP_THINGS.length) {
      const name = cleanManualName((it as { name?: unknown }).name);
      if (!name) continue;
      seen.add(id);
      out.push({ id, name, on, ...withDays });
    }
  }
  for (const id of APP_THINGS) if (!seen.has(id)) out.push({ id, on: true });
  return out;
}

/** Whether a thing is asked for (everything of the app is, with no list). */
export function thingOn(list: Preparation | null | undefined, id: string): boolean {
  return (list ?? DEFAULT_PREPARATION).find((x) => x.id === id)?.on !== false;
}

/** The position of a thing in the list (the order of the pass). */
export function thingRank(list: Preparation | null | undefined, id: string): number {
  const l = list ?? DEFAULT_PREPARATION;
  const i = l.findIndex((x) => x.id === id);
  return i < 0 ? l.length : i;
}

/** What goes to `update_project`: the list as stored. */
export function preparationPatch(list: Preparation): {
  items: { id: string; on: boolean; name?: string; days?: number | null }[];
} {
  return {
    items: list.map((x) => ({
      id: x.id,
      ...(isManualThing(x) ? { name: x.name } : {}),
      on: x.on,
      ...(x.days !== undefined ? { days: x.days } : {}),
    })),
  };
}

/** The days before the performance a thing has hurry: a number, or null for never. */
export function thingDays(list: Preparation | null | undefined, id: string): number | null {
  const x = (list ?? DEFAULT_PREPARATION).find((t) => t.id === id);
  if (x && x.days !== undefined) return x.days;
  return id === 'sheet' ? SHEET_HURRY_DAYS : null;
}

/** A thing's hurry set (`null` for never; the app's «Estado» takes none). */
export function setThingDays(list: Preparation, id: string, days: number | null): Preparation {
  if (id === 'status') return list;
  const d = days === null ? null : Math.min(HURRY_DAYS_MAX, Math.max(0, Math.trunc(days)));
  if (d !== null && !Number.isFinite(d)) return list;
  return list.map((x) => (x.id === id ? { ...x, days: d } : x));
}

/** A list moved: the thing at `from` goes to `to`; the list is unchanged if either is out. */
export function moveThing(list: Preparation, from: number, to: number): Preparation {
  if (from < 0 || from >= list.length || to < 0 || to >= list.length || from === to) return list;
  const next = [...list];
  const [it] = next.splice(from, 1);
  next.splice(to, 0, it);
  return next;
}

/** A hand thing added at the end (ignored when the name is empty or the list is full). */
export function addManualThing(list: Preparation, name: string, id = newManualId()): Preparation {
  const clean = cleanManualName(name);
  if (!clean || list.length >= PREPARATION_MAX || list.some((x) => x.id === id)) return list;
  return [...list, { id, name: clean, on: true }];
}

/** A hand thing renamed (an empty name leaves it). App things have a fixed name. */
export function renameManualThing(list: Preparation, id: string, name: string): Preparation {
  const clean = cleanManualName(name);
  if (!clean) return list;
  return list.map((x) => (isManualThing(x) && x.id === id ? { ...x, name: clean } : x));
}

/** A hand thing deleted; the app's cannot be. */
export function removeManualThing(list: Preparation, id: string): Preparation {
  return list.filter((x) => !(isManualThing(x) && x.id === id));
}

// ── The state of each hand thing in a performance ──────────────────────────

export type ManualEstado = 'hecho' | 'no_aplica';

export interface ManualState {
  estado: ManualEstado;
  /** The user that closed it. */
  por: string | null;
  /** Their name when they closed it (a snapshot; absent in what was closed before). */
  nombre: string | null;
  /** When (an instant). */
  cuando: string | null;
}

/** Who closed it, for the quiet line: the first word of the name («Nil»), or undefined. */
export function closerFirstName(nombre: string | null): string | undefined {
  const first = nombre?.trim().split(/\s+/)[0];
  return first || undefined;
}

/** `performance.custom_fields.preparation`, read forgivingly: only well-formed hand entries. */
export function readManualStates(raw: unknown): Record<string, ManualState> {
  const out: Record<string, ManualState> = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  for (const [id, v] of Object.entries(raw)) {
    if (!MANUAL_ID_RE.test(id) || !v || typeof v !== 'object') continue;
    const e = v as { estado?: unknown; por?: unknown; nombre?: unknown; cuando?: unknown };
    if (e.estado !== 'hecho' && e.estado !== 'no_aplica') continue;
    out[id] = {
      estado: e.estado,
      por: typeof e.por === 'string' ? e.por : null,
      nombre: typeof e.nombre === 'string' && e.nombre.trim() ? e.nombre.trim() : null,
      cuando: typeof e.cuando === 'string' ? e.cuando : null,
    };
  }
  return out;
}

export interface ManualOpen {
  id: string;
  name: string;
}
export interface ManualClosed extends ManualOpen {
  state: ManualState;
}
export interface ManualReading {
  /** On and not closed: a box and a row, in the list's order. */
  open: ManualOpen[];
  /** Closed (done, or «aquí no hace falta»): the quiet line. */
  closed: ManualClosed[];
}

/**
 * What the hand things of a project's list say for one performance. A thing
 * turned off asks nothing and says nothing; a closed one is not open.
 */
export function readManual(list: Preparation | null | undefined, states: Record<string, ManualState>): ManualReading {
  const open: ManualOpen[] = [];
  const closed: ManualClosed[] = [];
  for (const x of list ?? []) {
    if (!isManualThing(x) || !x.on) continue;
    const state = states[x.id];
    if (state) closed.push({ id: x.id, name: x.name, state });
    else open.push({ id: x.id, name: x.name });
  }
  return { open, closed };
}
