/**
 * Envío en bloque (ADR-109, ADR-110): tipos y esquemas que comparten el
 * Worker y la pantalla. Aquí no hay nada de servidor.
 */

import * as v from 'valibot';
import type { ComposeContext } from './mailout-compose';
import type { MailTemplateRow } from './mail-template';

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

/** Para qué sirve un dominio (ADR-173 § 5): la difusión o el público. */
export type MailDomainPurpose = 'outreach' | 'audience';

export interface MailDomainItem {
  id: string;
  workspace_id: string;
  provider: MailSendingProvider;
  purpose: MailDomainPurpose;
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
  'id,workspace_id,provider,purpose,domain,mail_from_subdomain,tenant_name,configuration_set,from_local_part,from_name,dkim_status,mail_from_status,dns_records,dmarc_record,last_error,checked_at,verified_at,created_at';

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
  purpose: v.optional(v.picklist(['outreach', 'audience']), 'outreach'),
  domain: v.pipe(v.string(), v.transform(normalizeDomain), v.maxLength(253), v.regex(DOMAIN_RE)),
  /** Sin ella, la de su propósito: `difusion` o `hola` (add_mail_domain). */
  from_local_part: v.optional(localPart),
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

export type MailoutKind = 'outreach' | 'invitation';

export interface MailoutItem {
  id: string;
  workspace_id: string;
  /** Un envío de difusión o una invitación (ADR-173). */
  kind: MailoutKind;
  /** Una invitación puede no tener proyecto. */
  project_id: string | null;
  /** La lista de una invitación y su identidad (el subdominio del público). */
  audience_id: string | null;
  audience_mail_domain_id: string | null;
  /** La función a la que se invita: `{sala}` y `{ciudad}`. */
  performance_id: string | null;
  created_by: string | null;
  line_id: string | null;
  mail_domain_id: string | null;
  from_local_part: string;
  from_name: string | null;
  from_address: string | null;
  reply_to_address: string | null;
  language: string;
  subject: string | null;
  body: string | null;
  /** La imagen del espectáculo (ADR-172): ruta de Hour, su `alt` y a dónde lleva (el dossier). */
  image_url: string | null;
  image_alt: string | null;
  image_link_url: string | null;
  status: MailoutStatus;
  status_reason: string | null;
  queued_at: string | null;
  finished_at: string | null;
  created_at: string;
}

export const MAILOUT_SELECT =
  'id,workspace_id,kind,project_id,audience_id,audience_mail_domain_id,performance_id,created_by,line_id,mail_domain_id,from_local_part,from_name,from_address,reply_to_address,language,subject,body,image_url,image_alt,image_link_url,status,status_reason,queued_at,finished_at,created_at';

/** Una fila de `mailout_preview`. */
export interface MailoutRecipientRow {
  recipient_id: string;
  /** El origen (ADR-173 § 10): una conversación o una persona del público. */
  conversation_id: string | null;
  audience_subscription_id: string | null;
  /** La identidad por la que sale, una vez en cola. */
  mail_domain_id: string | null;
  address: string | null;
  display_name: string | null;
  address_kind: 'contact' | 'organization' | 'subscriber' | null;
  status: MailoutRecipientStatus;
  /** En un borrador, `not_now` con `status` pendiente: lo que pasará al poner en cola (ADR-138 § 3). */
  skip_reason: MailoutSkipReason | null;
  basis_kind: 'consent' | 'relationship' | 'generic' | 'sector' | null;
  basis_withdrawn_at: string | null;
  suppressed_reason: 'unsubscribe' | 'bounce' | 'complaint' | 'manual' | null;
  suppressed_at: string | null;
  ready: boolean;
}

/** La lista de una invitación, como la pinta su bloque «Público». */
export interface InvitationAudience {
  id: string;
  name: string;
  /** Confirmadas que pueden recibir (sin importaciones en revisión). */
  eligible: number;
  /** De esas, las que ya van como profesionales en esta invitación. */
  as_pros: number;
  /** La lista tiene más confirmadas de las que se han contado: los números se quedan cortos. */
  truncated: boolean;
}

/** Una persona del público en la vista previa de un borrador: lo que se monta y a quién va. */
export type AudiencePreview = ComposeContext & { address: string; display_name: string | null };

/** La función de una invitación. */
export interface InvitationPerformance {
  id: string;
  performed_at: string;
  venue_name: string | null;
  city: string | null;
  /** 102: `{obra}` sin proyecto en el envío, `{hora}` y el reloj en que se lee. */
  project_name: string | null;
  start_at: string | null;
  timezone: string | null;
}

/** GET /api/mailout/[id]. */
export interface MailoutDetail {
  mailout: MailoutItem;
  /** Redactar, enviar, cancelar: `edit:conversation` en el proyecto, o en una invitación quien la creó o lleva el público. */
  can_edit: boolean;
  /** Una invitación: ver y elegir listas (la faceta Público con «ver y editar»). */
  can_edit_audience: boolean;
  /** Las listas del espacio que se pueden elegir en una invitación. */
  audiences: { id: string; name: string }[];
  /** La lista elegida, con cuántas recibirán. */
  audience: InvitationAudience | null;
  /** El dominio del público (verificado o no) de una invitación con lista. */
  audience_domain: MailDomainItem | null;
  performance: InvitationPerformance | null;
  /**
   * Una muestra del público para la vista previa de un borrador: sus
   * destinatarios se congelan al poner en cola, así que antes no hay filas.
   * Lo mismo que daría `mailout_compose_preview` a cada persona.
   */
  audience_preview: AudiencePreview[];
  /** `logo_url`: la cabecera de la plantilla del correo (ADR-172). */
  workspace: { id: string; slug: string; name: string; logo_url: string | null };
  project: { id: string; slug: string; name: string | null } | null;
  /** Los dominios verificados de la difusión del espacio: de dónde sale (y un profesional de una invitación). */
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
      // La base de una persona del público es su suscripción, no `mail_basis`.
      if (r.audience_subscription_id === null && (!r.basis_kind || r.basis_withdrawn_at)) return 'no_basis';
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
/** Las piezas de la plantilla (ADR-172) de lo que ya trae la pantalla: lo mismo que `mailout_template` a la cola. */
export function detailTemplateRow(d: Pick<MailoutDetail, 'mailout' | 'workspace'>): MailTemplateRow {
  return {
    company_name: d.workspace.name,
    logo_url: d.workspace.logo_url,
    image_url: d.mailout.image_url,
    image_alt: d.mailout.image_alt,
    image_link_url: d.mailout.image_link_url,
  };
}

export function recipientCounts(states: RecipientState[]): Record<RecipientState, number> {
  const out = {} as Record<RecipientState, number>;
  for (const s of states) out[s] = (out[s] ?? 0) + 1;
  return out;
}

export const MailoutCreateSchema = v.object({
  project_id: v.pipe(v.string(), v.uuid()),
  conversation_ids: v.pipe(v.array(v.pipe(v.string(), v.uuid())), v.minLength(1), v.maxLength(2000)),
});

/** Una imagen de envío que sirve Hour (`/m/ws/<espacio>/mail/…`); el espacio lo comprueba la base. */
const MAILOUT_IMAGE_RE = /^\/m\/ws\/[0-9a-f-]{36}\/mail\/[A-Za-z0-9._-]+$/;

/** La imagen del espectáculo de un envío (ADR-172). */
export const MailoutImageSchema = v.object({
  url: v.pipe(v.string(), v.maxLength(300), v.regex(MAILOUT_IMAGE_RE)),
  alt: v.nullish(v.pipe(v.string(), v.trim(), v.maxLength(200))),
  link: v.nullish(v.pipe(v.string(), v.trim(), v.maxLength(2000), v.regex(/^(https?:\/\/[^\s<>"]+)?$/i))),
});

export const MailoutUpdateSchema = v.object({
  subject: v.pipe(v.string(), v.maxLength(200)),
  body: v.pipe(v.string(), v.maxLength(20000)),
  language: v.picklist(['es', 'ca', 'en', 'fr']),
  mail_domain_id: v.nullable(v.pipe(v.string(), v.uuid())),
  from_local_part: localPart,
  from_name: fromName,
  /** Solo cuando cambia: ausente no la toca, null la quita. */
  image: v.optional(v.nullable(MailoutImageSchema)),
});

export const MailoutRecipientsSchema = v.object({
  conversation_ids: v.pipe(v.array(v.pipe(v.string(), v.uuid())), v.maxLength(2000)),
});

export const MailBasisSchema = v.object({
  recipient_id: v.pipe(v.string(), v.uuid()),
  kind: v.picklist(['consent', 'relationship', 'generic', 'sector']),
  note: v.nullish(v.pipe(v.string(), v.trim(), v.maxLength(1000))),
});
