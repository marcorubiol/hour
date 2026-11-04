/**
 * GET /api/audience/[id]/drafts → { items: InvitationDraft[] } (tarea 103):
 * las invitaciones en borrador del espacio de la lista, para «Añadir a un
 * borrador». Poner la lista va por PUT /api/mailout/[id]/audience.
 */

import type { RequestHandler } from './$types';
import { pgGet } from '$lib/supabase';
import { jsonNoStore } from '$lib/server/http';
import { mailoutRoute } from '$lib/server/mailout/route';
import { invitationDrafts } from '$lib/server/audience';

export const GET: RequestHandler = (event) =>
  mailoutRoute(event, 'GET /api/audience/[id]/drafts', async ({ env, jwt, id }) => {
    const list = await pgGet<{ workspace_id: string }>(env, 'audience', jwt, {
      search: { select: 'workspace_id', id: `eq.${id}` },
    });
    const ws = list.data[0]?.workspace_id;
    if (!ws) return jsonNoStore({ error: 'not_found' }, 404);
    return jsonNoStore({ items: await invitationDrafts(env, jwt, ws) });
  });
