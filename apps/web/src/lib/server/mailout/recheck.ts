/**
 * El cron de 10 minutos vuelve a comprobar el DNS de los dominios de envío que
 * esperan verificación (ADR-169, punto 45): la persona deja los registros en
 * su DNS y no tiene que volver a pulsar «Comprobar». Mismo camino que
 * `POST /api/mailout/domains/[id]/check`: el adaptador del dominio lee la
 * identidad y `recordDomainStatus` la guarda.
 *
 * Solo las primeras 72 h desde el alta (lo que SES espera a un DNS antes de
 * dar la identidad por fallida); después la pantalla sigue ofreciendo
 * «Comprobar». Solo dominios de un servicio real: el simulador no tiene DNS
 * que esperar, y comprobarlo lo da por verificado.
 *
 * La lista sale de una RPC de máquina (`mail_domain_pending_checks`), como
 * todo lo que hace la clave de servicio (ADR-110): ninguna tabla. Mientras la
 * RPC no exista en la base, la pasada no hace nada y lo dice en el log. Un
 * dominio que falla no corta los demás.
 */

import type { MailSendingProvider } from '../../mailout';
import { MailoutDbError, serviceRpc } from './db';
import type { DomainStatus } from './provider';
import { mailoutMissing, recordDomainStatus, sendingProvider, type MailoutEnv } from './index';

export const RECHECK_WINDOW_MS = 72 * 3_600_000;

/** Lo que la RPC devuelve de cada dominio sin verificar. */
export interface PendingDomainRow {
  id: string;
  provider: MailSendingProvider;
  domain: string;
  mail_from_subdomain: string;
  tenant_name: string | null;
  configuration_set: string | null;
  dkim_status: string;
  mail_from_status: string;
  verified_at: string | null;
  created_at: string;
}

/** Los que esta pasada comprueba: sin verificar, sin fallo, de un servicio real y de las últimas 72 h. */
export function domainsToRecheck(rows: PendingDomainRow[], now: Date): PendingDomainRow[] {
  return rows.filter((d) => {
    if (d.verified_at || d.provider === 'simulator') return false;
    if (d.dkim_status === 'FAILED' || d.mail_from_status === 'FAILED') return false;
    const age = now.getTime() - new Date(d.created_at).getTime();
    return age >= 0 && age < RECHECK_WINDOW_MS;
  });
}

export interface RecheckDeps {
  pending(): Promise<PendingDomainRow[]>;
  check(row: PendingDomainRow): Promise<DomainStatus>;
  record(id: string, status: DomainStatus): Promise<void>;
  now(): Date;
}

export interface RecheckResult {
  checked: number;
  verified: number;
  errors: { id: string; error: string }[];
}

export async function recheckDomains(deps: RecheckDeps): Promise<RecheckResult> {
  const due = domainsToRecheck(await deps.pending(), deps.now());
  const result: RecheckResult = { checked: 0, verified: 0, errors: [] };
  for (const row of due) {
    try {
      const status = await deps.check(row);
      await deps.record(row.id, status);
      result.checked += 1;
      if (status.dkimStatus === 'SUCCESS' && status.mailFromStatus === 'SUCCESS') result.verified += 1;
    } catch (err) {
      result.errors.push({ id: row.id, error: err instanceof Error ? err.message : String(err) });
    }
  }
  return result;
}

function liveDeps(env: MailoutEnv): RecheckDeps {
  return {
    pending: () =>
      serviceRpc<PendingDomainRow[]>(env, 'mail_domain_pending_checks', {}).then((rows) => rows ?? []),
    check: (row) => {
      const missing = mailoutMissing(row.provider, env);
      if (missing.length) throw new Error(`not configured: ${missing.join(',')}`);
      return sendingProvider(row.provider, env).checkDomain({
        domain: row.domain,
        mailFromSubdomain: row.mail_from_subdomain,
        tenantName: row.tenant_name,
        configurationSet: row.configuration_set,
      });
    },
    record: (id, status) => recordDomainStatus(env, id, status),
    now: () => new Date(),
  };
}

/** Una pasada del cron. Sin clave de servicio, o sin la RPC en la base, no hace nada. */
export async function runDomainRecheck(env: MailoutEnv, deps: RecheckDeps = liveDeps(env)): Promise<RecheckResult | null> {
  if (!env.SUPABASE_SERVICE_ROLE_KEY) return null;
  let result: RecheckResult;
  try {
    result = await recheckDomains(deps);
  } catch (err) {
    // PostgREST answers 404 for an RPC the database does not have yet.
    if (err instanceof MailoutDbError && err.status === 404) {
      console.log(JSON.stringify({ level: 'info', kind: 'mail_domain_recheck_unavailable' }));
      return null;
    }
    throw err;
  }
  if (result.checked || result.errors.length) {
    console.log(JSON.stringify({ level: 'info', kind: 'mail_domain_recheck', ...result }));
  }
  return result;
}
