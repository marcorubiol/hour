/**
 * El adaptador simulado (ADR-111): la misma interfaz que el de SES, sin enviar
 * nada ni llamar a nadie.
 *   · `registerDomain`: DKIM y MAIL FROM en PENDING, con los registros que
 *     pediría SES y tokens de DKIM deterministas (records.ts).
 *   · `checkDomain`: los dos en SUCCESS, como si el DNS ya estuviera
 *     publicado. No lee DNS: el dominio puede no existir.
 *   · `sendEmail`: no envía nada. Devuelve un id y un Message-ID inventados
 *     y los eventos que daría el simulador de SES según el destinatario:
 *     `bounce@` y `suppressionlist@simulator.amazonses.com` rebotan,
 *     `complaint@` se entrega y se marca como spam; cualquier otra dirección
 *     se entrega. Ninguna dirección real recibe nada.
 */

import { buildDomainRecords, simulatedDkimTokens } from './records';
import type { DomainIdentity, DomainStatus, OutgoingEmail, ProviderEvent, SendingProvider, SentEmail } from './provider';

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

/** Los eventos del simulador de SES, por la parte local de la dirección. */
export function simulatedEvents(to: string): ProviderEvent[] {
  const [local, domain] = to.toLowerCase().split('@');
  if (domain === 'simulator.amazonses.com') {
    const kind = local.split('+')[0];
    if (kind === 'bounce' || kind === 'suppressionlist') return [{ type: 'bounce', bounceType: 'Permanent' }];
    if (kind === 'complaint') return [{ type: 'delivery' }, { type: 'complaint' }];
  }
  return [{ type: 'delivery' }];
}

async function send(email: OutgoingEmail): Promise<SentEmail> {
  const id = `sim-${crypto.randomUUID()}`;
  return { providerMessageId: id, rfcMessageId: `<${id}@mailout.simulator.invalid>`, events: simulatedEvents(email.to) };
}

export function simulatorProvider(): SendingProvider {
  return {
    kind: 'simulator',
    registerDomain: (identity) => status(identity, false),
    checkDomain: (identity) => status(identity, true),
    sendEmail: send,
  };
}
