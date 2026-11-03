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
import { pgPostRpc } from '$lib/supabase';
import { jsonNoStore } from '$lib/server/http';
import { mailoutRoute } from '$lib/server/mailout/route';
import { subscriptionInvitations } from '$lib/server/audience';

export const GET: RequestHandler = (event) =>
  mailoutRoute(event, 'GET /api/audience/subscription/[id]', async ({ env, jwt, id }) => {
    if (event.url.searchParams.get('proof')) {
      const proof = await pgPostRpc<unknown>(env, 'audience_consent_proof', jwt, { p_subscription_id: id });
      return jsonNoStore({ proof: proof.data[0] ?? null });
    }
    return jsonNoStore({ invitations: await subscriptionInvitations(env, jwt, id) });
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
