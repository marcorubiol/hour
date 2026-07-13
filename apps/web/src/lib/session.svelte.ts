/**
 * Client session state (Phase 0.9 cookie migration).
 *
 * The JWT lives in httpOnly cookies now, so the client can't decode it —
 * identity comes from GET /api/auth/session once per boot and lives here.
 * Every former `localStorage.getItem('hour_jwt')` presence-gate and every
 * client-side JWT decode (account menu, greeting, settings, presence
 * labels, note authorship) reads this instead.
 *
 * One implementation, one boot probe: `ensureSession()` memoizes the
 * in-flight fetch so the root gate, the /h layout gate and the login
 * bounce all share a single request.
 */

export interface SessionUser {
  sub: string;
  email: string | null;
  name: string | null;
}

export const session = $state<{ user: SessionUser | null; ready: boolean }>({
  user: null,
  ready: false,
});

let probe: Promise<SessionUser | null> | null = null;

async function fetchSession(): Promise<SessionUser | null> {
  try {
    const res = await fetch('/api/auth/session');
    if (res.ok) {
      const body = (await res.json()) as { user: SessionUser | null };
      session.user = body.user;
    } else {
      session.user = null;
    }
  } catch {
    session.user = null;
  } finally {
    session.ready = true;
  }
  return session.user;
}

/** Resolve the current user, probing the server at most once per boot.
 * After a login or logout, call `setSessionUser`/`clearSession` — they
 * reset the memo so the next gate re-probes honestly. */
export function ensureSession(): Promise<SessionUser | null> {
  probe ??= fetchSession();
  return probe;
}

/** Login just returned the user — seed the store without a second probe. */
export function setSessionUser(user: SessionUser | null): void {
  session.user = user;
  session.ready = true;
  probe = Promise.resolve(user);
}

export function clearSession(): void {
  session.user = null;
  session.ready = true;
  probe = null;
}

/**
 * The deliberate hole in the httpOnly wall (see /api/auth/token): returns
 * the short-lived access token for the two cross-origin consumers that
 * need the raw JWT in JS (Supabase Realtime, has_permission RPC). Also
 * refreshes the access cookie as a side effect — YNotes awaits this
 * before a WebSocket (re)connect so the upgrade carries a live cookie.
 */
export async function getAccessToken(): Promise<string | null> {
  try {
    const res = await fetch('/api/auth/token');
    if (!res.ok) return null;
    const body = (await res.json()) as { token?: string };
    return body.token ?? null;
  } catch {
    return null;
  }
}
