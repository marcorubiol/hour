/**
 * La relación con una sala (ADR-138 § 4, plan `build/plans/2026-10-19-conversations-tags.md`
 * § 8.2): se deriva del historial, los sellos y los bolos, y no se guarda. La
 * única función que la calcula en la app: la usan la lista, la ficha, el panel
 * de Difusión y el Desk. Su espejo en SQL es `private.relation_of`
 * (`20261020100000_conversation_relation`): cambian juntos.
 *
 * Sin red y sin reloj: `now` se inyecta. Días de calendario en la zona de quien
 * llama, como el resto del dashboard (SQL cuenta en UTC; en el borde de
 * medianoche pueden diferir un día).
 *
 * Precedencia: «no esta vez» vigente > habitual > en conversación > dormida >
 * contactada > nunca contactada. Una habitual que calla sigue siendo
 * habitual: su silencio lo dice «se enfría», no la relación.
 */

import { localDayISO } from './datetime';
import { appLocale, t, type Locale } from './i18n';
import type { StatusTone } from './performance';

export const RELATIONS = ['never', 'contacted', 'talking', 'regular', 'dormant', 'not_now'] as const;
export type Relation = (typeof RELATIONS)[number];

/** Dormida: hubo conversación y no hay movimiento en estos días (el umbral de ADR-117 § 5). */
export const DORMANT_DAYS = 30;

/** El estado viejo que ya decía que la sala había contestado (§ 8.5: «en conversación»). */
const LEGACY_ANSWERED: ReadonlySet<string> = new Set(['in_conversation', 'hold', 'confirmed']);

/** Lo que la relación lee de una conversación. */
export interface RelationInput {
  not_now_at: string | null;
  /** YYYY-MM-DD: el día de volver a escribir; ese día «no esta vez» acaba. */
  not_now_until: string | null;
  /** Último correo, mensaje o llamada con dirección (no automático). */
  last: { direction: 'inbound' | 'outbound'; occurred_at: string } | null;
  /** Último que vino de fuera. */
  last_in: { occurred_at: string } | null;
  last_contacted_at: string | null;
  first_contacted_at: string | null;
  /** «Contactada, sin fecha»: de antes del historial (pregunta 9). */
  contacted_undated: boolean;
  /** `custom_fields.legacy_status`: el estado que alguien marcó a mano antes de E1. */
  legacy_status?: string | null;
  /** La organización tiene un bolo hecho en una temporada anterior (`conversation_regular`). */
  regular?: boolean | null;
}

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
export function lastActivity(
  row: { last: { occurred_at: string } | null; last_in: { occurred_at: string } | null; last_contacted_at: string | null },
): string | null {
  return latest(row.last?.occurred_at, row.last_in?.occurred_at, row.last_contacted_at);
}

/** Han contestado: nos escribieron alguna vez, o su estado viejo lo decía. */
export function hasAnswered(row: Pick<RelationInput, 'last_in' | 'legacy_status'>): boolean {
  return Boolean(row.last_in) || LEGACY_ANSWERED.has(row.legacy_status ?? '');
}

/**
 * «No esta vez» en vigor: lo marcaron, no ha llegado su día de volver y no han
 * vuelto a escribir después.
 */
export function notNowInForce(
  row: Pick<RelationInput, 'not_now_at' | 'not_now_until' | 'last_in'>,
  now: Date,
): boolean {
  if (!row.not_now_at) return false;
  if (row.not_now_until && row.not_now_until <= localDayISO(now)) return false;
  return !row.last_in || Date.parse(row.last_in.occurred_at) <= Date.parse(row.not_now_at);
}

export function relationOf(row: RelationInput, now: Date): Relation {
  if (notNowInForce(row, now)) return 'not_now';
  if (row.regular) return 'regular';
  if (hasAnswered(row)) {
    const activity = lastActivity(row);
    return activity === null || daysSince(activity, now) < DORMANT_DAYS ? 'talking' : 'dormant';
  }
  const wrote = row.last?.direction === 'outbound' || Boolean(row.first_contacted_at) || row.contacted_undated;
  return wrote ? 'contacted' : 'never';
}

// ── Palabras y tonos ───────────────────────────────────────────────────────

export function isRelation(value: unknown): value is Relation {
  return typeof value === 'string' && (RELATIONS as readonly string[]).includes(value);
}

export function relationLabel(relation: Relation, locale: Locale = appLocale()): string {
  return t(`conversations.relation_${relation}`, locale);
}

/** El tono de la pastilla (`StateBadge`); la barra de la temporada lee la misma familia por `[data-relation]`. */
const TONES: Record<Relation, StatusTone> = {
  never: 'neutral',
  contacted: 'info',
  talking: 'warning',
  regular: 'primary',
  dormant: 'faint',
  not_now: 'danger',
};

export function relationTone(relation: Relation): StatusTone {
  return TONES[relation];
}

// ── Los bolos de una conversación (`conversation_bolos`) ───────────────────

/** Un bolo como lo ve la conversación: sin caché ni pagador. */
export interface ConversationBolo {
  conversation_id: string;
  bolo_id: string;
  project_id: string;
  line_id: string | null;
  status: string;
  venue_name: string | null;
  city: string | null;
  country: string | null;
  function_count: number;
  first_performed_at: string | null;
  last_performed_at: string | null;
  performance_slug: string | null;
}

/** En opción: pedido y sin confirmar (la familia `hold` del Planner, ADR-095). */
function boloInOption(status: string): boolean {
  return status === 'hold' || status.startsWith('hold_');
}

/** Firme: confirmado o ya hecho. */
function boloFirm(status: string): boolean {
  return status === 'confirmed' || status === 'done' || status === 'invoiced' || status === 'paid';
}

export interface BoloCounts {
  option: number;
  firm: number;
}

/** Lo que el panel y el Desk cuentan de unos bolos: en opción y firmes; los cancelados, no. */
export function countBolos(bolos: readonly Pick<ConversationBolo, 'status'>[]): BoloCounts {
  const out: BoloCounts = { option: 0, firm: 0 };
  for (const b of bolos) {
    if (boloInOption(b.status)) out.option += 1;
    else if (boloFirm(b.status)) out.firm += 1;
  }
  return out;
}
