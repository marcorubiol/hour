/**
 * GET /api/conversations/:id/events/:eventId/original/view[?images=1] — el
 * HTML del correo como documento aparte, para abrirlo en otra pestaña y, si
 * se pide, con las imágenes de fuera (punto 111). Dentro de la ficha el
 * iframe hereda la CSP de la app, que no deja cargar imágenes remotas; aquí
 * el documento lleva la suya: nada de fuera salvo imágenes, y `sandbox` (sin
 * scripts, origen opaco). Llega con la cookie de sesión.
 */

import type { RequestHandler } from './$types';
import { extractAccessToken } from '$lib/auth';
import { mailDocument, mailDocumentCsp } from '$lib/mail-original';
import { parseGmailOriginal, withOriginal } from '$lib/server/mail/original';

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export const GET: RequestHandler = async ({ request, params, platform, locals, url }) =>
  withOriginal(
    {
      env: platform?.env,
      jwt: extractAccessToken(request),
      conversationId: params.id,
      eventId: params.eventId,
      route: 'GET /api/conversations/[id]/events/[eventId]/original/view',
      requestId: locals.requestId,
    },
    async ({ raw }) => {
      const original = parseGmailOriginal(raw);
      const images = url.searchParams.get('images') === '1';
      const body =
        original.html ??
        `<pre style="white-space:pre-wrap;font:inherit;margin:0">${escapeHtml(original.text ?? '')}</pre>`;
      return new Response(mailDocument(body, { images }), {
        headers: {
          'content-type': 'text/html; charset=utf-8',
          'cache-control': 'no-store',
          'content-security-policy': `${mailDocumentCsp(images)}; sandbox allow-popups allow-popups-to-escape-sandbox; frame-ancestors 'none'`,
          'referrer-policy': 'no-referrer',
        },
      });
    },
  );
