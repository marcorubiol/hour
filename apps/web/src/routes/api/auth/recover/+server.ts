/**
 * POST /api/auth/recover — «¿Olvidaste la contraseña?» (tarea 132).
 *
 * Asks Supabase Auth to mail a recovery link that comes back to
 * `/login?mode=reset` on this origin. The answer never says whether the
 * address has an account (no oracle): sent or not, it is `sent`. Rate-limited
 * per IP and per address, ahead of Supabase's own (shared through the
 * Worker's egress) mail limit.
 *
 * Needs, in the Supabase project: this origin's `/login` in the redirect
 * allow list (Auth › URL Configuration), else Supabase falls back to its Site
 * URL. See `build/runbooks/password-recovery.md`.
 */

import type { RequestHandler } from './$types';
import * as v from 'valibot';
import { requestRecovery, type SessionEnv } from '$lib/server/session';
import { allowRequest, clientIp, hashKey } from '$lib/server/rate-limit';
import { jsonNoStore } from '$lib/server/http';

const RECOVER_RULE = { limit: 5, windowSec: 900 };
// One address, a few mails an hour: counted on every request, so a stranger
// cannot fill someone's inbox from many IPs.
const RECOVER_ACCOUNT_RULE = { limit: 3, windowSec: 3600 };

const Body = v.object({
  email: v.pipe(v.string(), v.trim(), v.email(), v.maxLength(320)),
});

export const POST: RequestHandler = async ({ request, platform, url }) => {
  if (!platform?.env) return jsonNoStore({ error: 'platform_unavailable' }, 500);
  const env = platform.env as unknown as SessionEnv;
  if (!(await allowRequest(env.RATE_LIMIT, `recover:${clientIp(request)}`, RECOVER_RULE))) {
    return jsonNoStore({ error: 'rate_limited' }, 429);
  }
  const parsed = v.safeParse(Body, await request.json().catch(() => null));
  if (!parsed.success) return jsonNoStore({ error: 'invalid_body' }, 400);

  const acctKey = `recover-acct:${await hashKey(parsed.output.email.toLowerCase())}`;
  // Over the address's budget: the same answer as a send, nothing goes out.
  if (!(await allowRequest(env.RATE_LIMIT, acctKey, RECOVER_ACCOUNT_RULE))) {
    return jsonNoStore({ status: 'sent' }, 202);
  }

  const result = await requestRecovery(env, parsed.output.email, `${url.origin}/login?mode=reset`);
  if (!result.ok) {
    return jsonNoStore(
      { error: result.reason === 'rate_limited' ? 'rate_limited' : 'auth_unavailable' },
      result.reason === 'rate_limited' ? 429 : 502,
    );
  }
  return jsonNoStore({ status: 'sent' }, 202);
};
