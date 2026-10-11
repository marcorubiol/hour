/**
 * GET /api/mail/accounts?workspace_id=… — los buzones que quien llama puede
 * ver en ese espacio (RLS: su personal y el común), si puede gestionar el
 * común, y si el correo está configurado en este Worker.
 */

import type { RequestHandler } from './$types';
import { extractAccessToken } from '$lib/auth';
import { pgGet, pgPostRpc, type SupabaseEnv } from '$lib/supabase';
import { pgErrorResponse } from '$lib/server/errors';
import { mailConfigured } from '$lib/server/mail/db';
import { json, UUID_RE } from '$lib/server/mail/http';
import { MAIL_ACCOUNT_SELECT, type MailAccountItem } from '$lib/mail';

export const GET: RequestHandler = async ({ request, url, platform, locals }) => {
  if (!platform?.env) return json({ error: 'platform_unavailable' }, 500);
  const env = platform.env as unknown as SupabaseEnv;
  const jwt = extractAccessToken(request);
  if (!jwt) return json({ error: 'missing_authorization' }, 401);
  const workspaceId = url.searchParams.get('workspace_id') ?? '';
  if (!UUID_RE.test(workspaceId)) return json({ error: 'invalid_workspace' }, 400);

  try {
    const [accounts, admin] = await Promise.all([
      pgGet<MailAccountItem>(env, 'mail_account', jwt, {
        search: { select: MAIL_ACCOUNT_SELECT, workspace_id: `eq.${workspaceId}`, order: 'scope.asc,created_at.asc' },
      }),
      pgPostRpc<boolean>(env, 'is_workspace_admin', jwt, { ws_id: workspaceId }),
    ]);
    return json({
      items: accounts.data,
      can_manage_shared: admin.data[0] === true,
      configured: mailConfigured(platform.env),
    });
  } catch (err) {
    return pgErrorResponse(err, { route: 'GET /api/mail/accounts', requestId: locals.requestId });
  }
};
