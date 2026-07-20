/** POST /api/auth/signup — self-registration for an invited collaborator. */

import type { RequestHandler } from './$types';
import * as v from 'valibot';
import { allowRequest, clientIp } from '$lib/server/rate-limit';
import { setSessionCookies, signUp, type SessionEnv } from '$lib/server/session';

const SIGNUP_RULE = { limit: 5, windowSec: 900 };
const Body = v.object({
  full_name: v.pipe(v.string(), v.trim(), v.minLength(2), v.maxLength(120)),
  email: v.pipe(v.string(), v.trim(), v.email(), v.maxLength(320)),
  password: v.pipe(v.string(), v.minLength(10), v.maxLength(200)),
});

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
}

export const POST: RequestHandler = async ({ request, cookies, platform }) => {
  if (!platform?.env) return json({ error: 'platform_unavailable' }, 500);
  const env = platform.env as unknown as SessionEnv;
  if (!(await allowRequest(env.RATE_LIMIT, `signup:${clientIp(request)}`, SIGNUP_RULE))) {
    return json({ error: 'rate_limited' }, 429);
  }
  const parsed = v.safeParse(Body, await request.json().catch(() => null));
  if (!parsed.success) return json({ error: 'invalid_body' }, 400);

  const result = await signUp(
    env,
    parsed.output.email,
    parsed.output.password,
    parsed.output.full_name,
  );
  if (!result.ok) {
    return json(
      { error: result.reason === 'invalid_signup' ? 'signup_rejected' : 'auth_unavailable' },
      result.reason === 'invalid_signup' ? 400 : 502,
    );
  }
  if (result.grant) {
    setSessionCookies(cookies, result.grant);
    return json(
      {
        status: 'signed_in',
        user: result.user
          ? {
              sub: result.user.id,
              email: result.user.email ?? null,
              name:
                (result.user.user_metadata?.full_name as string | undefined) ?? null,
            }
          : null,
      },
      201,
    );
  }
  return json({ status: 'confirmation_required' }, 202);
};
