/**
 * Server-side session management — the httpOnly-cookie half of auth
 * (Phase 0.9 hardening gate, replaces the localStorage JWT).
 *
 * The browser never holds the durable session: login/refresh happen
 * Worker-side against Supabase Auth and land as two httpOnly cookies, so
 * XSS can never exfiltrate the refresh token. The short-lived access token
 * IS handed to JS on request via /api/auth/token — Supabase Realtime and
 * the has_permission RPC are cross-origin and need the raw JWT — which
 * caps an XSS steal at ≤1 h instead of a permanent session.
 *
 * Cookie contract:
 *   hour_at — access token. Path=/, Max-Age = the token's own expiry, so
 *             an expired session reads as "no cookie" and every consumer
 *             converges on the same 401 → refresh → retry path.
 *   hour_rt — refresh token. Path=/api/auth (only the auth endpoints ever
 *             see it on the wire), 60-day window, rotated on every refresh.
 * Both: HttpOnly, SameSite=Strict, Secure outside vite dev.
 */

import type { Cookies } from '@sveltejs/kit';
import { dev } from '$app/environment';
import type { SupabaseEnv } from '$lib/supabase';

export const ACCESS_COOKIE = 'hour_at';
export const REFRESH_COOKIE = 'hour_rt';
const REFRESH_COOKIE_PATH = '/api/auth';
const REFRESH_MAX_AGE = 60 * 60 * 24 * 60; // 60 days

/** Env surface the auth endpoints need. Rate-limit bindings are optional so
 * local Vite development keeps working (see $lib/server/rate-limit.ts). */
export interface SessionEnv extends SupabaseEnv {
  RATE_LIMIT?: KVNamespace;
  LOGIN_RATE_LIMIT?: RateLimit;
}

export interface SessionUser {
  sub: string;
  email: string | null;
  name: string | null;
}

interface SupabaseAuthUser {
  id: string;
  email?: string | null;
  user_metadata?: Record<string, unknown>;
}

export type SignUpResult =
  | { ok: true; grant: TokenGrant | null; user: SupabaseAuthUser | null }
  | { ok: false; reason: 'invalid_signup' | 'upstream' };

export interface TokenGrant {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  user?: SupabaseAuthUser;
}

export type GrantResult =
  | { ok: true; grant: TokenGrant }
  | { ok: false; reason: 'invalid_grant' | 'upstream' };

/**
 * Decode a JWT payload without verifying the signature. Fine here: the
 * token either came from Supabase over TLS moments ago or from a cookie we
 * set ourselves, and authorization is enforced by PostgREST/RLS on every
 * data access — this decode only feeds display identity and expiry checks.
 */
export function decodeJwtPayload(jwt: string): Record<string, unknown> | null {
  try {
    const [, payload] = jwt.split('.');
    if (!payload) return null;
    const b64 = payload.replace(/-/g, '+').replace(/_/g, '/');
    const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4);
    return JSON.parse(atob(padded)) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function nameFromMetadata(meta: Record<string, unknown> | undefined): string | null {
  if (!meta) return null;
  for (const key of ['display_name', 'full_name', 'name']) {
    const v = meta[key];
    if (typeof v === 'string' && v.length > 0) return v;
  }
  return null;
}

export function sessionUserFromClaims(claims: Record<string, unknown>): SessionUser | null {
  const sub = claims.sub;
  if (typeof sub !== 'string' || !sub) return null;
  return {
    sub,
    email: typeof claims.email === 'string' ? claims.email : null,
    name: nameFromMetadata(claims.user_metadata as Record<string, unknown> | undefined),
  };
}

function sessionUserFromAuthUser(user: SupabaseAuthUser): SessionUser {
  return {
    sub: user.id,
    email: user.email ?? null,
    name: nameFromMetadata(user.user_metadata),
  };
}

async function tokenGrant(
  env: SessionEnv,
  grantType: 'password' | 'refresh_token',
  body: Record<string, string>,
): Promise<GrantResult> {
  let res: Response;
  try {
    res = await fetch(`${env.PUBLIC_SUPABASE_URL}/auth/v1/token?grant_type=${grantType}`, {
      method: 'POST',
      headers: {
        apikey: env.PUBLIC_SUPABASE_ANON_KEY,
        'content-type': 'application/json',
      },
      body: JSON.stringify(body),
    });
  } catch {
    return { ok: false, reason: 'upstream' };
  }
  if (!res.ok) {
    // 4xx = the grant itself is bad (wrong password, revoked/reused refresh
    // token); anything else is Supabase being unavailable.
    return { ok: false, reason: res.status < 500 ? 'invalid_grant' : 'upstream' };
  }
  const grant = (await res.json()) as TokenGrant;
  if (!grant.access_token || !grant.refresh_token) return { ok: false, reason: 'upstream' };
  return { ok: true, grant };
}

export function passwordGrant(env: SessionEnv, email: string, password: string): Promise<GrantResult> {
  return tokenGrant(env, 'password', { email, password });
}

export function refreshGrant(env: SessionEnv, refreshToken: string): Promise<GrantResult> {
  return tokenGrant(env, 'refresh_token', { refresh_token: refreshToken });
}

export async function signUp(
  env: SessionEnv,
  email: string,
  password: string,
  fullName: string,
): Promise<SignUpResult> {
  let response: Response;
  try {
    response = await fetch(`${env.PUBLIC_SUPABASE_URL}/auth/v1/signup`, {
      method: 'POST',
      headers: {
        apikey: env.PUBLIC_SUPABASE_ANON_KEY,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        email,
        password,
        data: { full_name: fullName },
      }),
    });
  } catch {
    return { ok: false, reason: 'upstream' };
  }
  if (!response.ok) {
    return {
      ok: false,
      reason: response.status < 500 ? 'invalid_signup' : 'upstream',
    };
  }

  const body = (await response.json()) as Partial<TokenGrant> & {
    user?: SupabaseAuthUser | null;
  };
  const grant =
    body.access_token && body.refresh_token && typeof body.expires_in === 'number'
      ? (body as TokenGrant)
      : null;
  return { ok: true, grant, user: body.user ?? null };
}

/** Best-effort server-side revocation on logout. Cookie clearing is the
 * real logout; this additionally invalidates the refresh token at Supabase
 * so a previously-exfiltrated copy dies too. */
export async function revokeSession(env: SessionEnv, accessToken: string): Promise<void> {
  try {
    await fetch(`${env.PUBLIC_SUPABASE_URL}/auth/v1/logout`, {
      method: 'POST',
      headers: {
        apikey: env.PUBLIC_SUPABASE_ANON_KEY,
        Authorization: `Bearer ${accessToken}`,
      },
    });
  } catch {
    /* revocation is best-effort — the cookies are cleared regardless */
  }
}

export function setSessionCookies(cookies: Cookies, grant: TokenGrant): void {
  cookies.set(ACCESS_COOKIE, grant.access_token, {
    path: '/',
    httpOnly: true,
    secure: !dev,
    sameSite: 'strict',
    maxAge: grant.expires_in,
  });
  cookies.set(REFRESH_COOKIE, grant.refresh_token, {
    path: REFRESH_COOKIE_PATH,
    httpOnly: true,
    secure: !dev,
    sameSite: 'strict',
    maxAge: REFRESH_MAX_AGE,
  });
}

export function clearSessionCookies(cookies: Cookies): void {
  cookies.delete(ACCESS_COOKIE, { path: '/' });
  cookies.delete(REFRESH_COOKIE, { path: REFRESH_COOKIE_PATH });
}

export interface FreshSession {
  jwt: string;
  expiresAt: number; // epoch ms
  user: SessionUser;
}

/**
 * Return a valid session from the request cookies, transparently refreshing
 * (and rotating the cookies) when the access token is expired or about to
 * expire. Null = no session; the caller answers 401.
 *
 * Only callable from routes under /api/auth — the refresh cookie's Path
 * doesn't travel anywhere else.
 */
export async function ensureFreshSession(
  cookies: Cookies,
  env: SessionEnv,
): Promise<FreshSession | null> {
  const at = cookies.get(ACCESS_COOKIE);
  if (at) {
    const claims = decodeJwtPayload(at);
    const exp = typeof claims?.exp === 'number' ? claims.exp * 1000 : 0;
    // 30 s of slack so a token that's about to die doesn't get handed out.
    if (claims && exp > Date.now() + 30_000) {
      const user = sessionUserFromClaims(claims);
      if (user) return { jwt: at, expiresAt: exp, user };
    }
  }

  const rt = cookies.get(REFRESH_COOKIE);
  if (!rt) return null;

  const result = await refreshGrant(env, rt);
  if (!result.ok) {
    // A dead refresh token (revoked, rotated elsewhere) means the session
    // is over — clear the cookies so the client stops retrying.
    if (result.reason === 'invalid_grant') clearSessionCookies(cookies);
    return null;
  }

  setSessionCookies(cookies, result.grant);
  const claims = decodeJwtPayload(result.grant.access_token);
  const user = result.grant.user
    ? sessionUserFromAuthUser(result.grant.user)
    : claims
      ? sessionUserFromClaims(claims)
      : null;
  if (!user) return null;
  return {
    jwt: result.grant.access_token,
    expiresAt: Date.now() + result.grant.expires_in * 1000,
    user,
  };
}
