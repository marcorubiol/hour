/**
 * GET /m/ws/<espacio>/<logo|mail>/<sha>-<w>x<h>.<png|jpg> → la imagen pública
 * de un espacio (ADR-172): el logo y la imagen del espectáculo que lleva un
 * correo de difusión. Sin sesión: la lee el cliente de correo de una sala.
 *
 * Solo sirve lo que cabe en ese nombre (`PUBLIC_MEDIA_RE`), y lo lee de
 * `public/` en R2: ninguna otra clave del bucket es alcanzable por aquí. El
 * nombre es el hash del contenido, así que la respuesta se cachea para
 * siempre.
 */

import type { RequestHandler } from './$types';
import { publicMediaKey } from '$lib/server/media';

const notFound = () => new Response('Not found', { status: 404, headers: { 'cache-control': 'no-store' } });

export const GET: RequestHandler = async ({ params, platform }) => {
  const key = publicMediaKey(params.path ?? '');
  const bucket = platform?.env?.MEDIA;
  if (!key || !bucket) return notFound();
  const object = await bucket.get(key);
  if (!object) return notFound();
  return new Response(object.body, {
    headers: {
      'content-type': object.httpMetadata?.contentType ?? 'application/octet-stream',
      'content-length': String(object.size),
      'cache-control': 'public, max-age=31536000, immutable',
      etag: object.httpEtag,
      'x-content-type-options': 'nosniff',
      'content-security-policy': "default-src 'none'",
      'cross-origin-resource-policy': 'cross-origin',
    },
  });
};
