/**
 * Los registros DNS de un dominio de envío (plan § 5, «Alta de un dominio»):
 *   · DKIM: los 3 CNAME de Easy DKIM, `<token>._domainkey.<dominio>` →
 *     `<token>.dkim.amazonses.com`;
 *   · MAIL FROM en `bounce.<dominio>`: un MX hacia
 *     `feedback-smtp.<región>.amazonses.com` y su SPF. El SPF del dominio raíz
 *     no se toca (suele ser el de Google Workspace);
 *   · DMARC: `v=DMARC1; p=none;` sugerido solo si el dominio no tiene uno.
 * Los mismos para el simulador y para SES: lo único que cambia es de dónde
 * salen los tokens de DKIM.
 */

import type { DnsRecord } from '$lib/mailout';

export const SUGGESTED_DMARC = 'v=DMARC1; p=none;';
const MAIL_FROM_SPF = '"v=spf1 include:amazonses.com ~all"';

interface DomainRecordsInput {
  domain: string;
  mailFromSubdomain: string;
  region: string;
  dkimTokens: string[];
  /** Lo leído en `_dmarc.<dominio>`; con uno, no se sugiere otro. */
  dmarcRecord?: string | null;
}

export function buildDomainRecords(input: DomainRecordsInput): DnsRecord[] {
  const domain = input.domain.toLowerCase();
  const mailFrom = `${input.mailFromSubdomain}.${domain}`;
  const records: DnsRecord[] = input.dkimTokens.map((token) => ({
    type: 'CNAME',
    name: `${token}._domainkey.${domain}`,
    value: `${token}.dkim.amazonses.com`,
    purpose: 'dkim',
  }));
  records.push(
    {
      type: 'MX',
      name: mailFrom,
      value: `feedback-smtp.${input.region}.amazonses.com`,
      priority: 10,
      purpose: 'mail_from',
    },
    { type: 'TXT', name: mailFrom, value: MAIL_FROM_SPF, purpose: 'mail_from' },
  );
  if (!input.dmarcRecord) {
    records.push({ type: 'TXT', name: `_dmarc.${domain}`, value: SUGGESTED_DMARC, purpose: 'dmarc', suggested: true });
  }
  return records;
}

/**
 * Tokens de DKIM deterministas a partir del dominio: los del simulador. Son
 * de mentira (nadie los publica) pero tienen la forma de los de SES: 32
 * caracteres en minúscula.
 */
export async function simulatedDkimTokens(domain: string): Promise<string[]> {
  const bytes = new Uint8Array(
    await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`hour-simulator:${domain.toLowerCase()}`)),
  );
  // 32 bytes → 64 hex; se estira con un segundo hash para tres tokens de 32.
  const more = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  const hex = [...bytes, ...more].map((b) => b.toString(16).padStart(2, '0')).join('');
  // Base 32 en minúscula como SES: se traduce cada hex a [a-z2-7].
  const alphabet = 'abcdefghijklmnopqrstuvwxyz234567';
  const b32 = [...hex].map((c, i) => alphabet[(parseInt(c, 16) * 2 + (i % 2)) % 32]).join('');
  return [b32.slice(0, 32), b32.slice(32, 64), b32.slice(64, 96)];
}
