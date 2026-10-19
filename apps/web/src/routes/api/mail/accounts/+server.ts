/**
 * GET /api/mail/accounts?workspace_id=… — los buzones que quien llama puede
 * ver en ese espacio (RLS: su personal y el común), si puede gestionar el
 * común, si el correo está configurado en este Worker, y con qué firma sale
 * cada uno (la suya en ese espacio; la de la compañía, el común).
 */

import type { RequestHandler } from './$types';
import { extractAccessToken } from '$lib/auth';
import { pgGet, pgPostRpc, type SupabaseEnv } from '$lib/supabase';
import { pgErrorResponse } from '$lib/server/errors';
import { mailConfigured } from '$lib/server/mail/db';
import { jsonNoStore, UUID_RE } from '$lib/server/http';
import { effectiveSignature, MAIL_ACCOUNT_SELECT, type MailAccountItem, type SignatureParts } from '$lib/mail';

export const GET: RequestHandler = async ({ request, url, platform, locals }) => {
  if (!platform?.env) return jsonNoStore({ error: 'platform_unavailable' }, 500);
  const env = platform.env as unknown as SupabaseEnv;
  const jwt = extractAccessToken(request);
  if (!jwt) return jsonNoStore({ error: 'missing_authorization' }, 401);
  const workspaceId = url.searchParams.get('workspace_id') ?? '';
  if (!UUID_RE.test(workspaceId)) return jsonNoStore({ error: 'invalid_workspace' }, 400);

  try {
    const [accounts, admin, sig] = await Promise.all([
      pgGet<MailAccountItem>(env, 'mail_account', jwt, {
        search: { select: MAIL_ACCOUNT_SELECT, workspace_id: `eq.${workspaceId}`, order: 'scope.asc,created_at.asc' },
      }),
      pgPostRpc<boolean>(env, 'is_workspace_admin', jwt, { ws_id: workspaceId }),
      pgPostRpc<SignatureParts>(env, 'my_mail_signature', jwt, { p_workspace_id: workspaceId }),
    ]);
    const parts = sig.data[0];
    return jsonNoStore({
      items: accounts.data,
      can_manage_shared: admin.data[0] === true,
      configured: mailConfigured(platform.env),
      signatures: {
        personal: parts ? effectiveSignature(parts, 'personal') : '',
        workspace: parts ? effectiveSignature(parts, 'workspace') : '',
      },
    });
  } catch (err) {
    return pgErrorResponse(err, { route: 'GET /api/mail/accounts', requestId: locals.requestId });
  }
};
