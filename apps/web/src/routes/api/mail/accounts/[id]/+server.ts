/**
 * DELETE /api/mail/accounts/:id — desconectar un buzón.
 *
 * Primero la base dice si quien llama lo gestiona (`can_manage_mail_account`:
 * dueño del personal, admin del común). Después se revoca el permiso en Google
 * (mejor esfuerzo) y se borra la conexión. Los correos ya registrados se
 * quedan en sus conversaciones.
 */

import type { RequestHandler } from './$types';
import * as v from 'valibot';
import { SignatureSchema } from '$lib/mail';
import { extractAccessToken } from '$lib/auth';
import { pgPostRpc, type SupabaseEnv } from '$lib/supabase';
import { pgErrorResponse } from '$lib/server/errors';
import { decryptSecret, importMailKey, refreshTokenAad } from '$lib/server/mail/crypto';
import { mailConfigured, serviceMailDb } from '$lib/server/mail/db';
import { googleAdapter } from '$lib/server/mail/gmail';
import { json, UUID_RE } from '$lib/server/mail/http';

/**
 * PUT /api/mail/accounts/:id — { signature }: la firma de Hour del buzón
 * (ADR-099, añadido). La edita quien lo gestiona (`set_mail_signature`).
 */
export const PUT: RequestHandler = async ({ request, params, platform, locals }) => {
  if (!platform?.env) return json({ error: 'platform_unavailable' }, 500);
  const jwt = extractAccessToken(request);
  if (!jwt) return json({ error: 'missing_authorization' }, 401);
  if (!UUID_RE.test(params.id)) return json({ error: 'invalid_id' }, 400);
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return json({ error: 'invalid_body' }, 400);
  }
  const parsed = v.safeParse(SignatureSchema, raw);
  if (!parsed.success) return json({ error: 'invalid_body' }, 400);
  try {
    await pgPostRpc(platform.env as unknown as SupabaseEnv, 'set_mail_signature', jwt, {
      p_account_id: params.id,
      p_signature: parsed.output.signature,
    });
    return json({ signature: parsed.output.signature?.trim() || null });
  } catch (err) {
    return pgErrorResponse(
      err,
      { route: 'PUT /api/mail/accounts/[id]', requestId: locals.requestId },
      { codes: { '42501': { status: 404, error: 'not_found' } } },
    );
  }
};

export const DELETE: RequestHandler = async ({ request, params, platform, locals }) => {
  if (!platform?.env) return json({ error: 'platform_unavailable' }, 500);
  const env = platform.env;
  const supa = env as unknown as SupabaseEnv;
  const jwt = extractAccessToken(request);
  if (!jwt) return json({ error: 'missing_authorization' }, 401);
  if (!UUID_RE.test(params.id)) return json({ error: 'invalid_id' }, 400);

  try {
    const can = await pgPostRpc<boolean>(supa, 'can_manage_mail_account', jwt, { p_account_id: params.id });
    if (can.data[0] !== true) return json({ error: 'not_found' }, 404);

    if (mailConfigured(env)) {
      try {
        const account = await serviceMailDb(env).account(params.id);
        if (account) {
          const key = await importMailKey(env.MAIL_TOKEN_KEY);
          const token = await decryptSecret(
            key,
            account.refresh_token_ciphertext,
            refreshTokenAad(account.workspace_id, account.address),
          );
          await googleAdapter(fetch, {
            clientId: env.GOOGLE_OAUTH_CLIENT_ID,
            clientSecret: env.GOOGLE_OAUTH_CLIENT_SECRET,
          }).revoke(token);
        }
      } catch {
        /* revocar es cortesía: la conexión se borra igual */
      }
    }

    await pgPostRpc(supa, 'disconnect_mail_account', jwt, { p_account_id: params.id });
    return new Response(null, { status: 204 });
  } catch (err) {
    return pgErrorResponse(
      err,
      { route: 'DELETE /api/mail/accounts/[id]', requestId: locals.requestId },
      { codes: { '42501': { status: 404, error: 'not_found' } } },
    );
  }
};
