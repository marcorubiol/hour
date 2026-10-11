/**
 * La capa de proveedor del buzón sincronizado (ADR-099).
 *
 * La sincronización (sync.ts) y el envío solo hablan con `MailAdapter`; cada
 * proveedor es un adaptador. Hoy existe Google (gmail.ts). Microsoft Graph será
 * otro fichero que implemente esta misma interfaz, más su valor en el enum
 * `mail_provider` y sus rutas OAuth: el emparejado, la idempotencia y el
 * registro no cambian.
 *
 * Contrato de minimización que todo adaptador cumple: `search` devuelve SOLO
 * mensajes en los que aparece alguna de las direcciones dadas (filtrado del
 * lado del proveedor) y `fetchMessage` solo se llama para esos.
 */

export type MailProvider = 'google';

export interface ProviderTokens {
  accessToken: string;
  refreshToken: string | null;
  scope: string;
}

/** Un correo, ya parseado y en la forma neutra. */
export interface MailMessage {
  providerMessageId: string;
  providerThreadId: string | null;
  /** Cabecera Message-ID: la misma en todos los buzones que lo tienen. */
  rfcMessageId: string | null;
  subject: string | null;
  fromHeader: string;
  from: string[];
  to: string[];
  cc: string[];
  occurredAt: string;
  /** Texto plano, sin la cita del correo anterior, recortado a 20 000. */
  body: string;
  isDraft: boolean;
}

export interface OutgoingMail {
  from: string;
  to: string;
  toName?: string | null;
  subject: string;
  body: string;
  messageId: string;
  inReplyTo?: string | null;
  references?: string | null;
  threadId?: string | null;
}

export interface MailAdapter {
  provider: MailProvider;
  /** Cambia el refresh token por uno de acceso; ProviderAuthError si se revocó. */
  accessToken(refreshToken: string): Promise<string>;
  /** Dirección del buzón y cursor actual. */
  profile(accessToken: string): Promise<{ address: string; cursor: string }>;
  /** ¿Hubo correo nuevo desde el cursor? `expired`: el cursor ya no vale. */
  changesSince(
    accessToken: string,
    cursor: string,
  ): Promise<{ cursor: string | null; changed: boolean; expired: boolean }>;
  /** Ids de mensajes con estas direcciones desde `afterEpochSec`, hasta `max`. */
  search(
    accessToken: string,
    addresses: string[],
    afterEpochSec: number | null,
    max: number,
  ): Promise<{ ids: string[]; truncated: boolean }>;
  fetchMessage(accessToken: string, id: string): Promise<MailMessage>;
  send(
    accessToken: string,
    msg: OutgoingMail,
  ): Promise<{ providerMessageId: string; providerThreadId: string | null }>;
  revoke(token: string): Promise<boolean>;
}

/**
 * El emparejado (ADR-099 punto 3): qué contactos de Hour aparecen en un
 * correo y en qué sentido va. Coincidencia exacta de dirección, sin mayúsculas.
 *
 *  · Lo envió el buzón (From es el buzón) → `outbound`; los contactos son los
 *    destinatarios (To y Cc) que están en Hour.
 *  · Lo envió otro → `inbound` si el remitente es un contacto de Hour; si el
 *    remitente no lo es (alguien que pone en copia a un contacto), no entra:
 *    no es una conversación con ese contacto.
 *  · Un borrador no entra.
 *
 * Devuelve null cuando el correo no toca ninguna conversación.
 */
export function matchMessage(
  msg: Pick<MailMessage, 'from' | 'to' | 'cc' | 'isDraft'>,
  mailboxAddress: string,
  contacts: ReadonlySet<string>,
): { direction: 'inbound' | 'outbound'; counterparts: string[] } | null {
  if (msg.isDraft) return null;
  const me = mailboxAddress.trim().toLowerCase();
  const from = msg.from.map((a) => a.toLowerCase());
  if (from.includes(me)) {
    const counterparts = [...new Set([...msg.to, ...msg.cc].map((a) => a.toLowerCase()))].filter(
      (a) => a !== me && contacts.has(a),
    );
    return counterparts.length ? { direction: 'outbound', counterparts } : null;
  }
  const counterparts = from.filter((a) => contacts.has(a));
  return counterparts.length ? { direction: 'inbound', counterparts } : null;
}
