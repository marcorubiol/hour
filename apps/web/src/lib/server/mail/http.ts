/** Utilidades de las rutas /api/mail/*: respuesta JSON y quién llama. */

import { decodeJwtPayload } from '../session';

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
}

/** El `sub` del JWT (ya validado por PostgREST en cada llamada que importa). */
export function jwtSubject(jwt: string): string | null {
  const sub = decodeJwtPayload(jwt)?.sub;
  return typeof sub === 'string' && sub ? sub : null;
}

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
