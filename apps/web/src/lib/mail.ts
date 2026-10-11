/**
 * El buzón sincronizado en el cliente (ADR-099): forma de los buzones, del
 * envío y de los datos de correo de un evento del registro.
 */

import * as v from 'valibot';

export type MailAccountScope = 'personal' | 'workspace';
export type MailAccountStatus = 'active' | 'revoked' | 'error';

/** Las columnas que `authenticated` puede leer (grant por columnas). */
export const MAIL_ACCOUNT_SELECT =
  'id,workspace_id,scope,owner_user_id,provider,address,status,sync_from,last_synced_at,last_error,messages_ingested,connected_by,created_at';

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
  created_at: string;
}

export interface MailAccountsResponse {
  items: MailAccountItem[];
  can_manage_shared: boolean;
  configured: boolean;
  /** Con qué firma sale cada buzón: el personal, la tuya; el común, la de la compañía. */
  signatures: Record<MailAccountScope, string>;
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

/**
 * La firma es de la persona en cada compañía; el buzón común firma con la de
 * la compañía (ADR-099, añadido). Lo que devuelve `my_mail_signature`: las dos
 * firmas guardadas (null = la propuesta de Hour) y las piezas de la propuesta.
 */
export interface SignatureParts {
  full_name: string | null;
  title: string | null;
  company_name: string | null;
  company_website: string | null;
  company_phone: string | null;
  signature: string | null;
  company_signature: string | null;
}

/** La web como se lee en una firma: sin protocolo, sin «www.», sin barra final. */
export function displayWebsite(url: string | null | undefined): string {
  return (url ?? '').trim().replace(/^https?:\/\//i, '').replace(/^www\./i, '').replace(/\/+$/, '');
}

/**
 * La firma que propone Hour, con lo que exista. La de la persona: nombre, su
 * rol en esa compañía junto a la compañía, y la web y el teléfono de la
 * compañía. La de la compañía: lo mismo sin la persona.
 */
export function proposedSignature(p: SignatureParts, scope: MailAccountScope): string {
  const company = p.company_name?.trim() ?? '';
  const title = p.title?.trim() ?? '';
  const contact = [displayWebsite(p.company_website), p.company_phone?.trim() ?? ''].filter(Boolean).join(' · ');
  const lines =
    scope === 'personal'
      ? [p.full_name?.trim() ?? '', [title, company].filter(Boolean).join(', '), contact]
      : [company, contact];
  return lines.filter(Boolean).join('\n');
}

/** La firma con la que se envía: la guardada, o si no hay, la propuesta. */
export function effectiveSignature(p: SignatureParts, scope: MailAccountScope): string {
  const stored = (scope === 'personal' ? p.signature : p.company_signature)?.trim();
  return stored || proposedSignature(p, scope);
}

/** Lo que devuelve GET /api/mail/signature. */
export interface SignatureSettings {
  parts: SignatureParts;
  can_edit_company: boolean;
}

/**
 * PUT /api/mail/signature. La tuya (null = volver a la propuesta), o la de la
 * compañía con su web y su teléfono (solo admin). Un campo ausente no cambia.
 */
const SignatureText = v.nullable(v.pipe(v.string(), v.maxLength(2000)));
export const SignaturePutSchema = v.variant('scope', [
  v.object({
    workspace_id: v.pipe(v.string(), v.uuid()),
    scope: v.literal('personal'),
    signature: SignatureText,
  }),
  v.object({
    workspace_id: v.pipe(v.string(), v.uuid()),
    scope: v.literal('workspace'),
    signature: v.optional(SignatureText),
    website: v.optional(v.nullable(v.pipe(v.string(), v.trim(), v.maxLength(2048)))),
    phone: v.optional(v.nullable(v.pipe(v.string(), v.trim(), v.maxLength(64)))),
  }),
]);

export type SignaturePut = v.InferOutput<typeof SignaturePutSchema>;
