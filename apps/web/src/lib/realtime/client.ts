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
  try {
    const [, payload] = jwt.split('.');
    if (!payload) return null;
    const b64 = payload.replace(/-/g, '+').replace(/_/g, '/');
    const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4);
    const json = JSON.parse(atob(padded)) as { sub?: unknown };
    return typeof json.sub === 'string' ? json.sub : null;
  } catch {
    return null;
  }
}

export interface RealtimeHandle {
  client: RealtimeClient;
  /** Decoded `sub` claim — the connected user's UUID. */
  userId: string;
  /** Channel name → channel, so we don't double-subscribe. */
  channel(name: string, opts?: Parameters<RealtimeClient['channel']>[1]): RealtimeChannel;
  /** Remove a channel. Idempotent. */
  release(name: string): void;
  /** Close the socket and drop all channels. */
  dispose(): void;
}

/**
 * Build a realtime handle. Throws if the JWT lacks a `sub` claim — without a
 * stable user key, presence would be useless.
 */
export function createRealtimeClient(env: RealtimeEnv, jwt: string): RealtimeHandle {
  const userId = decodeJwtSub(jwt);
  if (!userId) {
    throw new Error('createRealtimeClient: JWT has no `sub` claim — cannot anchor presence.');
  }

  // Supabase wants the realtime URL with ws(s):// scheme.
  const wsUrl = `${env.PUBLIC_SUPABASE_URL.replace(/^http/, 'ws')}/realtime/v1`;

  const client = new RealtimeClient(wsUrl, {
    params: { apikey: env.PUBLIC_SUPABASE_ANON_KEY },
    // RLS-bearing requests need the user's JWT, not the anon key.
    accessToken: () => Promise.resolve(jwt),
  });
  client.connect();
  client.setAuth(jwt);

  const channels = new Map<string, RealtimeChannel>();

  return {
    client,
    userId,
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
export function provideRealtime(env: RealtimeEnv, jwt: string): RealtimeHandle {
  const handle = createRealtimeClient(env, jwt);
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
