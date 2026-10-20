/**
 * POST /api/mail/accounts/:id/sync — «Sincronizar ahora». Quien gestiona el
 * buzón (dueño o admin) lanza una pasada de ese buzón sin esperar al cron.
 * La pasada corre con la clave de servicio, como el cron: así no depende de
 * qué conversaciones vea quien pulsa.
 */

import type { RequestHandler } from './$types';
import { extractAccessToken } from '$lib/auth';
import { pgPostRpc, type SupabaseEnv } from '$lib/supabase';
import { pgErrorResponse } from '$lib/server/errors';
import { mailConfigured } from '$lib/server/mail/db';
import { jsonNoStore, UUID_RE } from '$lib/server/http';
import { runMailSync } from '$lib/server/mail/sync';

export const POST: RequestHandler = async ({ request, params, platform, locals }) => {
  if (!platform?.env) return jsonNoStore({ error: 'platform_unavailable' }, 500);
  if (!mailConfigured(platform.env)) return jsonNoStore({ error: 'not_configured' }, 503);
  const jwt = extractAccessToken(request);
  if (!jwt) return jsonNoStore({ error: 'missing_authorization' }, 401);
  if (!UUID_RE.test(params.id)) return jsonNoStore({ error: 'invalid_id' }, 400);

  try {
    const can = await pgPostRpc<boolean>(platform.env as unknown as SupabaseEnv, 'can_manage_mail_account', jwt, {
      p_account_id: params.id,
    });
    if (can.data[0] !== true) return jsonNoStore({ error: 'not_found' }, 404);
  } catch (err) {
    return pgErrorResponse(err, { route: 'POST /api/mail/accounts/[id]/sync', requestId: locals.requestId });
  }

  const [result] = await runMailSync(platform.env, { accountId: params.id });
  // Sin resultado: otra pasada lo tiene tomado ahora mismo.
  if (!result) return jsonNoStore({ status: 'busy' }, 202);
  return jsonNoStore({
    status: result.status,
    ingested: result.ingested,
    complete: result.complete,
    error: result.error,
  });
};
