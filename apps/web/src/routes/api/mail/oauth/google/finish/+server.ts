/**
 * POST /api/mail/oauth/google/finish — cierra la conexión, ya con sesión.
 *
 * Canjea el código (PKCE + secreto del cliente), exige los dos permisos y un
 * refresh token, lee la dirección del buzón, cifra el token (AES-GCM, AAD =
 * espacio + dirección) y conecta con `connect_mail_account` y el JWT de la
 * persona: la base decide si puede. Después lanza la primera sincronización en
 * segundo plano.
 */

import type { RequestHandler } from './$types';
import { extractAccessToken } from '$lib/auth';
import { pgPostRpc, PostgrestError, type SupabaseEnv } from '$lib/supabase';
import { encryptSecret, importMailKey, MAIL_TOKEN_KEY_VERSION, refreshTokenAad } from '$lib/server/mail/crypto';
import { mailConfigured } from '$lib/server/mail/db';
import { exchangeGoogleCode, googleAdapter, hasRequiredScopes } from '$lib/server/mail/gmail';
import { json, jwtSubject } from '$lib/server/mail/http';
import { clearFlow, readFlow } from '$lib/server/mail/oauth';
import { runMailSync } from '$lib/server/mail/sync';

export const POST: RequestHandler = async ({ request, url, cookies, platform }) => {
  const env = platform?.env;
  if (!mailConfigured(env)) return json({ error: 'not_configured' }, 503);
  const jwt = extractAccessToken(request);
  const sub = jwt ? jwtSubject(jwt) : null;
  if (!jwt || !sub) return json({ error: 'missing_authorization' }, 401);

  const key = await importMailKey(env.MAIL_TOKEN_KEY);
  const flow = await readFlow(cookies, key);
  clearFlow(cookies);
  if (!flow?.c) return json({ error: 'expired' }, 400);
  if (flow.u !== sub) return json({ error: 'forbidden' }, 403);

  const creds = { clientId: env.GOOGLE_OAUTH_CLIENT_ID, clientSecret: env.GOOGLE_OAUTH_CLIENT_SECRET };
  let tokens;
  try {
    tokens = await exchangeGoogleCode(fetch, {
      ...creds,
      code: flow.c,
      verifier: flow.v,
      redirectUri: `${url.origin}/api/mail/oauth/google/callback`,
    });
  } catch {
    return json({ error: 'exchange_failed' }, 502);
  }
  if (!hasRequiredScopes(tokens.scope)) return json({ error: 'missing_scopes' }, 400);
  if (!tokens.refreshToken) return json({ error: 'no_refresh_token' }, 400);

  const adapter = googleAdapter(fetch, creds);
  const { address } = await adapter.profile(tokens.accessToken);
  const sealed = await encryptSecret(key, tokens.refreshToken, refreshTokenAad(flow.w, address));

  try {
    const r = await pgPostRpc<string>(env as unknown as SupabaseEnv, 'connect_mail_account', jwt, {
      p_workspace_id: flow.w,
      p_scope: flow.s,
      p_provider: 'google',
      p_address: address,
      p_refresh_token_ciphertext: sealed,
      p_token_key_version: MAIL_TOKEN_KEY_VERSION,
    });
    const accountId = r.data[0];
    if (accountId) {
      platform?.ctx?.waitUntil(runMailSync(env, { accountId }).then(() => undefined, () => undefined));
    }
    return json({ account_id: accountId, address, scope: flow.s }, 201);
  } catch (err) {
    // El token ya no sirve a nadie: se revoca en Google.
    await adapter.revoke(tokens.refreshToken);
    if (err instanceof PostgrestError) {
      if (err.code === '42501') return json({ error: 'forbidden' }, 403);
      if (err.code === '23505') return json({ error: 'address_in_use' }, 409);
    }
    return json({ error: 'connect_failed' }, 502);
  }
};
