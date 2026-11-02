/**
 * POST /api/mailout/[id]/test { recipient_id? } → «Enviarme una prueba»
 * (plan § 10): el correo de un destinatario (el que se está mirando, o el
 * primero listo) a tu propio email (`mailout_test_authorize`), con «[Prueba]»
 * delante del asunto y sin registro en ninguna conversación. Sale por el
 * adaptador del dominio del envío: con el simulador, no sale nada.
 *
 * En una invitación, una prueba por identidad (ADR-173 § 10): con
 * `audience_subscription_id`, el correo de esa persona del público desde el
 * dominio del público y con su pie; si no, el de un profesional desde el de
 * la difusión.
 */

import type { RequestHandler } from './$types';
import * as v from 'valibot';
import { pgPostRpc, type SupabaseEnv } from '$lib/supabase';
import { jsonNoStore } from '$lib/server/http';
import { loadDetail, mailoutRoute, readBody } from '$lib/server/mailout/route';
import { mailoutLinkOrigin, MailoutNotConfiguredError, sendingProvider } from '$lib/server/mailout';
import { notConfigured } from '$lib/server/mailout/http';
import { composeMailout, testSubject, unsubscribeHeaders, unsubscribeUrl } from '$lib/mailout-compose';
import { detailTemplateRow, recipientState, senderAddress } from '$lib/mailout';
import { mailTemplate } from '$lib/mail-template';

const TestSchema = v.object({
  recipient_id: v.nullish(v.pipe(v.string(), v.uuid())),
  audience_subscription_id: v.nullish(v.pipe(v.string(), v.uuid())),
});

export const POST: RequestHandler = (event) =>
  mailoutRoute(event, 'POST /api/mailout/[id]/test', async ({ env, jwt, id }) => {
    const body = await readBody(event.request, TestSchema);
    if (body instanceof Response) return body;
    const to = (await pgPostRpc<string>(env as SupabaseEnv, 'mailout_test_authorize', jwt, { p_id: id })).data[0];
    const d = await loadDetail(env, jwt, id);
    if (!d || !to) return jsonNoStore({ error: 'not_found' }, 404);
    const m = d.mailout;
    if (!m.subject || !m.body) return jsonNoStore({ error: 'empty' }, 409);
    const audience = Boolean(body.audience_subscription_id);
    const domain = audience
      ? d.audience_domain?.verified_at
        ? d.audience_domain
        : null
      : d.domains.find((x) => x.id === m.mail_domain_id);
    if (!domain) return jsonNoStore({ error: audience ? 'audience_domain_not_verified' : 'domain_not_verified' }, 409);
    let ctx;
    if (audience) {
      ctx = d.audience_preview.find((c) => c.audience_subscription_id === body.audience_subscription_id);
    } else {
      const row =
        d.recipients.find((r) => r.recipient_id === body.recipient_id) ??
        d.recipients.find((r) => r.conversation_id && recipientState(r, false) === 'ready');
      ctx = d.compose.find((c) => c.recipient_id === row?.recipient_id);
    }
    if (!ctx) return jsonNoStore({ error: 'no_recipients' }, 409);

    const origin = mailoutLinkOrigin(env);
    const url = unsubscribeUrl(origin, 'prueba');
    const template = mailTemplate(detailTemplateRow(d), origin);
    const mail = composeMailout({ subject: m.subject, body: m.body, language: m.language }, ctx, url, template);
    if (mail.missing.length) return jsonNoStore({ error: 'missing_fields', count: 1 }, 409);
    try {
      const provider = sendingProvider(domain.provider, env);
      await provider.sendEmail({
        // El público sale con la parte local de su dominio (como `mailout_claim`).
        from: senderAddress(audience ? domain.from_local_part : m.from_local_part, domain.domain),
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
      return jsonNoStore({ to, simulated: provider.kind === 'simulator' });
    } catch (err) {
      if (err instanceof MailoutNotConfiguredError) return notConfigured(err);
      throw err;
    }
  });
