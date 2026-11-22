/**
 * Secretos de sincronización de calendarios en reposo (ADR-241): AES-256-GCM
 * con WebCrypto y clave propia `CALENDAR_TOKEN_KEY` en Wrangler.
 *
 * Solo imports relativos: lo empaqueta también el cron del Worker fuera de
 * SvelteKit (`src/worker-cron.ts`).
 */

const enc = new TextEncoder();
const dec = new TextDecoder();

export const CALENDAR_KEY_VERSION = 1;

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

class CalendarKeyError extends Error {}

export async function importCalendarKey(keyB64: string | undefined): Promise<CryptoKey> {
  if (!keyB64) throw new CalendarKeyError('CALENDAR_TOKEN_KEY is not set');
  let raw: Uint8Array;
  try {
    raw = fromBase64Url(keyB64.trim());
  } catch {
    throw new CalendarKeyError('CALENDAR_TOKEN_KEY is not base64');
  }
  if (raw.length !== 32) throw new CalendarKeyError('CALENDAR_TOKEN_KEY must be 32 bytes');
  return crypto.subtle.importKey('raw', raw as BufferSource, 'AES-GCM', false, ['encrypt', 'decrypt']);
}

export async function encryptCalendarSecret(key: CryptoKey, plain: string, aad: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: enc.encode(aad) },
    key,
    enc.encode(plain),
  );
  return `v${CALENDAR_KEY_VERSION}.${toBase64Url(iv)}.${toBase64Url(new Uint8Array(ct))}`;
}

export async function decryptCalendarSecret(key: CryptoKey, sealed: string, aad: string): Promise<string> {
  const m = /^v(\d+)\.([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]+)$/.exec(sealed);
  if (!m) throw new CalendarKeyError('malformed ciphertext');
  if (Number(m[1]) !== CALENDAR_KEY_VERSION) throw new CalendarKeyError('unknown key version');
  const pt = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: fromBase64Url(m[2]) as BufferSource, additionalData: enc.encode(aad) },
    key,
    fromBase64Url(m[3]) as BufferSource,
  );
  return dec.decode(pt);
}

export function calendarCredentialAad(userId: string, provider: string, accountEmail: string): string {
  return `hour-calendar:${userId}:${provider}:${accountEmail.trim().toLowerCase()}`;
}

export async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', enc.encode(value));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

export async function sealCalendarJson(key: CryptoKey, value: unknown, purpose: string): Promise<string> {
  return encryptCalendarSecret(key, JSON.stringify(value), `hour-calendar-seal:${purpose}`);
}

export async function openCalendarJson<T>(key: CryptoKey, sealed: string, purpose: string): Promise<T | null> {
  try {
    return JSON.parse(await decryptCalendarSecret(key, sealed, `hour-calendar-seal:${purpose}`)) as T;
  } catch {
    return null;
  }
}

export async function calendarPkcePair(): Promise<{ verifier: string; challenge: string }> {
  const verifier = toBase64Url(crypto.getRandomValues(new Uint8Array(32)));
  const digest = await crypto.subtle.digest('SHA-256', enc.encode(verifier));
  return { verifier, challenge: toBase64Url(new Uint8Array(digest)) };
}

export function randomCalendarToken(bytes = 24): string {
  return toBase64Url(crypto.getRandomValues(new Uint8Array(bytes)));
}
