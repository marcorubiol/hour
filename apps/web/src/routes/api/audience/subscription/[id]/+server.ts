/**
 * Una persona apuntada (plan § 6.1, «Personas»).
 *
 * GET → { invitations }: las invitaciones que recibió y qué pasó con cada una
 *     (`mailout_recipient` por su suscripción, con la RLS de la faceta).
 * GET ?proof=1 → la prueba del consentimiento con IP y texto
 *     (`audience_consent_proof`, solo admin).
 * POST → baja a petición (`unsubscribe_audience_subscription`).
 * DELETE → borrar sus datos y su prueba (`erase_audience_subscription`, admin).
 */

import type { RequestHandler } from './$types';
import { pgGet, pgPostRpc } from '$lib/supabase';
import { jsonNoStore } from '$lib/server/http';
import { mailoutRoute } from '$lib/server/mailout/route';
import type { SubscriptionInvitation } from '$lib/audience';

type RecipientRow = {
  id: string;
  mailout_id: string;
  status: string;
  sent_at: string | null;
  mailout: { subject: string | null } | null;
};

export const GET: RequestHandler = (event) =>
  mailoutRoute(event, 'GET /api/audience/subscription/[id]', async ({ env, jwt, id }) => {
    if (event.url.searchParams.get('proof')) {
      const proof = await pgPostRpc<unknown>(env, 'audience_consent_proof', jwt, { p_subscription_id: id });
      return jsonNoStore({ proof: proof.data[0] ?? null });
    }
    const rows = await pgGet<RecipientRow>(env, 'mailout_recipient', jwt, {
      search: {
        select: 'id,mailout_id,status,sent_at,mailout:mailout_id(subject)',
        audience_subscription_id: `eq.${id}`,
        order: 'created_at.desc',
        limit: '50',
      },
    });
    const invitations: SubscriptionInvitation[] = rows.data.map((r) => ({
      recipient_id: r.id,
      mailout_id: r.mailout_id,
      subject: r.mailout?.subject ?? null,
      status: r.status,
      sent_at: r.sent_at,
    }));
    return jsonNoStore({ invitations });
  });

export const POST: RequestHandler = (event) =>
  mailoutRoute(event, 'POST /api/audience/subscription/[id]', async ({ env, jwt, id }) => {
    await pgPostRpc(env, 'unsubscribe_audience_subscription', jwt, { p_id: id });
    return jsonNoStore({ ok: true });
  });

export const DELETE: RequestHandler = (event) =>
  mailoutRoute(event, 'DELETE /api/audience/subscription/[id]', async ({ env, jwt, id }) => {
    await pgPostRpc(env, 'erase_audience_subscription', jwt, { p_id: id });
    return jsonNoStore({ ok: true });
  });
