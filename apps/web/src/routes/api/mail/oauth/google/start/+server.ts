/**
 * GET /api/mail/oauth/google/start?scope=personal|workspace&workspace_id=…&return=/h/…
 *
 * Empieza la conexión de un buzón de Google (ADR-099). Navegación de página
 * completa desde Ajustes, con sesión. El permiso real (miembro para el
 * personal, admin para el común) lo decide `connect_mail_account` al final;
 * aquí solo se evita mandar a Google a quien seguro no puede.
 */

import type { RequestHandler } from './$types';
import { redirect } from '@sveltejs/kit';
import { extractAccessToken } from '$lib/auth';
import { pgPostRpc, type SupabaseEnv } from '$lib/supabase';
import { importMailKey, pkcePair, randomToken } from '$lib/server/mail/crypto';
import { mailConfigured } from '$lib/server/mail/db';
import { googleAuthUrl } from '$lib/server/mail/gmail';
import { jwtSubject, UUID_RE } from '$lib/server/mail/http';
import { FLOW_TTL_MS, safeReturnPath, withQuery, writeFlow } from '$lib/server/mail/oauth';

export const GET: RequestHandler = async ({ request, url, cookies, platform }) => {
  const env = platform?.env;
  const back = safeReturnPath(url.searchParams.get('return'));
  const fail = (reason: string) => redirect(303, withQuery(back, { mail: 'error', reason }));

  if (!mailConfigured(env)) fail('not_configured');
  const jwt = extractAccessToken(request);
  const sub = jwt ? jwtSubject(jwt) : null;
  if (!jwt || !sub) redirect(303, '/login');

  const scope = url.searchParams.get('scope') === 'workspace' ? 'workspace' : 'personal';
  const workspaceId = url.searchParams.get('workspace_id') ?? '';
  if (!UUID_RE.test(workspaceId)) fail('invalid_workspace');

  const check = await pgPostRpc<boolean>(
    env as unknown as SupabaseEnv,
    scope === 'workspace' ? 'is_workspace_admin' : 'is_workspace_member',
    jwt,
    { ws_id: workspaceId },
  ).catch(() => null);
  if (check?.data[0] !== true) fail('forbidden');

  const key = await importMailKey(env!.MAIL_TOKEN_KEY);
  const state = randomToken();
  const { verifier, challenge } = await pkcePair();
  await writeFlow(cookies, key, {
    n: state,
    v: verifier,
    s: scope,
    w: workspaceId,
    u: sub!,
    r: back,
    e: Date.now() + FLOW_TTL_MS,
  });

  redirect(
    303,
    googleAuthUrl({
      clientId: env!.GOOGLE_OAUTH_CLIENT_ID!,
      redirectUri: `${url.origin}/api/mail/oauth/google/callback`,
      state,
      codeChallenge: challenge,
    }),
  );
};
