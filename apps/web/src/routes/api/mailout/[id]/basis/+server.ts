/**
 * POST /api/mailout/[id]/basis { recipient_id, kind, note? } → «apuntar
 * base» de un destinatario desde la vista previa (ADR-110 § 2). La dirección
 * sale de `mailout_preview` (lo que quien llama ve), no del cliente;
 * `set_mail_basis` vuelve a comprobar que edita una conversación con esa
 * dirección.
 */

import type { RequestHandler } from './$types';
import { pgPostRpc } from '$lib/supabase';
import { json } from '$lib/server/mail/http';
import { mailoutRoute, readBody, readMailout } from '$lib/server/mailout/route';
import { MailBasisSchema, type MailoutRecipientRow } from '$lib/mailout';

export const POST: RequestHandler = (event) =>
  mailoutRoute(event, 'POST /api/mailout/[id]/basis', async ({ env, jwt, id }) => {
    const body = await readBody(event.request, MailBasisSchema);
    if (body instanceof Response) return body;
    if (body.kind === 'consent' && !body.note) return json({ error: 'note_required' }, 400);
    const mailout = await readMailout(env, jwt, id);
    if (!mailout) return json({ error: 'not_found' }, 404);
    const rows = await pgPostRpc<MailoutRecipientRow>(env, 'mailout_preview', jwt, { p_id: id });
    const r = rows.data.find((x) => x.recipient_id === body.recipient_id);
    if (!r?.address) return json({ error: 'not_found' }, 404);
    await pgPostRpc(env, 'set_mail_basis', jwt, {
      p_workspace_id: mailout.workspace_id,
      p_address: r.address,
      p_kind: body.kind,
      p_note: body.note ?? null,
    });
    return json({ ok: true });
  });
