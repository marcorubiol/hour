/**
 * Vaciar la cola del envío en bloque (plan § 6, ADR-115).
 *
 * La cola es la tabla: `mailout_claim` toma destinatarios `queued` (reparto
 * justo entre espacios, tope diario de 24 horas, y vuelve a mirar supresión y
 * base justo antes de tomarlos), los deja en `sending` con su arriendo y
 * devuelve lo que hace falta para enviar. Después, por cada uno:
 *   montar (mailout-compose.ts con `mailout_send_context`) → enviar con el
 *   adaptador de su dominio → `mailout_record_sent` (estado, evento en la
 *   conversación con el asunto de ese destinatario, last_contacted_at) → los eventos que devuelva el simulador
 *   (`mailout_record_event`).
 * Si falla: `mailout_record_failure`, con reintento a 1, 5, 15 y 60 minutos
 * (la base lo pasa a `failed` en el quinto) o sin él si el fallo es
 * permanente (contenido rechazado, un campo sin valor).
 *
 * Lo llaman el cron de cada minuto (worker-cron.ts) y la primera pasada al
 * poner un envío en cola (`ctx.waitUntil`, solo ese envío).
 * Solo imports relativos: lo empaqueta también wrangler (worker-cron.ts).
 */

import {
  composeMailout,
  unsubscribeHeaders,
  unsubscribeUrl,
  type ComposeContext,
} from '../../mailout-compose';
import type { MailSendingProvider } from '../../mailout';
import { serviceRpc } from './db';
import { MailoutSendError, type SendingProvider } from './provider';
import { mailoutLinkOrigin, sendingProvider, type MailoutEnv } from './index';

/** Una fila de `mailout_claim`. */
export interface ClaimedRecipient {
  recipient_id: string;
  mailout_id: string;
  workspace_id: string;
  conversation_id: string;
  address: string;
  display_name: string | null;
  address_kind: 'contact' | 'organization';
  basis_kind: 'consent' | 'relationship' | 'generic';
  unsubscribe_token: string;
  attempts: number;
  provider: MailSendingProvider;
  tenant_name: string | null;
  configuration_set: string | null;
  from_address: string;
  from_name: string | null;
  reply_to_address: string | null;
  language: string;
  subject: string;
  body: string;
}

/** Lo que la cola necesita de la base: los tests lo simulan en memoria. */
export interface MailoutQueueDb {
  claim(limit: number, mailoutId?: string): Promise<ClaimedRecipient[]>;
  context(recipientIds: string[]): Promise<ComposeContext[]>;
  recordSent(
    recipientId: string,
    providerMessageId: string,
    rfcMessageId: string | null,
    body: string,
    subject: string,
  ): Promise<void>;
  recordFailure(recipientId: string, error: string, retryAt: string | null): Promise<void>;
  recordEvent(payload: Record<string, unknown>): Promise<void>;
}

export function serviceQueueDb(env: Partial<MailoutEnv>, fetchFn: typeof fetch = fetch): MailoutQueueDb {
  return {
    claim: (limit, mailoutId) =>
      serviceRpc<ClaimedRecipient[]>(env, 'mailout_claim', { p_limit: limit, p_mailout_id: mailoutId ?? null }, fetchFn),
    context: (ids) => serviceRpc<ComposeContext[]>(env, 'mailout_send_context', { p_recipient_ids: ids }, fetchFn),
    recordSent: async (id, providerMessageId, rfc, body, subject) => {
      await serviceRpc(
        env,
        'mailout_record_sent',
        { p_recipient_id: id, p_provider_message_id: providerMessageId, p_rfc_message_id: rfc, p_body: body, p_subject: subject },
        fetchFn,
      );
    },
    recordFailure: async (id, error, retryAt) => {
      await serviceRpc(env, 'mailout_record_failure', { p_recipient_id: id, p_error: error, p_retry_at: retryAt }, fetchFn);
    },
    recordEvent: async (payload) => {
      await serviceRpc(env, 'mailout_record_event', { p_payload: payload }, fetchFn);
    },
  };
}

/**
 * Correos por pasada. Cada correo son de 1 a 4 subpeticiones (servicio,
 * registro y hasta dos eventos) y la pasada 2 más (tomar y montar): con 10 se
 * queda por debajo de las 50 del plan Free de Workers (suposición: no se ha
 * mirado el plan de Hour; con Paid se puede subir).
 */
export const MAILOUT_BATCH = 10;

const RETRY_MINUTES = [1, 5, 15, 60];

/** Cuándo vuelve a intentarlo, según cuántos intentos lleva (ya contado el de ahora). */
export function retryAt(attempts: number, now: Date = new Date()): string {
  const minutes = RETRY_MINUTES[Math.min(Math.max(attempts, 1), RETRY_MINUTES.length) - 1];
  return new Date(now.getTime() + minutes * 60_000).toISOString();
}

export interface QueueResult {
  claimed: number;
  sent: number;
  failed: number;
  retried: number;
}

export interface QueueOptions {
  mailoutId?: string;
  limit?: number;
  db?: MailoutQueueDb;
  providerFor?: (kind: MailSendingProvider) => SendingProvider;
  now?: () => Date;
}

export async function runMailoutQueue(env: Partial<MailoutEnv>, opts: QueueOptions = {}): Promise<QueueResult> {
  const db = opts.db ?? serviceQueueDb(env);
  const providerFor = opts.providerFor ?? ((kind: MailSendingProvider) => sendingProvider(kind, env));
  const now = opts.now ?? (() => new Date());
  const origin = mailoutLinkOrigin(env);
  const result: QueueResult = { claimed: 0, sent: 0, failed: 0, retried: 0 };

  const claimed = await db.claim(opts.limit ?? MAILOUT_BATCH, opts.mailoutId);
  result.claimed = claimed.length;
  if (!claimed.length) return result;
  const contexts = new Map((await db.context(claimed.map((r) => r.recipient_id))).map((c) => [c.recipient_id, c]));

  for (const r of claimed) {
    let accepted = false;
    const fail = async (error: string, permanent: boolean) => {
      await db.recordFailure(r.recipient_id, error.slice(0, 500), permanent ? null : retryAt(r.attempts, now()));
      if (permanent || r.attempts >= 5) result.failed += 1;
      else result.retried += 1;
    };
    try {
      const ctx = contexts.get(r.recipient_id);
      if (!ctx) {
        await fail('no_context', true);
        continue;
      }
      const url = unsubscribeUrl(origin, r.unsubscribe_token);
      const mail = composeMailout({ subject: r.subject, body: r.body, language: r.language }, ctx, url);
      if (mail.missing.length) {
        await fail(`missing_fields:${mail.missing.join(',')}`, true);
        continue;
      }
      const sent = await providerFor(r.provider).sendEmail({
        from: r.from_address,
        fromName: r.from_name,
        to: r.address,
        toName: r.display_name,
        replyTo: r.reply_to_address,
        subject: mail.subject,
        text: mail.text,
        html: mail.html,
        headers: unsubscribeHeaders(url),
        tenantName: r.tenant_name,
        configurationSet: r.configuration_set,
        tags: { recipient: r.recipient_id, mailout: r.mailout_id },
      });
      accepted = true;
      await db.recordSent(r.recipient_id, sent.providerMessageId, sent.rfcMessageId, mail.recordBody, mail.subject);
      result.sent += 1;
      for (const e of sent.events) {
        await db.recordEvent({
          provider_event_id: `${sent.providerMessageId}:${e.type}`,
          recipient_id: r.recipient_id,
          type: e.type,
          bounce_type: e.bounceType ?? null,
          occurred_at: now().toISOString(),
          detail: { simulated: true },
        });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(JSON.stringify({ level: 'error', kind: 'mailout_send_failed', recipient: r.recipient_id, message }));
      // El correo salió y lo que falló fue apuntarlo: no se toca la fila. Si
      // no llegó a `sent`, el arriendo caduca y vuelve a la cola (doble envío
      // posible, plan § 6).
      if (accepted) continue;
      await fail(message, err instanceof MailoutSendError && err.permanent).catch(() => undefined);
    }
  }
  return result;
}
