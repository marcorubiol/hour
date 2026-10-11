/**
 * Adaptador de Google (Gmail API) para el buzón sincronizado (ADR-099).
 *
 * Permisos (lo mínimo que sirve):
 *   · `gmail.readonly`: listar con búsqueda (`q`) y leer el cuerpo de los
 *     correos que coinciden. `gmail.metadata` sería menos, pero Google prohíbe
 *     `q` con ese permiso y no da cuerpos: obligaría a bajar las cabeceras de
 *     TODO el buzón para emparejar, que es justo lo que no queremos (punto 3).
 *   · `gmail.send`: enviar desde Hour por el buzón conectado.
 * Nada de `gmail.modify` ni `mail.google.com`: Hour no marca, no mueve, no borra.
 *
 * Minimización: Hour nunca lista el buzón entero. Pregunta a Gmail por las
 * direcciones de sus contactos (`q` con `{from: to: cc:}`) y solo baja el cuerpo
 * de lo que Gmail devuelve. El `historyId` sirve de detector de cambios y de
 * cursor; los ids de mensaje que trae no se abren.
 *
 * `fetch` se inyecta: los tests simulan Gmail sin red.
 */

import type { MailAdapter, MailMessage, ProviderTokens } from './provider';

export const GOOGLE_SCOPES = [
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/gmail.send',
] as const;

const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const REVOKE_URL = 'https://oauth2.googleapis.com/revoke';
const API = 'https://gmail.googleapis.com/gmail/v1/users/me';

export type Fetch = typeof fetch;

export class ProviderAuthError extends Error {
  /** El permiso se revocó o caducó: hay que volver a conectar. */
  constructor(message = 'invalid_grant') {
    super(message);
  }
}
export class CursorExpiredError extends Error {}
export class ProviderError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export function googleAuthUrl(opts: {
  clientId: string;
  redirectUri: string;
  state: string;
  codeChallenge: string;
  loginHint?: string;
}): string {
  const u = new URL(AUTH_URL);
  u.searchParams.set('client_id', opts.clientId);
  u.searchParams.set('redirect_uri', opts.redirectUri);
  u.searchParams.set('response_type', 'code');
  u.searchParams.set('scope', GOOGLE_SCOPES.join(' '));
  // offline + consent: Google solo da refresh token así.
  u.searchParams.set('access_type', 'offline');
  u.searchParams.set('prompt', 'consent');
  u.searchParams.set('include_granted_scopes', 'false');
  u.searchParams.set('state', opts.state);
  u.searchParams.set('code_challenge', opts.codeChallenge);
  u.searchParams.set('code_challenge_method', 'S256');
  if (opts.loginHint) u.searchParams.set('login_hint', opts.loginHint);
  return u.toString();
}

/** Los permisos concedidos cubren los dos que pedimos (Google deja desmarcarlos). */
export function hasRequiredScopes(granted: string | undefined): boolean {
  const set = new Set((granted ?? '').split(/\s+/).filter(Boolean));
  return GOOGLE_SCOPES.every((s) => set.has(s));
}

async function readError(res: Response): Promise<string> {
  const text = await res.text().catch(() => '');
  try {
    const j = JSON.parse(text) as { error?: string | { message?: string; status?: string } };
    if (typeof j.error === 'string') return j.error;
    return j.error?.status ?? j.error?.message ?? `http_${res.status}`;
  } catch {
    return `http_${res.status}`;
  }
}

export async function exchangeGoogleCode(
  fetchFn: Fetch,
  opts: { clientId: string; clientSecret: string; code: string; redirectUri: string; verifier: string },
): Promise<ProviderTokens> {
  const res = await fetchFn(TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: opts.clientId,
      client_secret: opts.clientSecret,
      code: opts.code,
      code_verifier: opts.verifier,
      grant_type: 'authorization_code',
      redirect_uri: opts.redirectUri,
    }),
  });
  if (!res.ok) throw new ProviderError(res.status, await readError(res));
  const j = (await res.json()) as { access_token?: string; refresh_token?: string; scope?: string };
  if (!j.access_token) throw new ProviderError(502, 'no_access_token');
  return { accessToken: j.access_token, refreshToken: j.refresh_token ?? null, scope: j.scope ?? '' };
}

export async function refreshGoogleToken(
  fetchFn: Fetch,
  opts: { clientId: string; clientSecret: string; refreshToken: string },
): Promise<string> {
  const res = await fetchFn(TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: opts.clientId,
      client_secret: opts.clientSecret,
      refresh_token: opts.refreshToken,
      grant_type: 'refresh_token',
    }),
  });
  if (res.status === 400 || res.status === 401) {
    const err = await readError(res);
    if (err === 'invalid_grant' || err === 'unauthorized_client') throw new ProviderAuthError(err);
    throw new ProviderError(res.status, err);
  }
  if (!res.ok) throw new ProviderError(res.status, await readError(res));
  const j = (await res.json()) as { access_token?: string };
  if (!j.access_token) throw new ProviderError(502, 'no_access_token');
  return j.access_token;
}

/** Revoca el permiso en Google (al desconectar). Mejor esfuerzo. */
export async function revokeGoogleToken(fetchFn: Fetch, token: string): Promise<boolean> {
  try {
    const res = await fetchFn(REVOKE_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ token }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

// ── Direcciones y cabeceras ───────────────────────────────────────────────

const ADDRESS = /[A-Za-z0-9._%+'!#$&*=?^`{|}~/-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+/g;

/**
 * Las direcciones de una cabecera From/To/Cc, en minúscula y sin repetir.
 * Tolera nombres con comas entre comillas y la forma `Nombre <dir>`.
 */
export function parseAddressList(header: string | null | undefined): string[] {
  if (!header) return [];
  const out = new Set<string>();
  // Primero lo que va entre <>; si no hay, las direcciones sueltas.
  const angled = [...header.matchAll(/<([^<>\s]+@[^<>\s]+)>/g)].map((m) => m[1]);
  const stripped = header.replace(/"[^"]*"/g, ' ').replace(/<[^<>]*>/g, ' ');
  for (const a of angled) out.add(a.toLowerCase());
  for (const m of stripped.matchAll(ADDRESS)) out.add(m[0].toLowerCase());
  return [...out];
}

/** Decodifica una cabecera con palabras codificadas RFC 2047 (=?utf-8?B?...?=). */
export function decodeMimeWords(value: string): string {
  // Dos palabras codificadas seguidas se unen sin el espacio de en medio.
  const joined = value.replace(/(\?=)\s+(=\?)/g, '$1$2');
  return joined.replace(/=\?([^?]+)\?([BbQq])\?([^?]*)\?=/g, (_m, charset: string, enc: string, text: string) => {
    try {
      let bytes: Uint8Array;
      if (enc.toUpperCase() === 'B') {
        const bin = atob(text);
        bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
      } else {
        const s = text.replace(/_/g, ' ').replace(/=([0-9A-Fa-f]{2})/g, (_x, h: string) =>
          String.fromCharCode(parseInt(h, 16)),
        );
        bytes = Uint8Array.from(s, (c) => c.charCodeAt(0));
      }
      return new TextDecoder(charset.toLowerCase()).decode(bytes);
    } catch {
      return text;
    }
  });
}

interface GmailHeader {
  name: string;
  value: string;
}
interface GmailPart {
  mimeType?: string;
  filename?: string;
  headers?: GmailHeader[];
  body?: { data?: string; size?: number; attachmentId?: string };
  parts?: GmailPart[];
}
export interface GmailRawMessage {
  id: string;
  threadId?: string;
  internalDate?: string;
  labelIds?: string[];
  payload?: GmailPart;
}

function header(part: GmailPart | undefined, name: string): string | null {
  const h = part?.headers?.find((x) => x.name.toLowerCase() === name.toLowerCase());
  return h ? h.value : null;
}

function decodeBody(data: string): string {
  const b64 = data.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
  return new TextDecoder('utf-8').decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
}

function findPart(part: GmailPart | undefined, mime: string): GmailPart | null {
  if (!part) return null;
  if (part.mimeType === mime && part.body?.data && !part.filename) return part;
  for (const p of part.parts ?? []) {
    const hit = findPart(p, mime);
    if (hit) return hit;
  }
  return null;
}

/** Un HTML a texto, lo justo para un registro (sin estilos ni scripts). */
export function htmlToText(html: string): string {
  return html
    .replace(/<(style|script|head)[^>]*>[\s\S]*?<\/\1>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|tr|h[1-6])>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Corta la cita del correo anterior: el registro ya tiene ese correo. Para en
 * la primera línea de cita ("> …") o en la entradilla típica de un cliente
 * ("On … wrote:", "El … escribió:", "Le … a écrit :", "-----Original Message-----").
 */
export function trimQuoted(text: string): string {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const intro =
    /^(On .+ wrote:|El .+ escribió:|El .+ va escriure:|Le .+ a écrit ?:|-{2,} ?(Original Message|Mensaje original|Missatge original|Message d'origine) ?-{2,})$/i;
  let cut = lines.length;
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i].trim();
    if (l.startsWith('>') || intro.test(l)) {
      cut = i;
      break;
    }
  }
  return lines.slice(0, cut).join('\n').trim();
}

/** El correo de Gmail en la forma neutra del proveedor. */
export function parseGmailMessage(raw: GmailRawMessage): MailMessage {
  const p = raw.payload;
  const plain = findPart(p, 'text/plain');
  const html = plain ? null : findPart(p, 'text/html');
  let body = '';
  if (plain?.body?.data) body = decodeBody(plain.body.data);
  else if (html?.body?.data) body = htmlToText(decodeBody(html.body.data));
  const dateMs = raw.internalDate ? Number(raw.internalDate) : Date.parse(header(p, 'Date') ?? '');
  return {
    providerMessageId: raw.id,
    providerThreadId: raw.threadId ?? null,
    rfcMessageId: header(p, 'Message-ID') ?? header(p, 'Message-Id'),
    subject: decodeMimeWords(header(p, 'Subject') ?? '').trim() || null,
    fromHeader: decodeMimeWords(header(p, 'From') ?? ''),
    from: parseAddressList(header(p, 'From')),
    to: parseAddressList(header(p, 'To')),
    cc: parseAddressList(header(p, 'Cc')),
    occurredAt: Number.isFinite(dateMs) ? new Date(dateMs).toISOString() : new Date().toISOString(),
    body: trimQuoted(body).slice(0, 20000),
    isDraft: (raw.labelIds ?? []).includes('DRAFT'),
  };
}

// ── Búsqueda por dirección ────────────────────────────────────────────────

/** Direcciones por consulta: tres términos por dirección, y Gmail corta las largas. */
export const ADDRESSES_PER_QUERY = 15;

/**
 * Consultas de Gmail que devuelven SOLO correos con estas direcciones, desde
 * `afterEpochSec`. Las llaves `{}` son un OR en la sintaxis de Gmail.
 */
export function buildAddressQueries(addresses: string[], afterEpochSec: number | null): string[] {
  const clean = [...new Set(addresses.map((a) => a.trim().toLowerCase()))].filter((a) =>
    /^[^\s@"{}()]+@[^\s@"{}()]+$/.test(a),
  );
  const out: string[] = [];
  for (let i = 0; i < clean.length; i += ADDRESSES_PER_QUERY) {
    const chunk = clean.slice(i, i + ADDRESSES_PER_QUERY);
    const terms = chunk.flatMap((a) => [`from:${a}`, `to:${a}`, `cc:${a}`]).join(' ');
    out.push(`${afterEpochSec != null ? `after:${Math.floor(afterEpochSec)} ` : ''}{${terms}}`);
  }
  return out;
}

// ── Envío ─────────────────────────────────────────────────────────────────

function encodeHeaderWord(value: string): string {
  // ASCII imprimible sin saltos va tal cual; lo demás, en una palabra B.
  if (/^[\x20-\x7e]*$/.test(value)) return value;
  const bytes = new TextEncoder().encode(value);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return `=?UTF-8?B?${btoa(bin)}?=`;
}

function safeHeader(value: string): string {
  return value.replace(/[\r\n]+/g, ' ').trim();
}

/** Un correo RFC 5322 en texto plano UTF-8, codificado base64url para la API. */
export function buildRawMessage(opts: {
  from: string;
  to: string;
  toName?: string | null;
  subject: string;
  body: string;
  messageId: string;
  inReplyTo?: string | null;
  references?: string | null;
}): string {
  const to = opts.toName
    ? `${encodeHeaderWord(safeHeader(opts.toName).replace(/"/g, ''))} <${safeHeader(opts.to)}>`
    : safeHeader(opts.to);
  const headers = [
    `From: ${safeHeader(opts.from)}`,
    `To: ${to}`,
    `Subject: ${encodeHeaderWord(safeHeader(opts.subject))}`,
    `Message-ID: ${safeHeader(opts.messageId)}`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset="UTF-8"',
    'Content-Transfer-Encoding: base64',
  ];
  if (opts.inReplyTo) headers.push(`In-Reply-To: ${safeHeader(opts.inReplyTo)}`);
  if (opts.references) headers.push(`References: ${safeHeader(opts.references)}`);
  const bodyBytes = new TextEncoder().encode(opts.body.replace(/\r?\n/g, '\r\n'));
  let bin = '';
  for (const b of bodyBytes) bin += String.fromCharCode(b);
  const bodyB64 = (btoa(bin).match(/.{1,76}/g) ?? []).join('\r\n');
  const message = `${headers.join('\r\n')}\r\n\r\n${bodyB64}\r\n`;
  const all = new TextEncoder().encode(message);
  let s = '';
  for (const b of all) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// ── Cliente ───────────────────────────────────────────────────────────────

export class GmailClient {
  constructor(
    private readonly fetchFn: Fetch,
    private readonly accessToken: string,
  ) {}

  private async call<T>(path: string, init?: RequestInit): Promise<T> {
    const res = await this.fetchFn(`${API}${path}`, {
      ...init,
      headers: {
        authorization: `Bearer ${this.accessToken}`,
        accept: 'application/json',
        ...(init?.body ? { 'content-type': 'application/json' } : {}),
      },
    });
    if (res.status === 401) throw new ProviderAuthError('unauthorized');
    if (!res.ok) throw new ProviderError(res.status, await readError(res));
    return (await res.json()) as T;
  }

  getProfile(): Promise<{ emailAddress: string; historyId: string }> {
    return this.call('/profile');
  }

  /**
   * ¿Ha entrado algo desde el cursor? Devuelve el cursor nuevo y si hubo
   * mensajes añadidos. Un cursor caducado (404) lanza CursorExpiredError.
   */
  async historySince(startHistoryId: string): Promise<{ historyId: string; changed: boolean }> {
    let pageToken: string | undefined;
    let historyId = startHistoryId;
    let changed = false;
    for (let page = 0; page < 20; page++) {
      const q = new URLSearchParams({ startHistoryId, historyTypes: 'messageAdded', maxResults: '500' });
      if (pageToken) q.set('pageToken', pageToken);
      let r: { history?: { messagesAdded?: unknown[] }[]; historyId?: string; nextPageToken?: string };
      try {
        r = await this.call(`/history?${q}`);
      } catch (err) {
        if (err instanceof ProviderError && err.status === 404) throw new CursorExpiredError();
        throw err;
      }
      if (r.historyId) historyId = r.historyId;
      if ((r.history ?? []).some((h) => (h.messagesAdded?.length ?? 0) > 0)) changed = true;
      if (!r.nextPageToken) break;
      pageToken = r.nextPageToken;
    }
    return { historyId, changed };
  }

  /** Ids de los mensajes que casan con la consulta, hasta `max`. */
  async search(q: string, max: number): Promise<{ ids: { id: string; threadId?: string }[]; truncated: boolean }> {
    const ids: { id: string; threadId?: string }[] = [];
    let pageToken: string | undefined;
    for (;;) {
      const params = new URLSearchParams({ q, maxResults: String(Math.min(100, max - ids.length)) });
      if (pageToken) params.set('pageToken', pageToken);
      const r = await this.call<{ messages?: { id: string; threadId?: string }[]; nextPageToken?: string }>(
        `/messages?${params}`,
      );
      ids.push(...(r.messages ?? []));
      if (!r.nextPageToken) return { ids, truncated: false };
      if (ids.length >= max) return { ids, truncated: true };
      pageToken = r.nextPageToken;
    }
  }

  getMessage(id: string): Promise<GmailRawMessage> {
    return this.call(`/messages/${encodeURIComponent(id)}?format=full`);
  }

  send(raw: string, threadId?: string | null): Promise<{ id: string; threadId?: string }> {
    return this.call('/messages/send', {
      method: 'POST',
      body: JSON.stringify(threadId ? { raw, threadId } : { raw }),
    });
  }
}

/** Google como adaptador de proveedor. */
export function googleAdapter(
  fetchFn: Fetch,
  creds: { clientId: string; clientSecret: string },
): MailAdapter {
  return {
    provider: 'google',
    async accessToken(refreshToken) {
      return refreshGoogleToken(fetchFn, { ...creds, refreshToken });
    },
    async profile(accessToken) {
      const p = await new GmailClient(fetchFn, accessToken).getProfile();
      return { address: p.emailAddress.toLowerCase(), cursor: p.historyId };
    },
    async changesSince(accessToken, cursor) {
      try {
        const r = await new GmailClient(fetchFn, accessToken).historySince(cursor);
        return { cursor: r.historyId, changed: r.changed, expired: false };
      } catch (err) {
        if (err instanceof CursorExpiredError) return { cursor: null, changed: true, expired: true };
        throw err;
      }
    },
    async search(accessToken, addresses, afterEpochSec, max) {
      const client = new GmailClient(fetchFn, accessToken);
      const ids = new Map<string, string | null>();
      let truncated = false;
      for (const q of buildAddressQueries(addresses, afterEpochSec)) {
        const r = await client.search(q, max - ids.size);
        for (const m of r.ids) ids.set(m.id, m.threadId ?? null);
        if (r.truncated || ids.size >= max) {
          truncated = true;
          break;
        }
      }
      return { ids: [...ids.keys()], truncated };
    },
    async fetchMessage(accessToken, id) {
      return parseGmailMessage(await new GmailClient(fetchFn, accessToken).getMessage(id));
    },
    async send(accessToken, msg) {
      const client = new GmailClient(fetchFn, accessToken);
      const raw = buildRawMessage(msg);
      const r = await client.send(raw, msg.threadId ?? null);
      return { providerMessageId: r.id, providerThreadId: r.threadId ?? null };
    },
    async revoke(token) {
      return revokeGoogleToken(fetchFn, token);
    },
  };
}
