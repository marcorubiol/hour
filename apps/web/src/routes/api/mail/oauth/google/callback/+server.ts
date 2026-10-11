/**
 * GET /api/mail/oauth/google/callback — la vuelta desde Google.
 *
 * Aquí no hay sesión (las cookies Strict no viajan en una navegación que viene
 * de otro sitio). Solo se comprueba el `state` contra la cookie sellada del
 * flujo, se guarda el código en ella y se vuelve a Ajustes con una página que
 * navega por sí misma; Ajustes llama a `finish`, ya con sesión. El código no
 * se canjea aquí.
 */

import type { RequestHandler } from './$types';
import { importMailKey } from '$lib/server/mail/crypto';
import { mailConfigured } from '$lib/server/mail/db';
import { bounceHtml, clearFlow, readFlow, withQuery, writeFlow } from '$lib/server/mail/oauth';

export const GET: RequestHandler = async ({ url, cookies, platform }) => {
  const env = platform?.env;
  if (!mailConfigured(env)) return bounceHtml('/h?mail=error&reason=not_configured');
  const key = await importMailKey(env.MAIL_TOKEN_KEY);
  const flow = await readFlow(cookies, key);
  if (!flow) return bounceHtml('/h?mail=error&reason=expired');

  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  if (url.searchParams.get('error') || !code || state !== flow.n) {
    clearFlow(cookies);
    const reason = url.searchParams.get('error') === 'access_denied' ? 'denied' : 'invalid_state';
    return bounceHtml(withQuery(flow.r, { mail: 'error', reason }));
  }

  await writeFlow(cookies, key, { ...flow, c: code });
  return bounceHtml(withQuery(flow.r, { mail: 'finish' }));
};
