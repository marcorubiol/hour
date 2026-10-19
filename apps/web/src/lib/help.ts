/**
 * Ayuda contextual, enfoque A (investigación de onboarding, 2026-10-19).
 *
 * Tres piezas leen de aquí:
 * - la «i» de concepto (`ConceptHint`), siempre presente y nunca guardada;
 * - la tarjeta de primera vez de una sección (`FirstVisitCard`), que sale una
 *   vez por persona y vuelve con el «?» de la cabecera;
 * - el aviso de primera vez de un bloque (`FirstTimeNote`), una línea la
 *   primera vez que el bloque tiene contenido de ese tipo.
 *
 * Lo visto vive en `help_seen` (una fila por persona, solo suya). Este módulo
 * es la parte pura: las claves, cuándo se ve cada cosa y qué pasos de un
 * «Enséñame» tienen dónde posarse. El estado de la sesión está en
 * `help-seen.svelte.ts`.
 */

/** `{ "card:planner": "2026-10-20T…" }`: clave vista y cuándo. */
export type HelpSeen = Record<string, string>;

/** La misma regla que `mark_help_seen` (20261020140000_help_seen). */
export const HELP_KEY = /^(card|event):[a-z][a-z0-9_]{0,47}$/;

/** Las secciones con tarjeta en este carril. */
export type HelpSection = 'desk' | 'planner';

/** Los conceptos con «i» en este carril (textos.md § 2, prioridad 1). */
export const CONCEPTS = [
  'scope',
  'calm',
  'guess',
  'waiting',
  'changed',
  'hold',
  'decide',
  'clashes',
  'unclosed',
  'gaps',
] as const;
export type HelpConcept = (typeof CONCEPTS)[number];

/** Los avisos de primera vez de este carril (textos.md § 4). */
export const EVENTS = ['first_going', 'first_clash', 'first_hold_due', 'first_trip_guess'] as const;
export type HelpEvent = (typeof EVENTS)[number];

export const cardKey = (section: HelpSection): string => `card:${section}`;
export const eventKey = (event: HelpEvent): string => `event:${event}`;

/** Las claves del diccionario de un concepto: el título del panel y su texto. */
export function conceptKeys(concept: HelpConcept): { title: string; body: string } {
  return { title: `help.concept.${concept}`, body: `help.concept.${concept}_body` };
}

export function hasSeen(seen: HelpSeen, key: string): boolean {
  return Object.hasOwn(seen, key);
}

export interface HelpState {
  seen: HelpSeen;
  /** Lo visto ya llegó. Hasta entonces (o si no llega) no sale nada solo. */
  ready: boolean;
  /** La tarjeta que el «?» ha vuelto a abrir, si alguna. */
  reopened: string | null;
}

/**
 * La tarjeta sale si el «?» la ha abierto, o si lo visto ya llegó y no está.
 * Sin lo visto no sale sola: mejor callar una vez que repetirla en cada visita
 * cuando la lectura falla.
 */
export function cardVisible(state: HelpState, key: string): boolean {
  return state.reopened === key || (state.ready && !hasSeen(state.seen, key));
}

/** Un aviso sale cuando su bloque tiene ese contenido y aún no se ha visto. */
export function noteVisible(state: HelpState, key: string, when: boolean): boolean {
  return when && state.ready && !hasSeen(state.seen, key);
}

/** Un paso de «Enséñame»: el bloque que resalta (`data-help-step`) y su texto. */
export interface TourStep {
  target: string;
  text: string;
}

/** Los pasos que tienen dónde posarse, en su orden. Un bloque que no está
 *  (calma lo pliega, la vista no lo dibuja) se salta, no se inventa. */
export function presentSteps(steps: readonly TourStep[], isPresent: (target: string) => boolean): TourStep[] {
  return steps.filter((s) => isPresent(s.target));
}
