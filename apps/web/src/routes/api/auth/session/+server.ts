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
import { readValidAccessSession, refreshFreshSession, type SessionEnv } from '$lib/server/session';
import { allowRequest, clientIp } from '$lib/server/rate-limit';
import { jsonNoStore } from '$lib/server/http';

// Same refresh-amplification backstop as /api/auth/token — generous per-IP cap
// on the refresh path. A valid access cookie answers directly with zero KV I/O
// so warm opens never pay a KV read+write round-trip before firing data reads.
const SESSION_RULE = { limit: 240, windowSec: 300 };

export const GET: RequestHandler = async ({ request, cookies, platform }) => {
  if (!platform?.env) return jsonNoStore({ error: 'platform_unavailable' }, 500);
  const existing = readValidAccessSession(cookies);
  if (existing) return jsonNoStore({ user: existing.user, expiresAt: existing.expiresAt });

  const env = platform.env as unknown as SessionEnv;
  const waitUntil = platform.ctx?.waitUntil?.bind(platform.ctx);
  if (!(await allowRequest(env.RATE_LIMIT, `session:${clientIp(request)}`, SESSION_RULE, waitUntil))) {
    return jsonNoStore({ error: 'rate_limited' }, 429);
  }
  const session = await refreshFreshSession(cookies, env);
  if (!session) return jsonNoStore({ error: 'no_session' }, 401);
  return jsonNoStore({ user: session.user, expiresAt: session.expiresAt });
};
