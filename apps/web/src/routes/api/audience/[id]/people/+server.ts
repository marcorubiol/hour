/**
 * POST /api/audience/[id]/people { address, name?, language? } → AddPersonResult
 * (tarea 101): alta a mano de una persona en la lista. Queda sin confirmar y
 * le sale la confirmación, como en el formulario (`addByHand`). Una dirección
 * mal formada, 400; una lista archivada, 409; sin editar el público, 404.
 */

import type { RequestHandler } from './$types';
import { jsonNoStore } from '$lib/server/http';
import { mailoutRoute, pgMessage, readBody } from '$lib/server/mailout/route';
import { addByHand } from '$lib/server/mailout/audience';
import { AudienceAddSchema } from '$lib/audience';

export const POST: RequestHandler = (event) =>
  mailoutRoute(event, 'POST /api/audience/[id]/people', async ({ env, jwt, id }) => {
    const body = await readBody(event.request, AudienceAddSchema);
    if (body instanceof Response) return body;
    try {
      const r = await addByHand(env, jwt, id, body);
      return r ? jsonNoStore(r, 201) : jsonNoStore({ error: 'not_found' }, 404);
    } catch (err) {
      const msg = pgMessage(err);
      if (/archived/.test(msg)) return jsonNoStore({ error: 'archived' }, 409);
      if (/address is not valid/.test(msg)) return jsonNoStore({ error: 'invalid_address' }, 400);
      throw err;
    }
  });
