/**
 * GET /api/auth/session — who am I? (Phase 0.9)
 *
 * The client's boot probe: replaces every client-side JWT decode (identity
 * for the account menu, greeting, settings, presence labels) and every
 * localStorage presence-gate. Transparently refreshes an expired access
 * token when the refresh cookie is present, so a returning user with a
 * week-old tab lands signed-in instead of bounced.
 */

import type { RequestHandler } from './$types';
import { ensureFreshSession, type SessionEnv } from '$lib/server/session';
import { allowRequest, clientIp } from '$lib/server/rate-limit';
import { jsonNoStore } from '$lib/server/http';

// Same refresh-amplification backstop as /api/auth/token — generous per-IP cap
// on the endpoint that transparently refreshes a stale access cookie.
const SESSION_RULE = { limit: 240, windowSec: 300 };

export const GET: RequestHandler = async ({ request, cookies, platform }) => {
  if (!platform?.env) return jsonNoStore({ error: 'platform_unavailable' }, 500);
  const env = platform.env as unknown as SessionEnv;
  if (!(await allowRequest(env.RATE_LIMIT, `session:${clientIp(request)}`, SESSION_RULE))) {
    return jsonNoStore({ error: 'rate_limited' }, 429);
  }
  const session = await ensureFreshSession(cookies, env);
  if (!session) return jsonNoStore({ error: 'no_session' }, 401);
  return jsonNoStore({ user: session.user, expiresAt: session.expiresAt });
};
