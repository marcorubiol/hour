/**
 * El servicio que envía los envíos en bloque (ADR-109, ADR-111).
 *
 * El Worker solo habla con `SendingProvider`. Hoy hay dos adaptadores:
 *   · `simulator` (simulator.ts): no envía nada. Da de alta un dominio con los
 *     registros que pediría SES y lo da por verificado al comprobarlo. Es el de
 *     todos los dominios mientras no haya cuenta de AWS (ADR-111).
 *   · `ses` (ses.ts): esqueleto. Falla claro si falta su configuración y,
 *     configurado, todavía no está escrito (fase 2 con cuenta).
 * Desde la fase 3 la interfaz también envía un correo (`sendEmail`); el
 * simulado no envía nada y devuelve los eventos que daría el servicio.
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

/** Un correo de un envío, ya montado (mailout-compose.ts). */
export interface OutgoingEmail {
  from: string;
  fromName: string | null;
  to: string;
  toName: string | null;
  replyTo: string | null;
  subject: string;
  text: string;
  html: string;
  /** List-Unsubscribe y List-Unsubscribe-Post (RFC 8058). */
  headers: Record<string, string>;
  tenantName: string | null;
  configurationSet: string | null;
  /** Etiquetas del mensaje: `recipient` cierra la fila aunque el registro no llegue (plan § 6). */
  tags: Record<string, string>;
}

/** Lo que el servicio dice después de aceptar un correo. */
export interface ProviderEvent {
  type: 'delivery' | 'bounce' | 'complaint';
  bounceType?: 'Permanent' | 'Transient';
}

export interface SentEmail {
  providerMessageId: string;
  /** El Message-ID de la cabecera: lo que citará una respuesta en In-Reply-To. */
  rfcMessageId: string | null;
  /** Solo el simulador: los eventos que llegarían después (con SES llegan por EventBridge, fase 4). */
  events: ProviderEvent[];
}

export interface SendingProvider {
  readonly kind: MailSendingProvider;
  /** Da de alta la identidad del dominio y devuelve los registros que publicar. */
  registerDomain(identity: DomainIdentity): Promise<DomainStatus>;
  /** Lee el estado de la identidad («Comprobar», y el cron mientras esté pendiente). */
  checkDomain(identity: DomainIdentity): Promise<DomainStatus>;
  /** Envía un correo. Falla con MailoutSendError (permanente o con reintento). */
  sendEmail(email: OutgoingEmail): Promise<SentEmail>;
}

/** El servicio no aceptó un correo. `permanent`: no se reintenta (contenido rechazado, dominio caído). */
export class MailoutSendError extends Error {
  constructor(
    message: string,
    public readonly permanent: boolean,
  ) {
    super(message);
  }
}

/** Falta configuración en el Worker para hablar con el servicio. */
export class MailoutNotConfiguredError extends Error {
  constructor(public readonly missing: string[]) {
    super(`mailout provider not configured: missing ${missing.join(', ')}`);
  }
}
