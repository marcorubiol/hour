/**
 * Quién puede meter una página de Hour en un iframe. Toda la app dice que
 * nadie (`frame-ancestors 'none'` en la CSP de svelte.config.js y
 * `x-frame-options: DENY` en hooks.server.ts); la única excepción es el
 * formulario del público para la web de la compañía,
 * `/public/audience/<clave>/embed` (plan 2026-11-01-audience § 3.2): lo pega
 * cualquier web, así que `frame-ancestors *` y sin `x-frame-options`. El POST
 * sigue saliendo desde el origen de Hour dentro del iframe, y pasa la
 * comprobación de Origin sin otra excepción.
 */

import { isEmbedPath } from '$lib/public-route';

export { isEmbedPath };

/** La CSP de la app con `frame-ancestors *` en lugar de la suya. */
export function frameableCsp(csp: string): string {
  return /frame-ancestors[^;]*/.test(csp)
    ? csp.replace(/frame-ancestors[^;]*/, 'frame-ancestors *')
    : `${csp.replace(/;?\s*$/, '')}; frame-ancestors *`;
}

/**
 * Las cabeceras de seguridad de una respuesta según su ruta: en `/embed`,
 * la CSP abierta a cualquier marco y sin `x-frame-options`; en el resto,
 * tal cual. Una respuesta que ya fija su `referrer-policy` la conserva: la
 * vista aparte del original de un correo (punto 111) pide `no-referrer`,
 * más estricta que la de la app.
 */
export function applyFrameHeaders(pathname: string, headers: Headers, security: Record<string, string>): void {
  const embed = isEmbedPath(pathname);
  for (const [name, value] of Object.entries(security)) {
    if (embed && name === 'x-frame-options') continue;
    if (name === 'referrer-policy' && headers.has(name)) continue;
    headers.set(name, value);
  }
  if (!embed) return;
  headers.delete('x-frame-options');
  const csp = headers.get('content-security-policy');
  if (csp) headers.set('content-security-policy', frameableCsp(csp));
}
