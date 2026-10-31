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

/** La misma regla que `mark_help_seen` (20261020150000_help_seen). */
export const HELP_KEY = /^(card|event):[a-z][a-z0-9_]{0,47}$/;

/** Las secciones con tarjeta. Ajustes y las fichas no la llevan: nadie entra a
 *  explorarlas, se llega con una tarea (investigación § 3). */
export const SECTIONS = ['desk', 'planner', 'conversations', 'team', 'books'] as const;
export type HelpSection = (typeof SECTIONS)[number];

/** Los conceptos con «i» (textos.md § 1 y § 2). */
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
  'due',
  'hot',
  'cold',
  'season_sales',
  'relation',
  'bolo',
  'to_collect',
  'next30',
  'season_books',
  'board',
  'cast',
  'roadsheet',
  'lines',
  'trade',
  'reading',
  'outside',
  'mailboxes',
  'known',
] as const;
export type HelpConcept = (typeof CONCEPTS)[number];

/**
 * Lo que explica el «?» de cada sección, en el orden de sus bloques en la
 * pantalla (ADR-145 § 2). Las cuatro lentes no llevan «i» en sus cabeceras:
 * su texto vive aquí, en la tarjeta que abre el «?». Las fichas y los
 * formularios conservan su «i», junto al dato.
 */
export const SECTION_CONCEPTS: Record<HelpSection, readonly HelpConcept[]> = {
  desk: ['scope', 'guess', 'waiting', 'changed'],
  planner: ['scope', 'hold', 'guess', 'decide', 'clashes', 'unclosed', 'gaps'],
  conversations: ['scope', 'due', 'hot', 'season_sales', 'cold', 'relation'],
  team: ['scope'],
  books: ['scope', 'to_collect', 'next30', 'season_books', 'bolo'],
};

/** Los avisos de primera vez (textos.md § 4). */
export const EVENTS = [
  'first_clash',
  'first_hold_due',
  'first_trip_guess',
  'first_reply_waiting',
  'first_team_thread',
  'first_overdue',
  'first_payment',
  'first_board',
  'first_mail_synced',
] as const;
export type HelpEvent = (typeof EVENTS)[number];

export const cardKey = (section: HelpSection): string => `card:${section}`;
export const eventKey = (event: HelpEvent): string => `event:${event}`;

/**
 * La relación, en el orden en que manda (ADR-138 § 4): si una conversación
 * cumple dos, gana la de más arriba. Es el orden de las líneas de su «i».
 */
export const RELATION_PRECEDENCE = ['not_now', 'regular', 'talking', 'dormant', 'contacted', 'never'] as const;

export interface ConceptKeys {
  title: string;
  body: string;
  /** Una línea por caso, con su palabra de pantalla delante. */
  lines?: { label: string; text: string }[];
  /** Lo que se abre con «Más», para quien quiere el detalle. */
  more?: string;
}

/** Las claves del diccionario de un concepto: el título del panel, su texto y, si las tiene, sus líneas. */
export function conceptKeys(concept: HelpConcept): ConceptKeys {
  const keys: ConceptKeys = { title: `help.concept.${concept}`, body: `help.concept.${concept}_body` };
  if (concept === 'relation') {
    keys.lines = RELATION_PRECEDENCE.map((r) => ({
      label: `conversations.relation_${r}`,
      text: `help.concept.relation_${r}`,
    }));
    keys.more = 'help.concept.relation_more';
  }
  // The season bar's instruction, out of its head (ADR-145 § 2).
  if (concept === 'season_sales') keys.more = 'help.concept.season_sales_tap';
  return keys;
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
