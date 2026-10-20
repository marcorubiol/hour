/** POST /api/mailout/[id]/cancel → `cancel_mailout`: lo que falta por salir no sale. */

import type { RequestHandler } from './$types';
import { pgPostRpc } from '$lib/supabase';
import { jsonNoStore } from '$lib/server/http';
import { mailoutRoute } from '$lib/server/mailout/route';

export const POST: RequestHandler = (event) =>
  mailoutRoute(event, 'POST /api/mailout/[id]/cancel', async ({ env, jwt, id }) => {
    await pgPostRpc(env, 'cancel_mailout', jwt, { p_id: id });
    return jsonNoStore({ ok: true });
  });
