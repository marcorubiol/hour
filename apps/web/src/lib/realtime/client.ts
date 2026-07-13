/**
 * Browser-only thin wrapper around @supabase/realtime-js.
 *
 * Why standalone: pulling all of @supabase/supabase-js for one feature would
 * bloat the bundle for nothing — we only need the WebSocket transport and
 * channel API. The PostgREST side already lives in `$lib/supabase.ts` as
 * raw fetch, same philosophy.
 *
 * Lifecycle:
 *   - One client per browser tab. Owned by `/h/[workspace]/+layout.svelte`
 *     via setContext (mirrors lens.svelte.ts / selection.svelte.ts).
 *   - Construction triggers `connect()` so the WebSocket opens immediately;
 *     individual channels join lazily on `.subscribe()`.
 *   - `dispose()` removes all channels and closes the socket. Call from the
 *     layout's onDestroy.
 */

import { RealtimeClient, type RealtimeChannel } from '@supabase/realtime-js';
import { getContext, setContext } from 'svelte';

export interface RealtimeEnv {
  PUBLIC_SUPABASE_URL: string;
  PUBLIC_SUPABASE_ANON_KEY: string;
}

/**
 * Decode the Supabase auth JWT enough to find the user's UUID. Used as the
 * stable presence key so reconnects don't appear as a new user.
 *
 * We hand-roll instead of pulling jwt-decode (~1KB extra) — the JWT body is
 * trivially base64url-decodable. Returns null on malformed input; the caller
 * decides whether to fall back to an anonymous key or skip presence.
 */
export function decodeJwtSub(jwt: string): string | null {
  return decodeJwtClaim(jwt, 'sub');
}

/**
 * Decode any string claim from a Supabase JWT payload. Returns null on
 * malformed input or non-string claim. Used by callers who need the user's
 * `email`, or `user_metadata.full_name` for greetings and presence labels.
 */
export function decodeJwtClaim(jwt: string, path: string): string | null {
  try {
    const [, payload] = jwt.split('.');
    if (!payload) return null;
    const b64 = payload.replace(/-/g, '+').replace(/_/g, '/');
    const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4);
    const json = JSON.parse(atob(padded)) as Record<string, unknown>;
    const parts = path.split('.');
    let cur: unknown = json;
    for (const p of parts) {
      if (cur && typeof cur === 'object' && p in (cur as Record<string, unknown>)) {
        cur = (cur as Record<string, unknown>)[p];
      } else {
        return null;
      }
    }
    return typeof cur === 'string' ? cur : null;
  } catch {
    return null;
  }
}

/**
 * Suppliers instead of a captured JWT (Phase 0.9 cookie migration): the
 * access token now lives in an httpOnly cookie, so the client fetches it
 * on demand via /api/auth/token — which also means reconnects and re-auths
 * pick up a FRESH token instead of replaying the one from construction.
 * The user id comes from the session store; it's read lazily (getter)
 * because channels only join after the workspace list loads, by which
 * point the session probe has long resolved.
 */
export interface RealtimeAuth {
  /** Fresh access token for RLS-bearing requests. Null = no session. */
  getToken: () => Promise<string | null>;
  /** The signed-in user's UUID (presence key). Null while session loads. */
  getUserId: () => string | null;
}

export interface RealtimeHandle {
  client: RealtimeClient;
  /** The connected user's UUID — stable presence key across reconnects. */
  readonly userId: string;
  /** Channel name → channel, so we don't double-subscribe. */
  channel(name: string, opts?: Parameters<RealtimeClient['channel']>[1]): RealtimeChannel;
  /** Remove a channel. Idempotent. */
  release(name: string): void;
  /** Close the socket and drop all channels. */
  dispose(): void;
}

/**
 * Build a realtime handle. Construction is synchronous (setContext must
 * run during component init); auth happens via the async accessToken
 * supplier when channels join.
 */
export function createRealtimeClient(env: RealtimeEnv, auth: RealtimeAuth): RealtimeHandle {
  // Supabase wants the realtime URL with ws(s):// scheme.
  const wsUrl = `${env.PUBLIC_SUPABASE_URL.replace(/^http/, 'ws')}/realtime/v1`;

  const client = new RealtimeClient(wsUrl, {
    params: { apikey: env.PUBLIC_SUPABASE_ANON_KEY },
    // RLS-bearing requests need the user's JWT, not the anon key. Falling
    // back to the anon key keeps the socket protocol-valid when the
    // session is gone; RLS then simply returns nothing.
    accessToken: async () => (await auth.getToken()) ?? env.PUBLIC_SUPABASE_ANON_KEY,
  });
  client.connect();
  void auth.getToken().then((token) => {
    if (token) client.setAuth(token);
  });

  const channels = new Map<string, RealtimeChannel>();

  return {
    client,
    get userId() {
      return auth.getUserId() ?? '';
    },
    channel(name, opts) {
      const existing = channels.get(name);
      if (existing) return existing;
      const ch = client.channel(name, opts);
      channels.set(name, ch);
      return ch;
    },
    release(name) {
      const ch = channels.get(name);
      if (!ch) return;
      client.removeChannel(ch);
      channels.delete(name);
    },
    dispose() {
      for (const ch of channels.values()) client.removeChannel(ch);
      channels.clear();
      client.disconnect();
    },
  };
}

const KEY = Symbol('realtime');

/**
 * Construct + register the per-tab handle. Call once from the workspace
 * layout; child layouts/pages reach for it via `useRealtime()`. Mirrors
 * the lens/selection conventions for SSR safety.
 */
export function provideRealtime(env: RealtimeEnv, auth: RealtimeAuth): RealtimeHandle {
  const handle = createRealtimeClient(env, auth);
  setContext(KEY, handle);
  return handle;
}

export function useRealtime(): RealtimeHandle {
  const handle = getContext<RealtimeHandle | undefined>(KEY);
  if (!handle) {
    throw new Error('useRealtime: no RealtimeHandle in context — call provideRealtime in /h/[workspace]/+layout.svelte first.');
  }
  return handle;
}
