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
 *     Con `design` (ADR-190, solo invitaciones): quien llama tiene que editar
 *     el envío; se comprueba el JSON, se limpia el HTML y se deriva el texto,
 *     y `set_mailout_design` (solo service_role) guarda diseño y `body` en una
 *     sentencia, antes de `update_mailout`. null vuelve a la carta y deja el
 *     texto. El cuerpo se lee con tope (400 KB) antes de parsearlo.
 */

import type { RequestHandler } from './$types';
import { pgPostRpc } from '$lib/supabase';
import { jsonNoStore } from '$lib/server/http';
import * as v from 'valibot';
import { canEditMailout, loadDetail, MAILOUT_PG_CODES, mailoutRoute, readMailout } from '$lib/server/mailout/route';
import { MailoutDbError, serviceRpc } from '$lib/server/mailout/db';
import { MailoutUpdateSchema } from '$lib/mailout';
import { byteLength, DESIGN_REQUEST_MAX_BYTES, prepareDesign } from '$lib/mail-design';

export const GET: RequestHandler = (event) =>
  mailoutRoute(event, 'GET /api/mailout/[id]', async ({ env, jwt, id }) => {
    const detail = await loadDetail(env, jwt, id);
    return detail ? jsonNoStore(detail) : jsonNoStore({ error: 'not_found' }, 404);
  });

/** A PATCH body read with a ceiling, before parsing it (ADR-190: a design can be big). */
async function readCapped(request: Request): Promise<v.InferOutput<typeof MailoutUpdateSchema> | Response> {
  const declared = Number(request.headers.get('content-length') ?? '0');
  if (declared > DESIGN_REQUEST_MAX_BYTES) return jsonNoStore({ error: 'design_too_large' }, 413);
  const raw = await request.text();
  if (byteLength(raw) > DESIGN_REQUEST_MAX_BYTES) return jsonNoStore({ error: 'design_too_large' }, 413);
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return jsonNoStore({ error: 'invalid_body' }, 400);
  }
  const parsed = v.safeParse(MailoutUpdateSchema, json);
  return parsed.success ? parsed.output : jsonNoStore({ error: 'invalid_body' }, 400);
}

/** A machine RPC's refusal, as the routes answer a PostgREST one. */
function serviceRefusal(err: unknown): Response {
  if (!(err instanceof MailoutDbError)) throw err;
  const code = (() => {
    try {
      return String((JSON.parse(err.body) as { code?: unknown }).code ?? '');
    } catch {
      return '';
    }
  })();
  const mapped = MAILOUT_PG_CODES[code];
  if (!mapped) throw err;
  return jsonNoStore({ error: mapped.error }, mapped.status);
}

export const PATCH: RequestHandler = (event) =>
  mailoutRoute(event, 'PATCH /api/mailout/[id]', async ({ env, jwt, id }) => {
    const body = await readCapped(event.request);
    if (body instanceof Response) return body;
    // The design (ADR-190): only through here. Who edits it, the JSON, the
    // cleaning and the derived text are checked by the Worker; then one
    // machine RPC writes design and body together (the JWT cannot call it).
    if (body.design !== undefined) {
      const mailout = await readMailout(env, jwt, id);
      if (!mailout || !(await canEditMailout(env, jwt, mailout)).edit) return jsonNoStore({ error: 'not_found' }, 404);
      if (mailout.status !== 'draft') return jsonNoStore({ error: 'invalid_state' }, 409);
      let args: { p_design: unknown; p_design_html: string | null; p_body: string | null };
      if (body.design) {
        if (mailout.kind !== 'invitation') return jsonNoStore({ error: 'invalid_state' }, 409);
        const prepared = prepareDesign(body.design, mailout.workspace_id);
        if ('error' in prepared) return jsonNoStore({ error: prepared.error }, 400);
        args = { p_design: prepared.content, p_design_html: prepared.html, p_body: prepared.body };
        body.body = prepared.body;
      } else {
        args = { p_design: null, p_design_html: null, p_body: null };
      }
      try {
        await serviceRpc(env, 'set_mailout_design', { p_id: id, ...args });
      } catch (err) {
        return serviceRefusal(err);
      }
    }
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
    // La imagen del espectáculo (ADR-172), solo si vino: ausente no la toca.
    if (body.image !== undefined) {
      await pgPostRpc(env, 'set_mailout_image', jwt, {
        p_id: id,
        p_image_url: body.image?.url ?? null,
        p_image_alt: body.image?.alt ?? null,
        p_image_link_url: body.image?.link || null,
      });
    }
    return jsonNoStore({ ok: true });
  });
