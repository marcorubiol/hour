/**
 * POST /api/mailout/[id]/send → «Enviar a N» (plan § 10, § 6).
 *
 * Antes de poner en cola, el mismo montaje que la vista previa: si a un
 * destinatario listo le falta un campo (`{sala}`, `{ciudad}`…), 409
 * `missing_fields` y nada sale vacío. Después `queue_mailout` con el JWT (la
 * base comprueba dominio, contenido, modo simulador, supresión y base) y una
 * primera pasada de la cola de este envío con `ctx.waitUntil`, para que un
 * envío pequeño no espere al cron del minuto.
 */

import type { RequestHandler } from './$types';
import { pgPostRpc } from '$lib/supabase';
import { json } from '$lib/server/mail/http';
import { mailoutRoute, pgMessage, previewRows, readMailout } from '$lib/server/mailout/route';
import { runMailoutQueue } from '$lib/server/mailout/queue';
import { mailoutMissing, MailoutNotConfiguredError } from '$lib/server/mailout';
import { notConfigured, readDomain } from '$lib/server/mailout/http';
import { composeMailout } from '$lib/mailout-compose';
import { recipientState, type MailoutItem } from '$lib/mailout';

const QUEUE_REFUSALS: [RegExp, string][] = [
  [/simulator/, 'simulator_only'],
  [/no recipient/, 'no_recipients'],
  [/not verified/, 'domain_not_verified'],
  [/subject and body/, 'empty'],
  [/only a draft/, 'not_draft'],
];

export const POST: RequestHandler = (event) =>
  mailoutRoute(event, 'POST /api/mailout/[id]/send', async ({ env, jwt, id }) => {
    const mailout = await readMailout(env, jwt, id);
    if (!mailout) return json({ error: 'not_found' }, 404);
    // Sin lo que necesita la cola para este dominio (clave de servicio; con
    // SES, sus claves), no se pone en cola: no saldría nunca.
    const domain = mailout.mail_domain_id ? await readDomain(env, jwt, mailout.mail_domain_id) : null;
    if (!domain?.verified_at) return json({ error: 'domain_not_verified' }, 409);
    const missingConfig = mailoutMissing(domain.provider, env);
    if (missingConfig.length) return notConfigured(new MailoutNotConfiguredError(missingConfig));
    const { recipients, compose } = await previewRows(env, jwt, id);
    const ctx = new Map(compose.map((c) => [c.recipient_id, c]));
    const draft = { subject: mailout.subject ?? '', body: mailout.body ?? '', language: mailout.language };
    const missing = recipients.filter((r) => {
      const c = ctx.get(r.recipient_id);
      return recipientState(r, false) === 'ready' && c && composeMailout(draft, c, '').missing.length > 0;
    }).length;
    if (missing) return json({ error: 'missing_fields', count: missing }, 409);

    let queued: MailoutItem | undefined;
    try {
      queued = (await pgPostRpc<MailoutItem>(env, 'queue_mailout', jwt, { p_id: id })).data[0];
    } catch (err) {
      const message = pgMessage(err);
      const refusal = QUEUE_REFUSALS.find(([re]) => re.test(message));
      if (refusal) return json({ error: refusal[1] }, 409);
      throw err;
    }
    if (queued?.status === 'queued') {
      const first = runMailoutQueue(env, { mailoutId: id }).catch((err: unknown) => {
        console.error(
          JSON.stringify({ level: 'error', kind: 'mailout_first_pass_failed', message: err instanceof Error ? err.message : String(err) }),
        );
      });
      event.platform?.ctx?.waitUntil(first);
    }
    return json({ status: queued?.status ?? 'queued' });
  });
