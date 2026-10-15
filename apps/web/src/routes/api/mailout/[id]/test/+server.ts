/**
 * POST /api/mailout/[id]/test { recipient_id? } → «Enviarme una prueba»
 * (plan § 10): el correo de un destinatario (el que se está mirando, o el
 * primero listo) a tu propio email (`mailout_test_authorize`), con «[Prueba]»
 * delante del asunto y sin registro en ninguna conversación. Sale por el
 * adaptador del dominio del envío: con el simulador, no sale nada.
 */

import type { RequestHandler } from './$types';
import * as v from 'valibot';
import { pgPostRpc, type SupabaseEnv } from '$lib/supabase';
import { json } from '$lib/server/mail/http';
import { loadDetail, mailoutRoute, readBody } from '$lib/server/mailout/route';
import { mailoutLinkOrigin, MailoutNotConfiguredError, sendingProvider } from '$lib/server/mailout';
import { notConfigured } from '$lib/server/mailout/http';
import { composeMailout, testSubject, unsubscribeHeaders, unsubscribeUrl } from '$lib/mailout-compose';
import { recipientState, senderAddress } from '$lib/mailout';

const TestSchema = v.object({ recipient_id: v.nullish(v.pipe(v.string(), v.uuid())) });

export const POST: RequestHandler = (event) =>
  mailoutRoute(event, 'POST /api/mailout/[id]/test', async ({ env, jwt, id }) => {
    const body = await readBody(event.request, TestSchema);
    if (body instanceof Response) return body;
    const to = (await pgPostRpc<string>(env as SupabaseEnv, 'mailout_test_authorize', jwt, { p_id: id })).data[0];
    const d = await loadDetail(env, jwt, id);
    if (!d || !to) return json({ error: 'not_found' }, 404);
    const m = d.mailout;
    const domain = d.domains.find((x) => x.id === m.mail_domain_id);
    if (!domain) return json({ error: 'domain_not_verified' }, 409);
    if (!m.subject || !m.body) return json({ error: 'empty' }, 409);
    const row =
      d.recipients.find((r) => r.recipient_id === body.recipient_id) ??
      d.recipients.find((r) => recipientState(r, false) === 'ready');
    const ctx = d.compose.find((c) => c.recipient_id === row?.recipient_id);
    if (!row || !ctx) return json({ error: 'no_recipients' }, 409);

    const url = unsubscribeUrl(mailoutLinkOrigin(env), 'prueba');
    const mail = composeMailout({ subject: m.subject, body: m.body, language: m.language }, ctx, url);
    if (mail.missing.length) return json({ error: 'missing_fields', count: 1 }, 409);
    try {
      const provider = sendingProvider(domain.provider, env);
      await provider.sendEmail({
        from: senderAddress(m.from_local_part, domain.domain),
        fromName: m.from_name,
        to,
        toName: null,
        replyTo: d.reply_to?.address ?? null,
        subject: testSubject(mail.subject, m.language),
        text: mail.text,
        html: mail.html,
        headers: unsubscribeHeaders(url),
        tenantName: domain.tenant_name,
        configurationSet: domain.configuration_set,
        tags: { mailout: m.id, test: 'true' },
      });
      return json({ to, simulated: provider.kind === 'simulator' });
    } catch (err) {
      if (err instanceof MailoutNotConfiguredError) return notConfigured(err);
      throw err;
    }
  });
