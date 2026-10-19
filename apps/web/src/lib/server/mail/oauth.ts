/**
 * El flujo OAuth del buzón (ADR-099), común a los proveedores.
 *
 *   start    (GET, con sesión)  → cookie sellada con estado + PKCE → proveedor
 *   callback (GET, SIN sesión)  → comprueba el estado, sella el código y vuelve
 *                                 a Ajustes con una navegación iniciada por Hour
 *   finish   (POST, con sesión) → canjea el código, cifra el refresh token y
 *                                 conecta el buzón con el JWT de la persona
 *
 * Por qué tres pasos: las cookies de sesión son SameSite=Strict y no viajan en
 * la vuelta desde Google (navegación entre sitios). La cookie del flujo es Lax,
 * va sellada con AES-GCM (MAIL_TOKEN_KEY) y dura diez minutos; el canje se hace
 * ya con sesión, y finish comprueba que quien termina es quien empezó.
 */

import type { Cookies } from '@sveltejs/kit';
import { dev } from '$app/environment';
import { openJson, sealJson } from './crypto';

const OAUTH_COOKIE = 'hour_mail_oauth';
const COOKIE_PATH = '/api/mail/oauth';
const TTL_SEC = 600;

interface OAuthFlowState {
  /** state (anti-CSRF) */
  n: string;
  /** PKCE verifier */
  v: string;
  /** personal | workspace */
  s: 'personal' | 'workspace';
  /** workspace id */
  w: string;
  /** user id que empezó */
  u: string;
  /** ruta de vuelta (relativa, dentro de /h/) */
  r: string;
  /** caduca (ms) */
  e: number;
  /** código de autorización, tras el callback */
  c?: string;
}

/** Solo rutas propias bajo /h/: nada de redirecciones abiertas. */
export function safeReturnPath(raw: string | null | undefined, fallback = '/h'): string {
  if (!raw || !raw.startsWith('/h/') || raw.startsWith('//') || /[\r\n\\]/.test(raw)) return fallback;
  return raw;
}

export function withQuery(path: string, params: Record<string, string>): string {
  const u = new URL(path, 'http://x');
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
  return `${u.pathname}${u.search}`;
}

export async function writeFlow(cookies: Cookies, key: CryptoKey, state: OAuthFlowState): Promise<void> {
  cookies.set(OAUTH_COOKIE, await sealJson(key, state, 'oauth-flow'), {
    path: COOKIE_PATH,
    httpOnly: true,
    secure: !dev,
    sameSite: 'lax',
    maxAge: TTL_SEC,
  });
}

export async function readFlow(cookies: Cookies, key: CryptoKey): Promise<OAuthFlowState | null> {
  const raw = cookies.get(OAUTH_COOKIE);
  if (!raw) return null;
  const state = await openJson<OAuthFlowState>(key, raw, 'oauth-flow');
  if (!state || typeof state.e !== 'number' || state.e < Date.now()) return null;
  return state;
}

export function clearFlow(cookies: Cookies): void {
  cookies.delete(OAUTH_COOKIE, { path: COOKIE_PATH });
}

export const FLOW_TTL_MS = TTL_SEC * 1000;

/** El callback devuelve esta página: una navegación iniciada por Hour, no por Google. */
export function bounceHtml(path: string): Response {
  const safe = path.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
  return new Response(
    `<!doctype html><meta charset="utf-8"><meta http-equiv="refresh" content="0;url=${safe}"><title>Hour</title><a href="${safe}">Hour</a>`,
    {
      status: 200,
      headers: {
        'content-type': 'text/html; charset=utf-8',
        'cache-control': 'no-store',
        'referrer-policy': 'no-referrer',
      },
    },
  );
}
