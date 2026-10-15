/**
 * La base sin persona detrás, para el envío en bloque: la cola (cron y
 * primera pasada) y el estado de los dominios.
 *
 * Frontera (ADR-110, architecture.md § seguridad): la clave de servicio solo
 * llama a las RPC de esta lista, ninguna tabla. Lo que hace una persona sigue
 * yendo con su JWT y RLS.
 */

import { MailoutNotConfiguredError } from './provider';

export interface MailoutDbEnv {
  PUBLIC_SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE_KEY?: string;
}

const SERVICE_RPCS = [
  'mail_domain_record_status',
  'mailout_claim',
  'mailout_send_context',
  'mailout_record_sent',
  'mailout_record_failure',
  'mailout_record_event',
] as const;
export type MailoutServiceRpc = (typeof SERVICE_RPCS)[number];

export class MailoutDbError extends Error {
  constructor(
    public readonly status: number,
    public readonly body: string,
  ) {
    super(`mailout db ${status}: ${body.slice(0, 200)}`);
  }
}

/** Llama a una RPC de máquina como service_role y devuelve su JSON. */
export async function serviceRpc<T>(
  env: Partial<MailoutDbEnv>,
  name: MailoutServiceRpc,
  args: Record<string, unknown>,
  fetchFn: typeof fetch = fetch,
): Promise<T> {
  if (!SERVICE_RPCS.includes(name)) throw new Error(`not a mailout service rpc: ${name}`);
  const key = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key || !env.PUBLIC_SUPABASE_URL) throw new MailoutNotConfiguredError(['SUPABASE_SERVICE_ROLE_KEY']);
  // Las claves nuevas (`sb_secret_…`) van solo en `apikey`; la legada es un JWT
  // y va también como Bearer (como mail/db.ts).
  const res = await fetchFn(new URL(`/rest/v1/rpc/${name}`, env.PUBLIC_SUPABASE_URL).toString(), {
    method: 'POST',
    headers: {
      apikey: key,
      'content-type': 'application/json',
      accept: 'application/json',
      ...(key.startsWith('eyJ') ? { authorization: `Bearer ${key}` } : {}),
    },
    body: JSON.stringify(args),
  });
  const text = await res.text();
  if (!res.ok) throw new MailoutDbError(res.status, text);
  return (text ? JSON.parse(text) : null) as T;
}
