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
 *
 * And one renewal at a time (2026-10-24). The probe, `/api/auth/token` and
 * `/api/auth/refresh` all rotate a stale access cookie server-side; fired
 * together after the hour, they each ran a refresh grant against Supabase
 * Auth. Now: the token is asked once (single-flight) and kept in memory
 * until its own expiry, as the realtime socket already kept it; a 401 joins
 * the renewal already in flight instead of starting one; and once the
 * server has said when the access cookie dies, a request after that renews
 * first instead of collecting three 401s. Nothing is stored in the browser:
 * all of this is module memory, gone with the tab.
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

/** Renew this long before the access cookie dies (the server renews within 30 s of it). */
const RENEW_BEFORE_MS = 5_000;
/** Hand the cached token out only while it has at least this left. */
const TOKEN_MIN_LIFE_MS = 60_000;

let probe: Promise<SessionUser | null> | null = null;
/** The boot probe while it is on the wire (it renews a stale cookie itself). */
let probing: Promise<SessionUser | null> | null = null;
let refreshing: Promise<boolean> | null = null;
let tokenFlight: Promise<string | null> | null = null;
let token: { value: string; expiresAt: number } | null = null;
/** When the access cookie dies, in this browser's clock; null while unknown or untrusted. */
let accessExpiresAt: number | null = null;
/** When the server last vouched for the cookie (probe, refresh or token), in this browser's clock. */
let confirmedAt = 0;

/**
 * Record the expiry an auth endpoint reports (server epoch ms), moved into
 * this browser's clock by the response's `Date`, so a phone whose clock is
 * off does not renew too early or too late.
 */
function noteExpiry(res: Response, expiresAt: unknown): number | null {
  if (typeof expiresAt !== 'number') return null;
  const server = Date.parse(res.headers.get('date') ?? '');
  const skew = Number.isFinite(server) ? server - Date.now() : 0;
  accessExpiresAt = expiresAt - skew;
  confirmedAt = Date.now();
  return accessExpiresAt;
}

function forgetRenewal(): void {
  accessExpiresAt = null;
  confirmedAt = 0;
  token = null;
}

async function fetchSession(): Promise<SessionUser | null> {
  try {
    const res = await fetch('/api/auth/session');
    if (res.ok) {
      const body = (await res.json()) as { user: SessionUser | null; expiresAt?: number };
      session.user = body.user;
      noteExpiry(res, body.expiresAt);
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
  if (!probe) {
    probing = fetchSession().finally(() => {
      probing = null;
    });
    probe = probing;
  }
  return probe;
}

/** Login just returned the user — seed the store without a second probe. */
export function setSessionUser(user: SessionUser | null): void {
  forgetRenewal();
  session.user = user;
  session.ready = true;
  probe = Promise.resolve(user);
  // The login response set the cookies a moment ago.
  if (user) confirmedAt = Date.now();
}

export function clearSession(): void {
  forgetRenewal();
  session.user = null;
  session.ready = true;
  probe = null;
}

/**
 * Single-flight session refresh: concurrent callers share one POST and one
 * cookie rotation. Resolves true when the session was renewed.
 */
export function refreshSession(): Promise<boolean> {
  refreshing ??= (async () => {
    try {
      const res = await fetch('/api/auth/refresh', { method: 'POST' });
      if (!res.ok) {
        forgetRenewal();
        return false;
      }
      const body = (await res.json().catch(() => ({}))) as { expiresAt?: number };
      token = null;
      noteExpiry(res, body.expiresAt);
      // Renewed and still «about to die» in this clock: the expiry cannot be
      // trusted here, so stop renewing ahead and let a 401 say when.
      if (accessExpiresAt !== null && accessExpiresAt - RENEW_BEFORE_MS <= Date.now()) accessExpiresAt = null;
      return true;
    } catch {
      return false;
    }
  })().finally(() => {
    refreshing = null;
  });
  return refreshing;
}

/**
 * Before a request: wait for a refresh on the wire, and renew first when the
 * access cookie is known to be dead. Does not wait for the boot probe: on a
 * live session that would put a round trip before every first read; a read
 * that loses the race gets a 401 and joins the probe (`recoverSession`).
 */
export async function sessionReady(): Promise<void> {
  if (refreshing) {
    await refreshing;
    return;
  }
  if (accessExpiresAt !== null && accessExpiresAt - RENEW_BEFORE_MS <= Date.now()) await refreshSession();
}

/**
 * A request sent at `sentAt` came back 401: may it be retried? A renewal
 * that landed after it left needs no second one; the boot probe on the
 * wire renews the cookie itself; otherwise, one shared refresh.
 */
export async function recoverSession(sentAt: number): Promise<boolean> {
  if (probing) return (await probing) !== null;
  if (refreshing) return refreshing;
  if (confirmedAt > sentAt) return true;
  return refreshSession();
}

/**
 * The deliberate hole in the httpOnly wall (see /api/auth/token): returns
 * the short-lived access token for the two cross-origin consumers that
 * need the raw JWT in JS (Supabase Realtime, has_permission RPC). Also
 * refreshes the access cookie as a side effect — YNotes awaits this
 * before a WebSocket (re)connect so the upgrade carries a live cookie.
 *
 * One request at a time, and none while the token in hand has a minute
 * left: its cookie (same expiry) is alive too. Same token, same lifetime as
 * the endpoint hands out; only the number of round trips changes.
 */
export function getAccessToken(): Promise<string | null> {
  if (token && token.expiresAt - TOKEN_MIN_LIFE_MS > Date.now()) return Promise.resolve(token.value);
  tokenFlight ??= fetchToken().finally(() => {
    tokenFlight = null;
  });
  return tokenFlight;
}

async function fetchToken(): Promise<string | null> {
  // A probe or refresh on the wire is rotating the cookie: asking alongside
  // it would rotate it twice.
  await (probing ?? refreshing);
  try {
    const res = await fetch('/api/auth/token');
    if (!res.ok) return null;
    const body = (await res.json()) as { token?: string; expiresAt?: number };
    const expiresAt = noteExpiry(res, body.expiresAt);
    token = body.token && expiresAt !== null ? { value: body.token, expiresAt } : null;
    return body.token ?? null;
  } catch {
    return null;
  }
}
