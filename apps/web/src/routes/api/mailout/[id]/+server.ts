/**
 * Un envío (plan § 10).
 *
 * GET → MailoutDetail: el envío, sus destinatarios con su estado
 *     (`mailout_preview`), lo que monta cada correo (`mailout_compose_preview`),
 *     los dominios verificados, a dónde irán las respuestas y si quien llama
 *     lo edita. La pantalla lo vuelve a pedir cada 30 s mientras sale.
 * PATCH { subject, body, language, mail_domain_id, from_local_part, from_name, image?, design? }
 *     → `update_mailout` (solo en borrador); con `image`, también
 *     `set_mailout_image` (la imagen del espectáculo, ADR-172; null la quita).
 *     Con `design` (ADR-192, solo invitaciones): se comprueba el JSON, se
 *     limpia el HTML y el `body` pasa a ser el texto derivado del diseño;
 *     después `set_mailout_design`. null vuelve a la carta y deja el texto.
 */

import type { RequestHandler } from './$types';
import { pgPostRpc } from '$lib/supabase';
import { jsonNoStore } from '$lib/server/http';
import { loadDetail, mailoutRoute, readBody, readMailout } from '$lib/server/mailout/route';
import { MailoutUpdateSchema } from '$lib/mailout';
import { prepareDesign } from '$lib/mail-design';

export const GET: RequestHandler = (event) =>
  mailoutRoute(event, 'GET /api/mailout/[id]', async ({ env, jwt, id }) => {
    const detail = await loadDetail(env, jwt, id);
    return detail ? jsonNoStore(detail) : jsonNoStore({ error: 'not_found' }, 404);
  });

export const PATCH: RequestHandler = (event) =>
  mailoutRoute(event, 'PATCH /api/mailout/[id]', async ({ env, jwt, id }) => {
    const body = await readBody(event.request, MailoutUpdateSchema);
    if (body instanceof Response) return body;
    // The design (ADR-192): checked, cleaned, and its text becomes the body.
    let design: { content: unknown; html: string; body: string } | null | undefined = undefined;
    if (body.design) {
      const mailout = await readMailout(env, jwt, id);
      if (!mailout) return jsonNoStore({ error: 'not_found' }, 404);
      if (mailout.kind !== 'invitation') return jsonNoStore({ error: 'invalid_state' }, 409);
      const prepared = prepareDesign(body.design, mailout.workspace_id);
      if ('error' in prepared) return jsonNoStore({ error: prepared.error }, 400);
      design = prepared;
    } else if (body.design === null) {
      design = null;
    }
    await pgPostRpc(env, 'update_mailout', jwt, {
      p_id: id,
      p_subject: body.subject,
      p_body: design ? design.body : body.body,
      p_language: body.language,
      p_from_local_part: body.from_local_part,
      p_from_name: body.from_name ?? null,
      p_mail_domain_id: body.mail_domain_id,
      p_reply_to_mail_account_id: null,
    });
    // La imagen del espectáculo (ADR-172), solo si vino: ausente no la toca.
    if (body.image !== undefined) {
      await pgPostRpc(env, 'set_mailout_image', jwt, {
        p_id: id,
        p_image_url: body.image?.url ?? null,
        p_image_alt: body.image?.alt ?? null,
        p_image_link_url: body.image?.link || null,
      });
    }
    if (design !== undefined) {
      await pgPostRpc(env, 'set_mailout_design', jwt, {
        p_id: id,
        p_design: design?.content ?? null,
        p_design_html: design?.html ?? null,
      });
    }
    return jsonNoStore({ ok: true });
  });
