/**
 * Envío en bloque (ADR-109, ADR-110): tipos y esquemas que comparten el
 * Worker y la pantalla. Aquí no hay nada de servidor.
 */

import * as v from 'valibot';

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

export const DOMAIN_RE = /^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;
export const LOCAL_PART_RE = /^[a-z0-9]([a-z0-9._+-]{0,62}[a-z0-9])?$/;

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
