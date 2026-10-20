/**
 * Secretos del correo en reposo (ADR-099): AES-256-GCM con WebCrypto.
 *
 * La clave es `MAIL_TOKEN_KEY` (32 bytes en base64), secreto de Wrangler: la
 * base guarda solo el texto cifrado y no puede descifrarlo. Formato
 * `v<versión>.<iv>.<cifrado>` en base64url; la versión permite rotar la clave
 * sin migrar (hoy solo existe la 1).
 *
 * El AAD ata el texto cifrado a su contexto (p. ej. el espacio y la dirección
 * del buzón): un cifrado copiado a otra fila no se descifra.
 *
 * Solo imports relativos: este módulo lo carga también el cron del Worker, que
 * se empaqueta fuera de SvelteKit (src/worker-cron.ts).
 */

const enc = new TextEncoder();
const dec = new TextDecoder();

export const MAIL_TOKEN_KEY_VERSION = 1;

export function toBase64Url(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(s: string): Uint8Array {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

class MailKeyError extends Error {}

/** Importa la clave; falla claro si no son 32 bytes. */
export async function importMailKey(keyB64: string | undefined): Promise<CryptoKey> {
  if (!keyB64) throw new MailKeyError('MAIL_TOKEN_KEY is not set');
  let raw: Uint8Array;
  try {
    raw = fromBase64Url(keyB64.trim());
  } catch {
    throw new MailKeyError('MAIL_TOKEN_KEY is not base64');
  }
  if (raw.length !== 32) throw new MailKeyError('MAIL_TOKEN_KEY must be 32 bytes');
  return crypto.subtle.importKey('raw', raw as BufferSource, 'AES-GCM', false, ['encrypt', 'decrypt']);
}

export async function encryptSecret(key: CryptoKey, plain: string, aad: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: enc.encode(aad) },
    key,
    enc.encode(plain),
  );
  return `v${MAIL_TOKEN_KEY_VERSION}.${toBase64Url(iv)}.${toBase64Url(new Uint8Array(ct))}`;
}

/** Descifra; cualquier manipulación (texto, iv, AAD, clave) lanza. */
export async function decryptSecret(key: CryptoKey, sealed: string, aad: string): Promise<string> {
  const m = /^v(\d+)\.([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]+)$/.exec(sealed);
  if (!m) throw new MailKeyError('malformed ciphertext');
  if (Number(m[1]) !== MAIL_TOKEN_KEY_VERSION) throw new MailKeyError('unknown key version');
  const pt = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: fromBase64Url(m[2]) as BufferSource, additionalData: enc.encode(aad) },
    key,
    fromBase64Url(m[3]) as BufferSource,
  );
  return dec.decode(pt);
}

/** El AAD de un refresh token: su espacio y su dirección. */
export function refreshTokenAad(workspaceId: string, address: string): string {
  return `hour-mail-refresh:${workspaceId}:${address.trim().toLowerCase()}`;
}

/** Sella un objeto (cookie del flujo OAuth) con caducidad. */
export async function sealJson(key: CryptoKey, value: unknown, purpose: string): Promise<string> {
  return encryptSecret(key, JSON.stringify(value), `hour-mail-seal:${purpose}`);
}

export async function openJson<T>(key: CryptoKey, sealed: string, purpose: string): Promise<T | null> {
  try {
    return JSON.parse(await decryptSecret(key, sealed, `hour-mail-seal:${purpose}`)) as T;
  } catch {
    return null;
  }
}

/** PKCE (RFC 7636): verificador aleatorio y su reto S256. */
export async function pkcePair(): Promise<{ verifier: string; challenge: string }> {
  const verifier = toBase64Url(crypto.getRandomValues(new Uint8Array(32)));
  const digest = await crypto.subtle.digest('SHA-256', enc.encode(verifier));
  return { verifier, challenge: toBase64Url(new Uint8Array(digest)) };
}

export function randomToken(bytes = 24): string {
  return toBase64Url(crypto.getRandomValues(new Uint8Array(bytes)));
}
