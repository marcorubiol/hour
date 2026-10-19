/**
 * POST /api/auth/refresh — rotate the session (Phase 0.9).
 *
 * Called by $lib/api.ts when a request 401s: refresh once, retry once.
 * The refresh token only travels on /api/auth/* (cookie Path), and
 * Supabase rotates it on every use, so a replayed old token dies at the
 * next legitimate refresh.
 */

import type { RequestHandler } from './$types';
import { ensureFreshSession, type SessionEnv } from '$lib/server/session';
import { allowRequest, clientIp } from '$lib/server/rate-limit';
import { jsonNoStore } from '$lib/server/http';

const REFRESH_RULE = { limit: 60, windowSec: 300 };

export const POST: RequestHandler = async ({ request, cookies, platform }) => {
  if (!platform?.env) return jsonNoStore({ error: 'platform_unavailable' }, 500);
  const env = platform.env as unknown as SessionEnv;

  if (!(await allowRequest(env.RATE_LIMIT, `refresh:${clientIp(request)}`, REFRESH_RULE))) {
    return jsonNoStore({ error: 'rate_limited' }, 429);
  }

  const session = await ensureFreshSession(cookies, env);
  if (!session) return jsonNoStore({ error: 'no_session' }, 401);
  return jsonNoStore({ user: session.user, expiresAt: session.expiresAt });
};
