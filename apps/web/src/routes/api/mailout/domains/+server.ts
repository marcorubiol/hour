/**
 * Dominios de envío de un espacio (envío en bloque, fase 2; plan § 5).
 *
 * GET ?workspace_id=… → MailDomainsResponse: los dominios (RLS: miembros del
 *     espacio), si quien llama los gestiona (admin), con qué adaptador se dan
 *     de alta los nuevos y si el Worker está configurado para ello.
 * POST { workspace_id, domain, from_local_part?, from_name? } → el dominio
 *     dado de alta: `add_mail_domain` con el JWT (solo admin), después el
 *     adaptador da los registros DNS y su estado se escribe como service_role.
 *     Si el adaptador falla, el alta se deshace.
 */

import type { RequestHandler } from './$types';
import * as v from 'valibot';
import { extractAccessToken } from '$lib/auth';
import { pgGet, pgPostRpc, type SupabaseEnv } from '$lib/supabase';
import { pgErrorResponse } from '$lib/server/errors';
import { jsonNoStore, UUID_RE } from '$lib/server/http';
import {
  defaultProviderKind,
  mailoutMissing,
  MailoutNotConfiguredError,
  recordDomainStatus,
  sendingProvider,
  type MailoutEnv,
} from '$lib/server/mailout';
import { DOMAIN_PG_CODES, isAdmin, notConfigured, readDomain } from '$lib/server/mailout/http';
import { MAIL_DOMAIN_SELECT, MailDomainCreateSchema, type MailDomainItem, type MailDomainsResponse } from '$lib/mailout';

export const GET: RequestHandler = async ({ request, url, platform, locals }) => {
  if (!platform?.env) return jsonNoStore({ error: 'platform_unavailable' }, 500);
  const env = platform.env as unknown as MailoutEnv;
  const jwt = extractAccessToken(request);
  if (!jwt) return jsonNoStore({ error: 'missing_authorization' }, 401);
  const workspaceId = url.searchParams.get('workspace_id') ?? '';
  if (!UUID_RE.test(workspaceId)) return jsonNoStore({ error: 'invalid_workspace' }, 400);
  try {
    const [domains, admin, ws] = await Promise.all([
      pgGet<MailDomainItem>(env, 'mail_domain', jwt, {
        search: { select: MAIL_DOMAIN_SELECT, workspace_id: `eq.${workspaceId}`, order: 'created_at.asc' },
      }),
      isAdmin(env, jwt, workspaceId),
      pgGet<{ name: string }>(env, 'workspace', jwt, { search: { select: 'name', id: `eq.${workspaceId}` } }),
    ]);
    if (!ws.data[0]) return jsonNoStore({ error: 'not_found' }, 404);
    const mode = defaultProviderKind(env);
    return jsonNoStore({
      items: domains.data,
      can_manage: admin,
      mode,
      configured: mailoutMissing(mode, env).length === 0,
      workspace_name: ws.data[0].name,
    } satisfies MailDomainsResponse);
  } catch (err) {
    return pgErrorResponse(err, { route: 'GET /api/mailout/domains', requestId: locals.requestId });
  }
};

export const POST: RequestHandler = async ({ request, platform, locals }) => {
  if (!platform?.env) return jsonNoStore({ error: 'platform_unavailable' }, 500);
  const env = platform.env as unknown as MailoutEnv;
  const jwt = extractAccessToken(request);
  if (!jwt) return jsonNoStore({ error: 'missing_authorization' }, 401);
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return jsonNoStore({ error: 'invalid_body' }, 400);
  }
  const parsed = v.safeParse(MailDomainCreateSchema, raw);
  if (!parsed.success) return jsonNoStore({ error: 'invalid_body' }, 400);
  const body = parsed.output;

  const kind = defaultProviderKind(env);
  const missing = mailoutMissing(kind, env);
  if (missing.length) return notConfigured(new MailoutNotConfiguredError(missing));

  let created: MailDomainItem | undefined;
  try {
    const res = await pgPostRpc<MailDomainItem>(env as SupabaseEnv, 'add_mail_domain', jwt, {
      p_workspace_id: body.workspace_id,
      p_domain: body.domain,
      p_provider: kind,
      p_from_local_part: body.from_local_part,
      p_from_name: body.from_name ?? null,
    });
    created = res.data[0];
    if (!created) return jsonNoStore({ error: 'not_found' }, 404);
    const provider = sendingProvider(kind, env);
    const status = await provider.registerDomain({
      domain: created.domain,
      mailFromSubdomain: created.mail_from_subdomain,
      tenantName: created.tenant_name,
      configurationSet: created.configuration_set,
    });
    await recordDomainStatus(env, created.id, status);
    const fresh = await readDomain(env, jwt, created.id);
    return jsonNoStore({ item: fresh }, 201);
  } catch (err) {
    // El alta en la base sin su identidad en el servicio no sirve: se deshace.
    if (created) {
      await pgPostRpc(env as SupabaseEnv, 'remove_mail_domain', jwt, { p_id: created.id }).catch(() => undefined);
    }
    if (err instanceof MailoutNotConfiguredError) return notConfigured(err);
    return pgErrorResponse(
      err,
      { route: 'POST /api/mailout/domains', requestId: locals.requestId },
      { codes: DOMAIN_PG_CODES },
    );
  }
};
