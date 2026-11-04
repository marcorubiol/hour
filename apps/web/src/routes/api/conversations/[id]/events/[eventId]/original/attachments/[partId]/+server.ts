/**
 * GET /api/conversations/:id/events/:eventId/original/attachments/:partId —
 * un adjunto del correo, bajado del buzón en el momento (punto 111). Siempre
 * como descarga (`attachment`, `nosniff`, CSP `sandbox`): un HTML o un SVG
 * adjunto nunca se pinta en el origen de Hour. Mismo permiso que el original.
 */

import type { RequestHandler } from './$types';
import { extractAccessToken } from '$lib/auth';
import {
  attachmentData,
  attachmentDisposition,
  attachmentPart,
  base64UrlBytes,
  safeMimeType,
  withOriginal,
} from '$lib/server/mail/original';
import { jsonNoStore } from '$lib/server/http';

export const GET: RequestHandler = async ({ request, params, platform, locals }) =>
  withOriginal(
    {
      env: platform?.env,
      jwt: extractAccessToken(request),
      conversationId: params.id,
      eventId: params.eventId,
      route: 'GET /api/conversations/[id]/events/[eventId]/original/attachments/[partId]',
      requestId: locals.requestId,
    },
    async ({ raw, client }) => {
      const part = attachmentPart(raw, params.partId);
      if (!part) return jsonNoStore({ error: 'not_found' }, 404);
      const data = await attachmentData(client, raw, part);
      if (!data) return jsonNoStore({ error: 'not_found' }, 404);
      const bytes = base64UrlBytes(data);
      return new Response(bytes, {
        headers: {
          'content-type': safeMimeType(part.mimeType),
          'content-disposition': attachmentDisposition(part.filename || params.partId),
          'content-length': String(bytes.byteLength),
          'cache-control': 'private, no-store',
          'content-security-policy': "default-src 'none'; sandbox",
          'x-content-type-options': 'nosniff',
        },
      });
    },
  );
