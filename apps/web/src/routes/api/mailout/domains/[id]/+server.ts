/**
 * Un dominio de envío.
 *
 * PATCH { from_local_part, from_name? } → el remitente por defecto
 *     (`set_mail_domain_sender`, admin).
 * DELETE → `remove_mail_domain` (admin; no si un envío en marcha sale de él).
 * A quien no lo gestiona, 404 sin confirmar que existe.
 */

import type { RequestHandler } from './$types';
import * as v from 'valibot';
import { extractAccessToken } from '$lib/auth';
import { pgPostRpc, type SupabaseEnv } from '$lib/supabase';
import { pgErrorResponse } from '$lib/server/errors';
import { json, UUID_RE } from '$lib/server/mail/http';
import { DOMAIN_PG_CODES, readDomain } from '$lib/server/mailout/http';
import { MailDomainSenderSchema } from '$lib/mailout';

export const PATCH: RequestHandler = async ({ request, params, platform, locals }) => {
  if (!platform?.env) return json({ error: 'platform_unavailable' }, 500);
  const env = platform.env as unknown as SupabaseEnv;
  const jwt = extractAccessToken(request);
  if (!jwt) return json({ error: 'missing_authorization' }, 401);
  if (!UUID_RE.test(params.id)) return json({ error: 'not_found' }, 404);
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return json({ error: 'invalid_body' }, 400);
  }
  const parsed = v.safeParse(MailDomainSenderSchema, raw);
  if (!parsed.success) return json({ error: 'invalid_body' }, 400);
  try {
    await pgPostRpc(env, 'set_mail_domain_sender', jwt, {
      p_id: params.id,
      p_from_local_part: parsed.output.from_local_part,
      p_from_name: parsed.output.from_name ?? null,
    });
    return json({ item: await readDomain(env, jwt, params.id) });
  } catch (err) {
    return pgErrorResponse(
      err,
      { route: 'PATCH /api/mailout/domains/[id]', requestId: locals.requestId },
      { codes: DOMAIN_PG_CODES },
    );
  }
};

export const DELETE: RequestHandler = async ({ request, params, platform, locals }) => {
  if (!platform?.env) return json({ error: 'platform_unavailable' }, 500);
  const env = platform.env as unknown as SupabaseEnv;
  const jwt = extractAccessToken(request);
  if (!jwt) return json({ error: 'missing_authorization' }, 401);
  if (!UUID_RE.test(params.id)) return json({ error: 'not_found' }, 404);
  try {
    await pgPostRpc(env, 'remove_mail_domain', jwt, { p_id: params.id });
    return json({ ok: true });
  } catch (err) {
    return pgErrorResponse(
      err,
      { route: 'DELETE /api/mailout/domains/[id]', requestId: locals.requestId },
      { codes: DOMAIN_PG_CODES },
    );
  }
};
