/**
 * Envío en bloque (ADR-109, ADR-110): tipos y esquemas que comparten el
 * Worker y la pantalla. Aquí no hay nada de servidor.
 */

import * as v from 'valibot';
import type { ComposeContext } from './mailout-compose';

export type MailSendingProvider = 'simulator' | 'ses';
export type MailDomainCheckStatus = 'NOT_STARTED' | 'PENDING' | 'SUCCESS' | 'FAILED' | 'TEMPORARY_FAILURE';

/** Un registro DNS que la compañía publica para su dominio de envío. */
export interface DnsRecord {
  type: 'CNAME' | 'MX' | 'TXT';
  /** Nombre completo, con el dominio (`abc._domainkey.example.com`). */
  name: string;
  value: string;
  /** Solo en MX. */
  priority?: number;
  /** Para qué sirve: firma (DKIM), rebotes (MAIL FROM) o política (DMARC). */
  purpose: 'dkim' | 'mail_from' | 'dmarc';
  /** DMARC: se sugiere solo si el dominio no tiene uno. */
  suggested?: boolean;
}

export interface MailDomainItem {
  id: string;
  workspace_id: string;
  provider: MailSendingProvider;
  domain: string;
  mail_from_subdomain: string;
  tenant_name: string | null;
  configuration_set: string | null;
  from_local_part: string;
  from_name: string | null;
  dkim_status: MailDomainCheckStatus;
  mail_from_status: MailDomainCheckStatus;
  dns_records: DnsRecord[];
  dmarc_record: string | null;
  last_error: string | null;
  checked_at: string | null;
  verified_at: string | null;
  created_at: string;
}

export const MAIL_DOMAIN_SELECT =
  'id,workspace_id,provider,domain,mail_from_subdomain,tenant_name,configuration_set,from_local_part,from_name,dkim_status,mail_from_status,dns_records,dmarc_record,last_error,checked_at,verified_at,created_at';

export interface MailDomainsResponse {
  items: MailDomainItem[];
  /** Admin del espacio: da de alta, comprueba y quita. */
  can_manage: boolean;
  /** Con qué se dan de alta los dominios nuevos en este Worker (ADR-111). */
  mode: MailSendingProvider;
  /** false: el Worker no puede hablar con el servicio de envío (falta config). */
  configured: boolean;
  /** Nombre del espacio: el remitente por defecto. */
  workspace_name: string | null;
}

/** Estado de un dominio en la pantalla. */
export type MailDomainState = 'verified' | 'pending' | 'failed';

export function domainState(d: Pick<MailDomainItem, 'verified_at' | 'dkim_status' | 'mail_from_status'>): MailDomainState {
  if (d.verified_at) return 'verified';
  if (d.dkim_status === 'FAILED' || d.mail_from_status === 'FAILED') return 'failed';
  return 'pending';
}

const DOMAIN_RE = /^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;
const LOCAL_PART_RE = /^[a-z0-9]([a-z0-9._+-]{0,62}[a-z0-9])?$/;

/** Lo que escribe una persona: sin espacios, en minúsculas, sin `https://` ni barra final. */
export function normalizeDomain(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .replace(/\/.*$/, '')
    .replace(/\.$/, '');
}

export function senderAddress(localPart: string, domain: string): string {
  return `${localPart}@${domain}`;
}

const localPart = v.pipe(v.string(), v.trim(), v.toLowerCase(), v.regex(LOCAL_PART_RE));
const fromName = v.nullish(v.pipe(v.string(), v.trim(), v.maxLength(100)));

export const MailDomainCreateSchema = v.object({
  workspace_id: v.pipe(v.string(), v.uuid()),
  domain: v.pipe(v.string(), v.transform(normalizeDomain), v.maxLength(253), v.regex(DOMAIN_RE)),
  from_local_part: v.optional(localPart, 'difusion'),
  from_name: fromName,
});

export const MailDomainSenderSchema = v.object({
  from_local_part: localPart,
  from_name: fromName,
});

// ── Fase 3: el envío (ADR-115) ────────────────────────────────────────────

type MailoutStatus = 'draft' | 'review' | 'queued' | 'sending' | 'paused' | 'done' | 'cancelled';
type MailoutRecipientStatus =
  | 'pending'
  | 'queued'
  | 'sending'
  | 'sent'
  | 'delivered'
  | 'bounced'
  | 'complained'
  | 'skipped'
  | 'failed';
export type MailoutSkipReason =
  | 'suppressed'
  | 'no_basis'
  | 'no_address'
  | 'duplicate'
  | 'cancelled'
  | 'unavailable'
  | 'not_now';

export interface MailoutItem {
  id: string;
  workspace_id: string;
  project_id: string;
  line_id: string | null;
  mail_domain_id: string | null;
  from_local_part: string;
  from_name: string | null;
  from_address: string | null;
  reply_to_address: string | null;
  language: string;
  subject: string | null;
  body: string | null;
  status: MailoutStatus;
  status_reason: string | null;
  queued_at: string | null;
  finished_at: string | null;
  created_at: string;
}

export const MAILOUT_SELECT =
  'id,workspace_id,project_id,line_id,mail_domain_id,from_local_part,from_name,from_address,reply_to_address,language,subject,body,status,status_reason,queued_at,finished_at,created_at';

/** Una fila de `mailout_preview`. */
export interface MailoutRecipientRow {
  recipient_id: string;
  conversation_id: string;
  address: string | null;
  display_name: string | null;
  address_kind: 'contact' | 'organization' | null;
  status: MailoutRecipientStatus;
  /** En un borrador, `not_now` con `status` pendiente: lo que pasará al poner en cola (ADR-138 § 3). */
  skip_reason: MailoutSkipReason | null;
  basis_kind: 'consent' | 'relationship' | 'generic' | null;
  basis_withdrawn_at: string | null;
  suppressed_reason: 'unsubscribe' | 'bounce' | 'complaint' | 'manual' | null;
  suppressed_at: string | null;
  ready: boolean;
}

/** GET /api/mailout/[id]. */
export interface MailoutDetail {
  mailout: MailoutItem;
  /** `edit:conversation` en el proyecto: redactar, enviar, cancelar. */
  can_edit: boolean;
  workspace: { id: string; slug: string; name: string };
  project: { id: string; slug: string; name: string | null } | null;
  /** Los dominios verificados del espacio: de dónde puede salir. */
  domains: MailDomainItem[];
  /** A dónde irán las respuestas si se envía ahora (buzón conectado) o null: aviso. */
  reply_to: { address: string; scope: 'personal' | 'workspace' } | null;
  recipients: MailoutRecipientRow[];
  /** Lo que monta cada correo (mailout-compose.ts), por destinatario visible. */
  compose: ComposeContext[];
  /** Modo de prueba: no sale ningún correo real (ADR-111). */
  simulated: boolean;
}

/** El estado de un destinatario en la pantalla, antes y después de enviar. */
export type RecipientState =
  | 'ready'
  | 'no_address'
  | 'suppressed'
  | 'no_basis'
  | 'duplicate'
  | 'unavailable'
  | 'cancelled'
  | 'not_now'
  | 'missing_fields'
  | 'queued'
  | 'sent'
  | 'delivered'
  | 'bounced'
  | 'complained'
  | 'failed';

export function recipientState(r: MailoutRecipientRow, missing: boolean): RecipientState {
  switch (r.status) {
    case 'pending':
      if (!r.address) return 'no_address';
      if (r.skip_reason === 'not_now') return 'not_now';
      if (r.suppressed_reason) return 'suppressed';
      if (!r.basis_kind || r.basis_withdrawn_at) return 'no_basis';
      return missing ? 'missing_fields' : 'ready';
    case 'skipped':
      return r.skip_reason ?? 'unavailable';
    case 'queued':
    case 'sending':
      return 'queued';
    default:
      return r.status;
  }
}

/** Recuentos de la pantalla de estado (plan § 10). */
export function recipientCounts(states: RecipientState[]): Record<RecipientState, number> {
  const out = {} as Record<RecipientState, number>;
  for (const s of states) out[s] = (out[s] ?? 0) + 1;
  return out;
}

export const MailoutCreateSchema = v.object({
  project_id: v.pipe(v.string(), v.uuid()),
  conversation_ids: v.pipe(v.array(v.pipe(v.string(), v.uuid())), v.minLength(1), v.maxLength(2000)),
});

export const MailoutUpdateSchema = v.object({
  subject: v.pipe(v.string(), v.maxLength(200)),
  body: v.pipe(v.string(), v.maxLength(20000)),
  language: v.picklist(['es', 'ca', 'en', 'fr']),
  mail_domain_id: v.nullable(v.pipe(v.string(), v.uuid())),
  from_local_part: localPart,
  from_name: fromName,
});

export const MailoutRecipientsSchema = v.object({
  conversation_ids: v.pipe(v.array(v.pipe(v.string(), v.uuid())), v.maxLength(2000)),
});

export const MailBasisSchema = v.object({
  recipient_id: v.pipe(v.string(), v.uuid()),
  kind: v.picklist(['consent', 'relationship', 'generic']),
  note: v.nullish(v.pipe(v.string(), v.trim(), v.maxLength(1000))),
});
