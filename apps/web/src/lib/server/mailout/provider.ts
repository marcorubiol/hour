/**
 * El servicio que envía los envíos en bloque (ADR-109, ADR-111).
 *
 * El Worker solo habla con `SendingProvider`. Hoy hay dos adaptadores:
 *   · `simulator` (simulator.ts): no envía nada. Da de alta un dominio con los
 *     registros que pediría SES y lo da por verificado al comprobarlo. Es el de
 *     todos los dominios mientras no haya cuenta de AWS (ADR-111).
 *   · `ses` (ses.ts): esqueleto. Falla claro si falta su configuración y,
 *     configurado, todavía no está escrito (fase 2 con cuenta).
 * El envío de cada correo y sus eventos se añaden a esta interfaz en la fase 3.
 *
 * Qué adaptador usa un dominio lo dice su fila (`mail_domain.provider`), no el
 * Worker: un dominio dado de alta en el simulador se comprueba en el simulador
 * aunque después llegue la cuenta.
 */

import type { DnsRecord, MailDomainCheckStatus, MailSendingProvider } from '$lib/mailout';

export interface DomainIdentity {
  domain: string;
  mailFromSubdomain: string;
  /** `hour-<espacio>`: el tenant y el configuration set del espacio en SES. */
  tenantName: string | null;
  configurationSet: string | null;
}

/** Lo que se escribe en la base con `mail_domain_record_status`. */
export interface DomainStatus {
  dkimStatus: MailDomainCheckStatus;
  mailFromStatus: MailDomainCheckStatus;
  records: DnsRecord[];
  dmarcRecord: string | null;
  error: string | null;
}

export interface SendingProvider {
  readonly kind: MailSendingProvider;
  /** Da de alta la identidad del dominio y devuelve los registros que publicar. */
  registerDomain(identity: DomainIdentity): Promise<DomainStatus>;
  /** Lee el estado de la identidad («Comprobar», y el cron mientras esté pendiente). */
  checkDomain(identity: DomainIdentity): Promise<DomainStatus>;
}

/** Falta configuración en el Worker para hablar con el servicio. */
export class MailoutNotConfiguredError extends Error {
  constructor(public readonly missing: string[]) {
    super(`mailout provider not configured: missing ${missing.join(', ')}`);
  }
}
