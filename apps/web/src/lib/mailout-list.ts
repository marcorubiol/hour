/**
 * La vista Envíos de Conversaciones (ADR-176): lo que sale a muchos, difusión
 * e invitaciones juntas, lo último arriba, con sus cifras. Tipos y reglas que
 * comparten el endpoint (`GET /api/mailout?list=1`) y la pantalla.
 */

import type { MailoutFigures } from './conversation-overview';

export const MAILOUT_KINDS = ['outreach', 'invitation'] as const;
export type MailoutKind = (typeof MAILOUT_KINDS)[number];

/** El filtro de la vista, en la URL (`?tipo=`): sin parámetro, todos. */
export const MAILOUT_TYPES = ['todos', 'difusion', 'invitaciones'] as const;
export type MailoutType = (typeof MAILOUT_TYPES)[number];

const KIND_OF: Record<MailoutType, MailoutKind | null> = { todos: null, difusion: 'outreach', invitaciones: 'invitation' };

export function parseMailoutType(raw: string | null): MailoutType {
  return (MAILOUT_TYPES as readonly string[]).includes(raw ?? '') ? (raw as MailoutType) : 'todos';
}

export function kindOfType(type: MailoutType): MailoutKind | null {
  return KIND_OF[type];
}

/** Una página de la vista: veinte, y «Ver más» pide las siguientes. */
export const MAILOUT_PAGE = 20;

/** Una fila de Envíos. */
export interface MailoutRow {
  id: string;
  workspace_id: string;
  project_id: string | null;
  kind: MailoutKind;
  subject: string | null;
  status: string;
  queued_at: string | null;
  created_at: string;
  /** La lista del público de una invitación (ADR-173 § 9). */
  audience_id: string | null;
  /** Destinatarios con conversación: salas, prensa, profesionales. */
  professionals: number;
  /** Destinatarios de la lista del público. */
  subscribers: number;
  /** Sólo de lo que ya salió; un borrador no tiene cifras. Null si no se pudieron leer. */
  figures: MailoutFigures | null;
}

export interface MailoutListResponse {
  items: MailoutRow[];
  total: number;
}

/** Lo que salió o está saliendo: tiene cifras. */
export function mailoutLeft(status: string): boolean {
  return status === 'queued' || status === 'sending' || status === 'paused' || status === 'done';
}
