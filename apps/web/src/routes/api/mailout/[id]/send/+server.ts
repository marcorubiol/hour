/**
 * POST /api/mailout/[id]/send → «Enviar a N» (plan § 10, § 6).
 *
 * Antes de poner en cola, el mismo montaje que la vista previa: si a un
 * destinatario listo le falta un campo (`{sala}`, `{ciudad}`…), 409
 * `missing_fields` y nada sale vacío. Después `queue_mailout` con el JWT (la
 * base comprueba dominio, contenido, modo simulador, supresión y base) y una
 * primera pasada de la cola de este envío con `ctx.waitUntil`, para que un
 * envío pequeño no espere al cron del minuto.
 *
 * Una invitación (ADR-173 § 10) pide el dominio verificado de cada origen
 * que usa: el de la difusión si hay profesionales, el del público si hay
 * lista. Los campos del público se miran en su muestra (`audience_preview`):
 * `{sala}` y `{ciudad}` son de la función y valen igual para todos.
 */

import type { RequestHandler } from './$types';
import { pgPostRpc } from '$lib/supabase';
import { jsonNoStore } from '$lib/server/http';
import { loadDetail, mailoutRoute, pgMessage } from '$lib/server/mailout/route';
import { runMailoutQueue } from '$lib/server/mailout/queue';
import { mailoutMissing, MailoutNotConfiguredError } from '$lib/server/mailout';
import { notConfigured } from '$lib/server/mailout/http';
import { composeMailout } from '$lib/mailout-compose';
import { recipientState, type MailoutItem } from '$lib/mailout';

const QUEUE_REFUSALS: [RegExp, string][] = [
  [/simulator/, 'simulator_only'],
  [/no recipient/, 'no_recipients'],
  [/audience sending domain is not verified/, 'audience_domain_not_verified'],
  [/not verified/, 'domain_not_verified'],
  [/needs a list or professionals/, 'no_recipients'],
  [/list is archived/, 'list_archived'],
  [/subject and body/, 'empty'],
  [/only a draft/, 'not_draft'],
];

export const POST: RequestHandler = (event) =>
  mailoutRoute(event, 'POST /api/mailout/[id]/send', async ({ env, jwt, id }) => {
    const d = await loadDetail(env, jwt, id);
    if (!d) return jsonNoStore({ error: 'not_found' }, 404);
    const mailout = d.mailout;
    // Sin lo que necesita la cola para cada dominio (clave de servicio; con
    // SES, sus claves), no se pone en cola: no saldría nunca.
    const pros = d.recipients.some((r) => r.conversation_id);
    const outreach = d.domains.find((x) => x.id === mailout.mail_domain_id) ?? null;
    const used = [
      ...(mailout.kind === 'outreach' || pros ? [outreach] : []),
      ...(mailout.audience_id ? [d.audience_domain] : []),
    ];
    if (used.some((x) => !x?.verified_at)) {
      const audienceMissing = mailout.audience_id && !d.audience_domain?.verified_at;
      return jsonNoStore({ error: audienceMissing ? 'audience_domain_not_verified' : 'domain_not_verified' }, 409);
    }
    for (const x of used) {
      const missingConfig = mailoutMissing(x!.provider, env);
      if (missingConfig.length) return notConfigured(new MailoutNotConfiguredError(missingConfig));
    }
    const ctx = new Map(d.compose.map((c) => [c.recipient_id, c]));
    const draft = { subject: mailout.subject ?? '', body: mailout.body ?? '', language: mailout.language };
    const missing =
      d.recipients.filter((r) => {
        const c = ctx.get(r.recipient_id);
        return recipientState(r, false) === 'ready' && c && composeMailout(draft, c, '').missing.length > 0;
      }).length + d.audience_preview.filter((c) => composeMailout(draft, c, '').missing.length > 0).length;
    if (missing) return jsonNoStore({ error: 'missing_fields', count: missing }, 409);

    let queued: MailoutItem | undefined;
    try {
      queued = (await pgPostRpc<MailoutItem>(env, 'queue_mailout', jwt, { p_id: id })).data[0];
    } catch (err) {
      const message = pgMessage(err);
      const refusal = QUEUE_REFUSALS.find(([re]) => re.test(message));
      if (refusal) return jsonNoStore({ error: refusal[1] }, 409);
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
    return jsonNoStore({ status: queued?.status ?? 'queued' });
  });
