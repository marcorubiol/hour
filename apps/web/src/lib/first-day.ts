/**
 * Primer día (tarea 137, ayuda B): la lista de arranque de Hoy en un espacio
 * recién creado. Tres pasos, numerados porque la fecha cuelga del
 * espectáculo, pero sin bloquear el orden: el espectáculo (o el proyecto),
 * los contactos y la primera fecha.
 *
 * Un paso se tacha solo con los datos del espacio, venga de la puerta que
 * venga (`GET /api/workspaces/[id]/start`). «Más tarde» y «Ocultar» se
 * guardan por persona en `help_seen`, con claves que caben en su regla
 * (`HELP_KEY`): sin migración. «Volver a ver las ayudas» las borra todas, y
 * la lista vuelve si queda algo por hacer.
 *
 * Este módulo es la parte pura: qué pasos están hechos, cuándo se ve la
 * lista y cuándo se va, quién la ve y en qué espacio.
 */

import { hasSeen, type HelpSeen } from './help';
import { plannerDayHref } from './planner';
import type { WorkspaceRole } from './workspace-role';

export const START_STEPS = ['project', 'contacts', 'date'] as const;
export type StartStep = (typeof START_STEPS)[number];

/** «Ocultar»: la lista entera, hasta «Volver a ver las ayudas». */
export const START_HIDDEN_KEY = 'card:start';
/** «Más tarde» de un paso. */
export const startLaterKey = (step: StartStep): string => `card:start_${step}`;

/** Lo que el espacio ya tiene, como lo responde la API: lo primero de cada cosa, o nada. */
export interface StartResponse {
  project: { id: string; slug: string; name: string } | null;
  contact:
    | { kind: 'conversation'; id: string; name: string }
    | { kind: 'person'; slug: string; name: string }
    | { kind: 'organization'; slug: string; name: string }
    | null;
  date:
    | { kind: 'performance'; slug: string | null; name: string; day: string | null }
    | { kind: 'date'; name: string; day: string | null }
    | null;
}

/** Lo creado en un paso: su nombre (puede venir vacío) y adónde lleva. */
export interface StartItem {
  name: string;
  href: string | null;
  /** The project's id: the first date is born in it. */
  id?: string;
}
export type StartState = Record<StartStep, StartItem | null>;

/** La respuesta, con los enlaces a lo creado dentro del espacio. */
export function startState(res: StartResponse, workspaceSlug: string): StartState {
  const at = (path: string) => `/h/${workspaceSlug}/${path}`;
  const c = res.contact;
  const d = res.date;
  return {
    project: res.project
      ? { id: res.project.id, name: res.project.name, href: at(`project/${res.project.slug}/`) }
      : null,
    contacts: !c
      ? null
      : {
          name: c.name,
          href:
            c.kind === 'conversation'
              ? at(`conversation/${c.id}`)
              : c.kind === 'person'
                ? at(`person/${c.slug}/`)
                : at(`organization/${encodeURIComponent(c.slug)}`),
        },
    date: !d
      ? null
      : {
          name: d.name,
          href:
            d.kind === 'performance' && d.slug
              ? at(`performance/${encodeURIComponent(d.slug)}`)
              : d.day
                ? plannerDayHref('day', d.day)
                : null,
        },
  };
}

export type StepStatus = 'done' | 'later' | 'pending';

export interface StartRow {
  step: StartStep;
  status: StepStatus;
  item: StartItem | null;
}

/** Hecho gana a «más tarde»: lo que existe se tacha, aunque se aplazara. */
export function startRows(state: StartState, seen: HelpSeen): StartRow[] {
  return START_STEPS.map((step) => {
    const item = state[step];
    const status: StepStatus = item ? 'done' : hasSeen(seen, startLaterKey(step)) ? 'later' : 'pending';
    return { step, status, item };
  });
}

export const doneCount = (rows: readonly StartRow[]): number => rows.filter((r) => r.status === 'done').length;

/** El paso que lleva el botón lleno: el primero pendiente. */
export function primaryStep(rows: readonly StartRow[]): StartStep | null {
  return rows.find((r) => r.status === 'pending')?.step ?? null;
}

/** La ven owner o admin del espacio, con el papel dicho: sin respuesta, no sale. */
export function seesStart(role: WorkspaceRole | null | undefined): boolean {
  return role === 'owner' || role === 'admin';
}

/**
 * El espacio de la lista: entre los de la pantalla que la persona administra,
 * el más reciente (la API los da por fecha de creación), que es el que acaba
 * de crear. Uno solo: dos listas serían ruido.
 */
export function startTarget<T extends { my_role?: WorkspaceRole | null }>(onScreen: readonly T[]): T | null {
  for (let i = onScreen.length - 1; i >= 0; i--) if (seesStart(onScreen[i].my_role)) return onScreen[i];
  return null;
}

export type StartPhase = 'list' | 'closing' | 'none';

/**
 * Qué pinta Hoy:
 * - `list` mientras quede algún paso pendiente y la persona no la haya
 *   ocultado (y lo visto haya llegado: sin él no sale nada solo);
 * - `closing`, la línea de cierre, una vez: cuando en esta visita se vio la
 *   lista con algo pendiente y ya están los tres hechos;
 * - `none` en lo demás: los tres hechos o aplazados, oculta, sin papel.
 *   Un espacio con datos (MüK Cia) no la ve nunca, ni su cierre.
 */
export function startPhase(input: {
  rows: readonly StartRow[] | null;
  seen: HelpSeen;
  ready: boolean;
  sees: boolean;
  /** En esta visita se vio la lista con algo pendiente. */
  sawPending: boolean;
}): StartPhase {
  const { rows, seen, ready, sees, sawPending } = input;
  if (!rows || !ready || !sees || hasSeen(seen, START_HIDDEN_KEY)) return 'none';
  if (rows.some((r) => r.status === 'pending')) return 'list';
  if (sawPending && rows.every((r) => r.status === 'done')) return 'closing';
  return 'none';
}
