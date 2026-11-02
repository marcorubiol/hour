/**
 * Páginas públicas que no son de la app y piden otro trato en el navegador
 * (ADR-175):
 *   · `/public/audience/<clave>/embed`: el formulario del público dentro de la
 *     web de otra compañía. Es la única ruta enmarcable ($lib/server/frame) y
 *     no carga nada de la app que deje rastro en esa web: ni Sentry de
 *     cliente, ni service worker, ni IndexedDB.
 *   · `/c/<token>` y `/u/<token>`: la URL es el secreto. Sentry de cliente sin
 *     grabación de sesión (Replay no pasa por `beforeSend`, que borra el
 *     token de los eventos).
 */

export const EMBED_PATH_RE = /^\/public\/audience\/[0-9a-f]{32}\/embed\/?$/;
const TOKEN_PATH_RE = /^\/(?:c\/[0-9a-f]{64}|u\/[0-9a-f]{48})\/?$/;

export function isEmbedPath(pathname: string): boolean {
  return EMBED_PATH_RE.test(pathname);
}

/** Qué Sentry de cliente carga una página: todo, sin grabación, o nada. */
export function clientSentryMode(pathname: string): 'full' | 'no-replay' | 'off' {
  if (isEmbedPath(pathname)) return 'off';
  return TOKEN_PATH_RE.test(pathname) ? 'no-replay' : 'full';
}
