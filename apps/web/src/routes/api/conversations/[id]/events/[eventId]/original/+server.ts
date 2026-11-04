/**
 * GET /api/conversations/:id/events/:eventId/original — el correo entero,
 * tal como llegó, traído del buzón al abrirlo (punto 111): cabeceras, texto,
 * HTML (sin sanear: lo pinta un iframe sandbox, `$lib/mail-original`) y la
 * lista de adjuntos. No se guarda en ningún sitio. Permiso y llaves en
 * `$lib/server/mail/original`.
 */

import type { RequestHandler } from './$types';
import { extractAccessToken } from '$lib/auth';
import { parseGmailOriginal, withOriginal } from '$lib/server/mail/original';
import { jsonNoStore } from '$lib/server/http';

export const GET: RequestHandler = async ({ request, params, platform, locals }) =>
  withOriginal(
    {
      env: platform?.env,
      jwt: extractAccessToken(request),
      conversationId: params.id,
      eventId: params.eventId,
      route: 'GET /api/conversations/[id]/events/[eventId]/original',
      requestId: locals.requestId,
    },
    async ({ raw }) => jsonNoStore(parseGmailOriginal(raw)),
  );
