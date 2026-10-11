/**
 * El buzón sincronizado en el cliente (ADR-099): forma de los buzones, del
 * envío y de los datos de correo de un evento del registro.
 */

import * as v from 'valibot';

export type MailAccountScope = 'personal' | 'workspace';
export type MailAccountStatus = 'active' | 'revoked' | 'error';

/** Las columnas que `authenticated` puede leer (grant por columnas). */
export const MAIL_ACCOUNT_SELECT =
  'id,workspace_id,scope,owner_user_id,provider,address,status,sync_from,last_synced_at,last_error,messages_ingested,connected_by,signature,created_at';

export interface MailAccountItem {
  id: string;
  workspace_id: string;
  scope: MailAccountScope;
  owner_user_id: string | null;
  provider: 'google';
  address: string;
  status: MailAccountStatus;
  sync_from: string;
  last_synced_at: string | null;
  last_error: string | null;
  messages_ingested: number;
  connected_by: string | null;
  /** Firma de Hour: la del personal, de su dueño; la del común, del espacio. */
  signature: string | null;
  created_at: string;
}

export interface MailAccountsResponse {
  items: MailAccountItem[];
  can_manage_shared: boolean;
  configured: boolean;
}

export const MailSendSchema = v.object({
  conversation_id: v.pipe(v.string(), v.uuid()),
  account_id: v.pipe(v.string(), v.uuid()),
  subject: v.pipe(v.string(), v.trim(), v.minLength(1), v.maxLength(500)),
  body: v.pipe(v.string(), v.minLength(1), v.maxLength(20000)),
  reply_to_event_id: v.optional(v.nullable(v.pipe(v.string(), v.uuid()))),
});

export type MailSend = v.InferOutput<typeof MailSendSchema>;

/**
 * Lo que el registro enseña de un correo: sale de `conversation_event.metadata`
 * (lo escribe `mail_ingest_message`) con alias de PostgREST.
 */
export const EVENT_MAIL_SELECT = [
  'subject:metadata->>subject',
  'mail_from:metadata->>from',
  'mail_to:metadata->to',
  'mailbox_address:metadata->>mailbox_address',
  'mailbox_scope:metadata->>mailbox_scope',
  'mail_account_id:metadata->>mail_account_id',
].join(',');

export interface EventMailFields {
  subject?: string | null;
  mail_from?: string | null;
  mail_to?: string[] | null;
  mailbox_address?: string | null;
  mailbox_scope?: MailAccountScope | null;
  mail_account_id?: string | null;
}

/** El asunto de una respuesta: «Re: » una sola vez. */
export function replySubject(subject: string | null | undefined): string {
  const s = (subject ?? '').trim();
  if (!s) return '';
  return /^(re|rv|fw|fwd|tr)\s*:/i.test(s) ? s : `Re: ${s}`;
}

/** Primera línea con contenido de un cuerpo, para la vista plegada. */
export function firstLine(body: string | null | undefined): string {
  return (body ?? '').split('\n').map((l) => l.trim()).find(Boolean) ?? '';
}

/** El cuerpo con la firma de Hour al pie, tras el separador estándar «-- ». */
export function withSignature(body: string, signature: string | null | undefined): string {
  const sig = (signature ?? '').trim();
  return sig ? `${body.replace(/\s+$/, '')}\n\n-- \n${sig}` : body;
}

export const SignatureSchema = v.object({
  signature: v.nullable(v.pipe(v.string(), v.maxLength(2000))),
});
