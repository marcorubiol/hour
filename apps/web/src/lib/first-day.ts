/**
 * Primer día (tarea 137, ayuda B): la lista de arranque de Hoy en un espacio
 * recién creado. Cuatro pasos, numerados porque la fecha y el equipo cuelgan
 * del espectáculo, pero sin bloquear el orden: el espectáculo (o el
 * proyecto), los contactos, la primera fecha y quién trabaja contigo.
 *
 * El equipo es el reparto o la formación del proyecto (`cast_member`): las
 * personas apuntadas con su ficha, sin cuenta en Hour. Invitar con cuenta no
 * es un paso: vive en cada persona y en Ajustes. Cuenta cualquiera del
 * reparto, también quien creó el espacio: nadie entra en él solo por crear el
 * espacio o el proyecto, y quien actúa en lo suyo también es equipo. Su
 * puerta es el reparto de la ficha del primer proyecto (`#team`); sin
 * proyecto, el paso está pero espera a que lo haya.
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

export const START_STEPS = ['project', 'contacts', 'date', 'team'] as const;
export type StartStep = (typeof START_STEPS)[number];

/** The cast block of a project's page: where the team is seen and written. */
export const TEAM_ANCHOR = 'team';

/** «Ocultar»: la lista entera, hasta «Volver a ver las ayudas». */
export const START_HIDDEN_KEY = 'card:start';
/** «Más tarde» de un paso. */
export const startLaterKey = (step: StartStep): string => `card:start_${step}`;
/**
 * Esta persona vio la lista de este espacio con algo pendiente: desde
 * entonces el equipo, él solo, la mantiene a la vista. Por espacio, con su
 * id sin guiones (41 caracteres: cabe en `HELP_KEY`).
 */
export const startSeenKey = (workspaceId: string): string => `card:start_in_${workspaceId.toLowerCase().replace(/-/g, '')}`;

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
  /** The first person in a project's cast, and the project they are in. */
  team: { name: string; project_slug: string | null } | null;
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
  const m = res.team;
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
    team: !m ? null : { name: m.name, href: m.project_slug ? at(`project/${m.project_slug}/#${TEAM_ANCHOR}`) : null },
  };
}

/** The team step's door: the cast of the first project, or none while there is no project. */
export function teamDoor(state: StartState): string | null {
  return state.project?.href ? `${state.project.href}#${TEAM_ANCHOR}` : null;
}

export type StepStatus = 'done' | 'later' | 'pending';

export interface StartRow {
  step: StartStep;
  status: StepStatus;
  item: StartItem | null;
  /** Pending but it cannot be done yet: the team waits for a project. */
  blocked: boolean;
}

/** Hecho gana a «más tarde»: lo que existe se tacha, aunque se aplazara. */
export function startRows(state: StartState, seen: HelpSeen): StartRow[] {
  return START_STEPS.map((step) => {
    const item = state[step];
    const status: StepStatus = item ? 'done' : hasSeen(seen, startLaterKey(step)) ? 'later' : 'pending';
    const blocked = !item && step === 'team' && !state.project;
    return { step, status, item, blocked };
  });
}

export const doneCount = (rows: readonly StartRow[]): number => rows.filter((r) => r.status === 'done').length;

/** El paso que lleva el botón lleno: el primero pendiente que se puede hacer ya. */
export function primaryStep(rows: readonly StartRow[]): StartStep | null {
  return rows.find((r) => r.status === 'pending' && !r.blocked)?.step ?? null;
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
 * - `list` mientras quede pendiente alguno de los tres primeros pasos y la
 *   persona no la haya ocultado (y lo visto haya llegado: sin él no sale
 *   nada solo). El equipo, él solo, no la levanta: la mantiene a la vista
 *   solo donde esta persona ya la vio con algo pendiente (`startSeenKey`);
 * - `closing`, la línea de cierre, una vez: cuando en esta visita se vio la
 *   lista con algo pendiente y ya están todos hechos;
 * - `none` en lo demás: todos hechos o aplazados, oculta, sin papel.
 *   Un espacio con datos (MüK Cia) no la ve nunca, ni su cierre, aunque no
 *   tenga reparto.
 */
export function startPhase(input: {
  rows: readonly StartRow[] | null;
  seen: HelpSeen;
  ready: boolean;
  sees: boolean;
  /** En esta visita se vio la lista con algo pendiente. */
  sawPending: boolean;
  /** The space of the list, for `startSeenKey`. */
  workspaceId: string;
}): StartPhase {
  const { rows, seen, ready, sees, sawPending, workspaceId } = input;
  if (!rows || !ready || !sees || hasSeen(seen, START_HIDDEN_KEY)) return 'none';
  const pending = rows.filter((r) => r.status === 'pending');
  if (pending.some((r) => r.step !== 'team')) return 'list';
  if (pending.length > 0 && (sawPending || hasSeen(seen, startSeenKey(workspaceId)))) return 'list';
  if (sawPending && rows.every((r) => r.status === 'done')) return 'closing';
  return 'none';
}
