/** Piezas comunes de las rutas /api/mailout/domains/*. */

import { pgGet, pgPostRpc, type SupabaseEnv } from '$lib/supabase';
import { MAIL_DOMAIN_SELECT, type MailDomainItem } from '$lib/mailout';
import { jsonNoStore } from '$lib/server/http';
import { MailoutNotConfiguredError } from './provider';

/** Lo que dice la base, traducido para la pantalla. 42501 es «no existe». */
export const DOMAIN_PG_CODES = {
  '42501': { status: 404, error: 'not_found' },
  '22023': { status: 400, error: 'invalid' },
  '23505': { status: 409, error: 'domain_taken' },
  '23503': { status: 409, error: 'domain_in_use' },
  '23514': { status: 400, error: 'invalid' },
} as const;

/** El dominio con la RLS de quien llama; null si no lo ve. */
export async function readDomain(env: SupabaseEnv, jwt: string, id: string): Promise<MailDomainItem | null> {
  const { data } = await pgGet<MailDomainItem>(env, 'mail_domain', jwt, {
    search: { select: MAIL_DOMAIN_SELECT, id: `eq.${id}` },
  });
  return data[0] ?? null;
}

export async function isAdmin(env: SupabaseEnv, jwt: string, workspaceId: string): Promise<boolean> {
  const r = await pgPostRpc<boolean>(env, 'is_workspace_admin', jwt, { ws_id: workspaceId });
  return r.data[0] === true;
}

export function notConfigured(err: MailoutNotConfiguredError): Response {
  console.error(JSON.stringify({ level: 'error', kind: 'mailout_not_configured', missing: err.missing }));
  return jsonNoStore({ error: 'mailout_not_configured' }, 503);
}
