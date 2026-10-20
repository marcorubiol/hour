/**
 * The one JSON answer of every endpoint. It lived as a private copy in 80
 * `+server.ts` files (and once more in mail/http.ts and travel-stages.ts),
 * each the same five lines; the cleanup of 2026-10-19 gave it one home.
 *
 * `jsonNoStore` is the same answer for what must never sit in a cache: the
 * mail routes and the few endpoints that already said so. The places lookup
 * passes its own day-long private cache through `headers`.
 */

import { decodeJwtPayload } from './session';

const JSON_TYPE = 'application/json; charset=utf-8';

/** A JSON answer; `headers` adds to the content type (a cache policy, mostly). */
export function json(body: unknown, status = 200, headers?: Record<string, string>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': JSON_TYPE, ...headers },
  });
}

export function jsonNoStore(body: unknown, status = 200): Response {
  return json(body, status, { 'cache-control': 'no-store' });
}

/** El `sub` del JWT (ya validado por PostgREST en cada llamada que importa). */
export function jwtSubject(jwt: string): string | null {
  const sub = decodeJwtPayload(jwt)?.sub;
  return typeof sub === 'string' && sub ? sub : null;
}

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
