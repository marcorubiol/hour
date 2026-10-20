/**
 * POST /api/mailout/domains/[id]/check: «Comprobar» (plan § 5, paso 4).
 *
 * Solo el admin del espacio. El adaptador del dominio (el suyo, no el del
 * Worker) lee el estado de la identidad, y la base lo guarda como
 * service_role: verificado solo con DKIM y MAIL FROM en SUCCESS. Con el
 * simulador, comprobar lo da por verificado.
 */

import type { RequestHandler } from './$types';
import { extractAccessToken } from '$lib/auth';
import { pgErrorResponse } from '$lib/server/errors';
import { jsonNoStore, UUID_RE } from '$lib/server/http';
import {
  mailoutMissing,
  MailoutNotConfiguredError,
  recordDomainStatus,
  sendingProvider,
  type MailoutEnv,
} from '$lib/server/mailout';
import { DOMAIN_PG_CODES, isAdmin, notConfigured, readDomain } from '$lib/server/mailout/http';

export const POST: RequestHandler = async ({ request, params, platform, locals }) => {
  if (!platform?.env) return jsonNoStore({ error: 'platform_unavailable' }, 500);
  const env = platform.env as unknown as MailoutEnv;
  const jwt = extractAccessToken(request);
  if (!jwt) return jsonNoStore({ error: 'missing_authorization' }, 401);
  if (!UUID_RE.test(params.id)) return jsonNoStore({ error: 'not_found' }, 404);
  try {
    const domain = await readDomain(env, jwt, params.id);
    if (!domain || !(await isAdmin(env, jwt, domain.workspace_id))) return jsonNoStore({ error: 'not_found' }, 404);
    const missing = mailoutMissing(domain.provider, env);
    if (missing.length) return notConfigured(new MailoutNotConfiguredError(missing));
    const status = await sendingProvider(domain.provider, env).checkDomain({
      domain: domain.domain,
      mailFromSubdomain: domain.mail_from_subdomain,
      tenantName: domain.tenant_name,
      configurationSet: domain.configuration_set,
    });
    await recordDomainStatus(env, domain.id, status);
    return jsonNoStore({ item: await readDomain(env, jwt, domain.id) });
  } catch (err) {
    if (err instanceof MailoutNotConfiguredError) return notConfigured(err);
    return pgErrorResponse(
      err,
      { route: 'POST /api/mailout/domains/[id]/check', requestId: locals.requestId },
      { codes: DOMAIN_PG_CODES },
    );
  }
};
