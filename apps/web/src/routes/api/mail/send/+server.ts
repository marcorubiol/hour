/**
 * POST /api/mail/send — escribir o responder a un contacto desde Hour, por un
 * buzón conectado. Body: { conversation_id, account_id, subject, body,
 * reply_to_event_id? }. El destinatario no viaja: es el contacto de la
 * conversación (`mail_send_authorize`). Lo enviado queda en el registro.
 */

import type { RequestHandler } from './$types';
import * as v from 'valibot';
import { extractAccessToken } from '$lib/auth';
import { pgErrorResponse } from '$lib/server/errors';
import { mailConfigured } from '$lib/server/mail/db';
import { ProviderAuthError } from '$lib/server/mail/gmail';
import { jsonNoStore, jwtSubject } from '$lib/server/http';
import { sendFromConversation } from '$lib/server/mail/send';
import { MailSendSchema } from '$lib/mail';

export const POST: RequestHandler = async ({ request, url, platform, locals }) => {
  if (!platform?.env) return jsonNoStore({ error: 'platform_unavailable' }, 500);
  const env = platform.env;
  if (!mailConfigured(env)) return jsonNoStore({ error: 'not_configured' }, 503);
  const jwt = extractAccessToken(request);
  const sub = jwt ? jwtSubject(jwt) : null;
  if (!jwt || !sub) return jsonNoStore({ error: 'missing_authorization' }, 401);

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return jsonNoStore({ error: 'invalid_body' }, 400);
  }
  const parsed = v.safeParse(MailSendSchema, raw);
  if (!parsed.success) return jsonNoStore({ error: 'invalid_body' }, 400);
  const b = parsed.output;

  try {
    const r = await sendFromConversation(
      env,
      jwt,
      sub,
      {
        conversationId: b.conversation_id,
        accountId: b.account_id,
        subject: b.subject,
        body: b.body,
        replyToEventId: b.reply_to_event_id ?? null,
      },
      url.hostname,
    );
    if (!r.ok) return jsonNoStore({ error: r.error }, r.status);
    return jsonNoStore({ sent: true, events_created: r.eventsCreated }, 201);
  } catch (err) {
    if (err instanceof ProviderAuthError) return jsonNoStore({ error: 'mailbox_revoked' }, 409);
    return pgErrorResponse(
      err,
      { route: 'POST /api/mail/send', requestId: locals.requestId },
      {
        codes: {
          '42501': { status: 404, error: 'not_found' },
          // ADR-102: el correo sale al contacto principal; sin él, o sin su correo, no hay a quién.
          '22023': {
            status: 400,
            error: 'no_recipient',
            hint: 'The conversation needs a primary contact with an email address.',
          },
        },
      },
    );
  }
};
