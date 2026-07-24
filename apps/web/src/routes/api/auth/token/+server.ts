/**
 * GET /api/auth/token — hand the short-lived access token to JS (Phase 0.9).
 *
 * The deliberate hole in the httpOnly wall, kept as small as possible.
 * Two consumers are cross-origin and need the raw JWT in JavaScript:
 * Supabase Realtime (wss to supabase.co) and the has_permission RPC in
 * NotesModule. Only the ≤1 h access token ever crosses — the refresh
 * token stays httpOnly, so an XSS steal is bounded by the token TTL
 * instead of owning the session.
 *
 * Side effect by design: calling this refreshes the access cookie when
 * it's stale, so YNotes awaits it before a WebSocket (re)connect to make
 * sure the upgrade carries a live cookie.
 */

import type { RequestHandler } from './$types';
import { ensureFreshSession, type SessionEnv } from '$lib/server/session';
import { allowRequest, clientIp } from '$lib/server/rate-limit';

// ensureFreshSession hits Supabase's refresh grant when the access cookie is
// stale, so this endpoint is a refresh-amplification lever for an authed
// client that withholds the access cookie. Token rotation already bounds it;
// this per-IP backstop is generous (a WS-flapping tab / shared NAT stays well
// under) but caps a runaway loop. Matches /api/auth/session and /refresh.
const TOKEN_RULE = { limit: 240, windowSec: 300 };

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
}

export const GET: RequestHandler = async ({ request, cookies, platform }) => {
  if (!platform?.env) return json({ error: 'platform_unavailable' }, 500);
  const env = platform.env as unknown as SessionEnv;
  if (!(await allowRequest(env.RATE_LIMIT, `token:${clientIp(request)}`, TOKEN_RULE))) {
    return json({ error: 'rate_limited' }, 429);
  }
  const session = await ensureFreshSession(cookies, env);
  if (!session) return json({ error: 'no_session' }, 401);
  return json({ token: session.jwt, expiresAt: session.expiresAt });
};
