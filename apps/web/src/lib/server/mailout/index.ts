/**
 * Elegir adaptador y hablar con la base sin persona detrás.
 *
 * `MAILOUT_PROVIDER` (var de Wrangler) dice con qué se dan de alta los
 * dominios nuevos: `ses` solo cuando haya cuenta; cualquier otro valor, o
 * ninguno, es el simulador (ADR-111). Un dominio que ya existe se comprueba con
 * el suyo.
 *
 * Frontera (ADR-110, architecture.md § seguridad): la clave de servicio solo
 * llama a la RPC `mail_domain_record_status`; el resto va con el JWT de la
 * persona.
 */

import type { MailSendingProvider } from '$lib/mailout';
import { MailoutNotConfiguredError, type DomainStatus, type SendingProvider } from './provider';
import { simulatorProvider } from './simulator';
import { sesMissing, sesProvider, type SesEnv } from './ses';

export interface MailoutEnv extends SesEnv {
  PUBLIC_SUPABASE_URL: string;
  PUBLIC_SUPABASE_ANON_KEY: string;
  SUPABASE_SERVICE_ROLE_KEY?: string;
  MAILOUT_PROVIDER?: string;
}

export function defaultProviderKind(env: Partial<MailoutEnv> | null | undefined): MailSendingProvider {
  return env?.MAILOUT_PROVIDER === 'ses' ? 'ses' : 'simulator';
}

export function sendingProvider(kind: MailSendingProvider, env: Partial<MailoutEnv> | null | undefined): SendingProvider {
  return kind === 'ses' ? sesProvider(env) : simulatorProvider();
}

/** Lo que falta para dar de alta y comprobar dominios con este adaptador. */
export function mailoutMissing(kind: MailSendingProvider, env: Partial<MailoutEnv> | null | undefined): string[] {
  const missing = env?.SUPABASE_SERVICE_ROLE_KEY ? [] : ['SUPABASE_SERVICE_ROLE_KEY'];
  return kind === 'ses' ? [...missing, ...sesMissing(env)] : missing;
}

export class MailoutDbError extends Error {
  constructor(
    public readonly status: number,
    public readonly body: string,
  ) {
    super(`mailout db ${status}: ${body.slice(0, 200)}`);
  }
}

/** Escribe el estado de un dominio como service_role. */
export async function recordDomainStatus(
  env: Partial<MailoutEnv>,
  domainId: string,
  s: DomainStatus,
  fetchFn: typeof fetch = fetch,
): Promise<void> {
  const key = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key || !env.PUBLIC_SUPABASE_URL) throw new MailoutNotConfiguredError(['SUPABASE_SERVICE_ROLE_KEY']);
  // Las claves nuevas (`sb_secret_…`) van solo en `apikey`; la legada es un JWT
  // y va también como Bearer (como mail/db.ts).
  const res = await fetchFn(new URL('/rest/v1/rpc/mail_domain_record_status', env.PUBLIC_SUPABASE_URL).toString(), {
    method: 'POST',
    headers: {
      apikey: key,
      'content-type': 'application/json',
      accept: 'application/json',
      ...(key.startsWith('eyJ') ? { authorization: `Bearer ${key}` } : {}),
    },
    body: JSON.stringify({
      p_id: domainId,
      p_dkim_status: s.dkimStatus,
      p_mail_from_status: s.mailFromStatus,
      p_dns_records: s.records,
      p_dmarc_record: s.dmarcRecord,
      p_error: s.error,
    }),
  });
  if (!res.ok) throw new MailoutDbError(res.status, await res.text());
}

export { MailoutNotConfiguredError };
