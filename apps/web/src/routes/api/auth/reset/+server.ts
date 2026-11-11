/**
 * POST /api/auth/reset — the new password, from a recovery link (tarea 132).
 *
 * Two shapes, by what the mail's link carried:
 *   { token_hash, password }                 the template with `{{ .TokenHash }}`
 *                                            (recommended: nothing reaches JS)
 *   { access_token, refresh_token, password } Supabase's default template, whose
 *                                            link leaves a session in the fragment
 * Either way the Worker sets the password with that session and then signs
 * the person in with httpOnly cookies, as `/api/auth/login` does.
 */

import type { RequestHandler } from './$types';
import * as v from 'valibot';
import {
  grantFromTokens,
  grantUser,
  setSessionCookies,
  updatePassword,
  verifyRecovery,
  type SessionEnv,
} from '$lib/server/session';
import { allowRequest, clientIp } from '$lib/server/rate-limit';
import { jsonNoStore } from '$lib/server/http';

const RESET_RULE = { limit: 10, windowSec: 900 };
const PASSWORD = v.pipe(v.string(), v.minLength(10), v.maxLength(200));
const Body = v.union([
  v.object({ token_hash: v.pipe(v.string(), v.minLength(8), v.maxLength(512)), password: PASSWORD }),
  v.object({
    access_token: v.pipe(v.string(), v.minLength(20), v.maxLength(4096)),
    refresh_token: v.pipe(v.string(), v.minLength(8), v.maxLength(512)),
    password: PASSWORD,
  }),
]);

export const POST: RequestHandler = async ({ request, cookies, platform }) => {
  if (!platform?.env) return jsonNoStore({ error: 'platform_unavailable' }, 500);
  const env = platform.env as unknown as SessionEnv;
  if (!(await allowRequest(env.RATE_LIMIT, `reset:${clientIp(request)}`, RESET_RULE))) {
    return jsonNoStore({ error: 'rate_limited' }, 429);
  }
  const parsed = v.safeParse(Body, await request.json().catch(() => null));
  if (!parsed.success) return jsonNoStore({ error: 'invalid_body' }, 400);
  const body = parsed.output;

  let grant;
  if ('token_hash' in body) {
    const verified = await verifyRecovery(env, body.token_hash);
    if (!verified.ok) {
      return jsonNoStore(
        { error: verified.reason === 'invalid_grant' ? 'link_expired' : 'auth_unavailable' },
        verified.reason === 'invalid_grant' ? 401 : 502,
      );
    }
    grant = verified.grant;
  } else {
    grant = grantFromTokens(body.access_token, body.refresh_token);
    if (!grant) return jsonNoStore({ error: 'link_expired' }, 401);
  }

  const updated = await updatePassword(env, grant.access_token, body.password);
  if (!updated.ok) {
    const [error, status] =
      updated.reason === 'rejected'
        ? ['password_rejected', 422]
        : updated.reason === 'expired'
          ? ['link_expired', 401]
          : ['auth_unavailable', 502];
    return jsonNoStore({ error }, status as number);
  }

  setSessionCookies(cookies, grant);
  return jsonNoStore({ user: grantUser(updated.user ?? grant.user) });
};
