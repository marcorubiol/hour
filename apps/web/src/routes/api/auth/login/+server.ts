/**
 * POST /api/auth/login — password sign-in, Worker-mediated (Phase 0.9).
 *
 * The browser no longer talks to Supabase Auth directly: the Worker runs
 * the password grant and sets the httpOnly session cookies, so tokens
 * never touch JS. Rate-limited per IP — this also shields Supabase's own
 * per-IP auth limits, which all users would otherwise share through the
 * Worker's egress IPs.
 */

import type { RequestHandler } from './$types';
import * as v from 'valibot';
import {
  passwordGrant,
  setSessionCookies,
  type SessionEnv,
} from '$lib/server/session';
import { allowRequest, clientIp } from '$lib/server/rate-limit';

const LOGIN_RULE = { limit: 10, windowSec: 300 };

const BodySchema = v.object({
  email: v.pipe(v.string(), v.trim(), v.minLength(3), v.maxLength(320)),
  password: v.pipe(v.string(), v.minLength(1), v.maxLength(200)),
});

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

export const POST: RequestHandler = async ({ request, cookies, platform }) => {
  if (!platform?.env) return json({ error: 'platform_unavailable' }, 500);
  const env = platform.env as unknown as SessionEnv;

  if (!(await allowRequest(env.RATE_LIMIT, `login:${clientIp(request)}`, LOGIN_RULE))) {
    return json({ error: 'rate_limited' }, 429);
  }

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return json({ error: 'invalid_body' }, 400);
  }
  const parsed = v.safeParse(BodySchema, raw);
  if (!parsed.success) return json({ error: 'invalid_body' }, 400);

  const result = await passwordGrant(env, parsed.output.email, parsed.output.password);
  if (!result.ok) {
    // Same public shape for wrong-password and unknown-user — no oracle.
    if (result.reason === 'invalid_grant') return json({ error: 'invalid_credentials' }, 401);
    return json({ error: 'auth_unavailable' }, 502);
  }

  setSessionCookies(cookies, result.grant);
  const user = result.grant.user
    ? {
        sub: result.grant.user.id,
        email: result.grant.user.email ?? null,
        name:
          (result.grant.user.user_metadata?.display_name as string | undefined) ??
          (result.grant.user.user_metadata?.full_name as string | undefined) ??
          (result.grant.user.user_metadata?.name as string | undefined) ??
          null,
      }
    : null;
  return json({ user });
};
