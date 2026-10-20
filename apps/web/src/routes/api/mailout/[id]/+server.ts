/**
 * Un envío (plan § 10).
 *
 * GET → MailoutDetail: el envío, sus destinatarios con su estado
 *     (`mailout_preview`), lo que monta cada correo (`mailout_compose_preview`),
 *     los dominios verificados, a dónde irán las respuestas y si quien llama
 *     lo edita. La pantalla lo vuelve a pedir cada 30 s mientras sale.
 * PATCH { subject, body, language, mail_domain_id, from_local_part, from_name }
 *     → `update_mailout` (solo en borrador).
 */

import type { RequestHandler } from './$types';
import { pgPostRpc } from '$lib/supabase';
import { jsonNoStore } from '$lib/server/http';
import { loadDetail, mailoutRoute, readBody } from '$lib/server/mailout/route';
import { MailoutUpdateSchema } from '$lib/mailout';

export const GET: RequestHandler = (event) =>
  mailoutRoute(event, 'GET /api/mailout/[id]', async ({ env, jwt, id }) => {
    const detail = await loadDetail(env, jwt, id);
    return detail ? jsonNoStore(detail) : jsonNoStore({ error: 'not_found' }, 404);
  });

export const PATCH: RequestHandler = (event) =>
  mailoutRoute(event, 'PATCH /api/mailout/[id]', async ({ env, jwt, id }) => {
    const body = await readBody(event.request, MailoutUpdateSchema);
    if (body instanceof Response) return body;
    await pgPostRpc(env, 'update_mailout', jwt, {
      p_id: id,
      p_subject: body.subject,
      p_body: body.body,
      p_language: body.language,
      p_from_local_part: body.from_local_part,
      p_from_name: body.from_name ?? null,
      p_mail_domain_id: body.mail_domain_id,
      p_reply_to_mail_account_id: null,
    });
    return jsonNoStore({ ok: true });
  });
