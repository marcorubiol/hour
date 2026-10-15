/**
 * Elegir adaptador y hablar con la base sin persona detrás.
 *
 * `MAILOUT_PROVIDER` (var de Wrangler) dice con qué se dan de alta los
 * dominios nuevos: `ses` solo cuando haya cuenta; cualquier otro valor, o
 * ninguno, es el simulador (ADR-111). Un dominio que ya existe se comprueba con
 * el suyo.
 *
 * Frontera (ADR-110, architecture.md § seguridad): la clave de servicio solo
 * llama a las RPC de máquina de db.ts; el resto va con el JWT de la persona.
 */

import type { MailSendingProvider } from '$lib/mailout';
import { MailoutNotConfiguredError, type DomainStatus, type SendingProvider } from './provider';
import { simulatorProvider } from './simulator';
import { sesMissing, sesProvider, type SesEnv } from './ses';
import { serviceRpc } from './db';

export interface MailoutEnv extends SesEnv {
  PUBLIC_SUPABASE_URL: string;
  PUBLIC_SUPABASE_ANON_KEY: string;
  SUPABASE_SERVICE_ROLE_KEY?: string;
  MAILOUT_PROVIDER?: string;
  /** Solo en local (`.dev.vars`): el origen de los enlaces de baja. */
  MAILOUT_LINK_ORIGIN?: string;
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

/** Escribe el estado de un dominio como service_role. */
export async function recordDomainStatus(
  env: Partial<MailoutEnv>,
  domainId: string,
  s: DomainStatus,
  fetchFn: typeof fetch = fetch,
): Promise<void> {
  await serviceRpc(
    env,
    'mail_domain_record_status',
    {
      p_id: domainId,
      p_dkim_status: s.dkimStatus,
      p_mail_from_status: s.mailFromStatus,
      p_dns_records: s.records,
      p_dmarc_record: s.dmarcRecord,
      p_error: s.error,
    },
    fetchFn,
  );
}

/** El origen de los enlaces de baja: el de producción, salvo en local. */
export function mailoutLinkOrigin(env: Partial<MailoutEnv> | null | undefined): string {
  return env?.MAILOUT_LINK_ORIGIN || 'https://hour.zerosense.studio';
}

export { MailoutNotConfiguredError };
export { MailoutDbError } from './db';
