/**
 * PUT /api/mailout/[id]/audience { audience_id | null } → pone o quita la
 * lista de una invitación en borrador, con el dominio del público
 * (`set_invitation_audience`). Sin dominio del público: 409.
 */

import type { RequestHandler } from './$types';
import { pgPostRpc } from '$lib/supabase';
import { jsonNoStore } from '$lib/server/http';
import { mailoutRoute, pgMessage, readBody } from '$lib/server/mailout/route';
import { InvitationAudienceSchema } from '$lib/audience';

export const PUT: RequestHandler = (event) =>
  mailoutRoute(event, 'PUT /api/mailout/[id]/audience', async ({ env, jwt, id }) => {
    const body = await readBody(event.request, InvitationAudienceSchema);
    if (body instanceof Response) return body;
    try {
      await pgPostRpc(env, 'set_invitation_audience', jwt, { p_mailout_id: id, p_audience_id: body.audience_id });
    } catch (err) {
      if (/no audience sending domain/.test(pgMessage(err))) return jsonNoStore({ error: 'no_audience_domain' }, 409);
      throw err;
    }
    return jsonNoStore({ ok: true });
  });
