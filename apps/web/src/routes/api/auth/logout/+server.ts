/**
 * POST /api/auth/logout — end the session (Phase 0.9).
 *
 * Clears both session cookies (the real logout) and best-effort revokes
 * the refresh token at Supabase so an exfiltrated copy dies too.
 */

import type { RequestHandler } from './$types';
import {
  ACCESS_COOKIE,
  clearSessionCookies,
  revokeSession,
  type SessionEnv,
} from '$lib/server/session';

export const POST: RequestHandler = async ({ cookies, platform }) => {
  const at = cookies.get(ACCESS_COOKIE);
  clearSessionCookies(cookies);
  if (at && platform?.env) {
    await revokeSession(platform.env as unknown as SessionEnv, at);
  }
  return new Response(null, { status: 204 });
};
