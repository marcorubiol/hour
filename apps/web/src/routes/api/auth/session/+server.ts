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

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
}

export const GET: RequestHandler = async ({ cookies, platform }) => {
  if (!platform?.env) return json({ error: 'platform_unavailable' }, 500);
  const session = await ensureFreshSession(cookies, platform.env as unknown as SessionEnv);
  if (!session) return json({ error: 'no_session' }, 401);
  return json({ user: session.user, expiresAt: session.expiresAt });
};
