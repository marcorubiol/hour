/**
 * El adaptador simulado (ADR-111): la misma interfaz que el de SES, sin enviar
 * nada ni llamar a nadie.
 *   · `registerDomain`: DKIM y MAIL FROM en PENDING, con los registros que
 *     pediría SES y tokens de DKIM deterministas (records.ts).
 *   · `checkDomain`: los dos en SUCCESS, como si el DNS ya estuviera
 *     publicado. No lee DNS: el dominio puede no existir.
 */

import { buildDomainRecords, simulatedDkimTokens } from './records';
import type { DomainIdentity, DomainStatus, SendingProvider } from './provider';

/** La región que se enseña en el MX del simulador: la que usará SES (plan § 5). */
export const SIMULATOR_REGION = 'eu-central-1';

async function status(identity: DomainIdentity, verified: boolean): Promise<DomainStatus> {
  const records = buildDomainRecords({
    domain: identity.domain,
    mailFromSubdomain: identity.mailFromSubdomain,
    region: SIMULATOR_REGION,
    dkimTokens: await simulatedDkimTokens(identity.domain),
  });
  return {
    dkimStatus: verified ? 'SUCCESS' : 'PENDING',
    mailFromStatus: verified ? 'SUCCESS' : 'PENDING',
    records,
    dmarcRecord: null,
    error: null,
  };
}

export function simulatorProvider(): SendingProvider {
  return {
    kind: 'simulator',
    registerDomain: (identity) => status(identity, false),
    checkDomain: (identity) => status(identity, true),
  };
}
