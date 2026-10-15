/**
 * PUT /api/mailout/[id]/recipients { conversation_ids } → la lista entera de
 * un borrador (`set_mailout_recipients`): «quitar uno de la lista» manda la
 * lista sin él. La dirección la resuelve la base, nunca el cliente.
 */

import type { RequestHandler } from './$types';
import { pgPostRpc } from '$lib/supabase';
import { json } from '$lib/server/mail/http';
import { mailoutRoute, readBody } from '$lib/server/mailout/route';
import { MailoutRecipientsSchema } from '$lib/mailout';

export const PUT: RequestHandler = (event) =>
  mailoutRoute(event, 'PUT /api/mailout/[id]/recipients', async ({ env, jwt, id }) => {
    const body = await readBody(event.request, MailoutRecipientsSchema);
    if (body instanceof Response) return body;
    await pgPostRpc(env, 'set_mailout_recipients', jwt, { p_id: id, p_conversation_ids: body.conversation_ids });
    return json({ ok: true });
  });
