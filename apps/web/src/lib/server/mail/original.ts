/**
 * El original de un correo, traído del buzón al abrirlo (punto 111). Nada se
 * guarda: ni el cuerpo entero ni los adjuntos pasan por la base.
 *
 * Permiso, en dos llaves:
 *  1. con el JWT de quien mira, el evento (`conversation_event`, su RLS: si ve
 *     el correo en la conversación, puede ver su original, ADR-099 punto 4);
 *  2. con la clave de servicio, que ese mensaje de ese buzón lo registró Hour
 *     (`mail_message_ingested`): los metadatos del evento no bastan, porque
 *     quien edita una conversación puede escribir un evento de correo con los
 *     ids que quiera (migración 20261104130000). Y al bajarlo, su Message-ID
 *     tiene que ser el del evento.
 * Sólo después se descifra el token del buzón, como al enviar (send.ts).
 */

import { pgGet, PostgrestError, type SupabaseEnv } from '../../supabase';
import type { MailAttachment, MailOriginal } from '../../mail-original';
import { decryptSecret, importMailKey, refreshTokenAad } from './crypto';
import { mailConfigured, serviceMailDb, type MailEnv } from './db';
import {
  decodeMimeWords,
  GmailClient,
  googleAdapter,
  ProviderAuthError,
  ProviderError,
  type GmailPart,
  type GmailRawMessage,
} from './gmail';

/** Tope del texto y del HTML que se devuelven (caracteres). */
const BODY_MAX = 1_000_000;

function headerOf(part: GmailPart | undefined, name: string): string | null {
  const h = part?.headers?.find((x) => x.name.toLowerCase() === name.toLowerCase());
  return h ? h.value : null;
}

/** El valor de un parámetro de cabecera MIME (`charset`, `filename`…). */
function param(value: string | null, name: string): string | null {
  if (!value) return null;
  const m = value.match(new RegExp(`(?:^|;)\\s*${name}\\s*=\\s*(?:"([^"]*)"|([^;\\s]+))`, 'i'));
  return m ? (m[1] ?? m[2] ?? null) : null;
}

export function base64UrlBytes(data: string): Uint8Array<ArrayBuffer> {
  const b64 = data.replace(/-/g, '+').replace(/_/g, '/').replace(/\s+/g, '');
  const bin = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
  const out = new Uint8Array(new ArrayBuffer(bin.length));
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** El texto de una parte en su juego de caracteres (Gmail ya quitó el base64/QP del transporte). */
export function partText(part: GmailPart): string {
  const bytes = base64UrlBytes(part.body?.data ?? '');
  const charset = param(headerOf(part, 'Content-Type'), 'charset')?.toLowerCase() ?? 'utf-8';
  try {
    return new TextDecoder(charset).decode(bytes);
  } catch {
    return new TextDecoder('utf-8').decode(bytes);
  }
}

function isAttachment(part: GmailPart): boolean {
  if (part.filename) return true;
  return /^\s*attachment/i.test(headerOf(part, 'Content-Disposition') ?? '');
}

function* walk(part: GmailPart | undefined): Generator<GmailPart> {
  if (!part) return;
  yield part;
  for (const p of part.parts ?? []) yield* walk(p);
}

/** El correo de Gmail entero, en la forma que pinta la ficha. */
export function parseGmailOriginal(raw: GmailRawMessage): MailOriginal {
  const p = raw.payload;
  let text: string | null = null;
  let html: string | null = null;
  const attachments: MailAttachment[] = [];
  for (const part of walk(p)) {
    const mime = (part.mimeType ?? '').toLowerCase();
    if (isAttachment(part)) {
      if (!part.partId) continue;
      const disposition = headerOf(part, 'Content-Disposition') ?? '';
      attachments.push({
        part_id: part.partId,
        filename:
          decodeMimeWords(part.filename || param(disposition, 'filename') || '').trim() || part.partId,
        mime_type: mime || 'application/octet-stream',
        size: part.body?.size ?? 0,
        inline: /^\s*inline/i.test(disposition) || Boolean(headerOf(part, 'Content-ID')),
      });
      continue;
    }
    if (!part.body?.data) continue;
    if (mime === 'text/plain' && text == null) text = partText(part);
    else if (mime === 'text/html' && html == null) html = partText(part);
  }
  const truncated = (text?.length ?? 0) > BODY_MAX || (html?.length ?? 0) > BODY_MAX;
  const dateMs = raw.internalDate ? Number(raw.internalDate) : Date.parse(headerOf(p, 'Date') ?? '');
  return {
    subject: decodeMimeWords(headerOf(p, 'Subject') ?? '').trim() || null,
    from: decodeMimeWords(headerOf(p, 'From') ?? ''),
    to: decodeMimeWords(headerOf(p, 'To') ?? ''),
    cc: decodeMimeWords(headerOf(p, 'Cc') ?? ''),
    date: Number.isFinite(dateMs) ? new Date(dateMs).toISOString() : null,
    text: text?.slice(0, BODY_MAX) ?? null,
    html: html?.slice(0, BODY_MAX) ?? null,
    attachments,
    truncated,
  };
}

/** La parte adjunta con ese `partId`, o null. */
export function attachmentPart(raw: GmailRawMessage, partId: string): GmailPart | null {
  for (const part of walk(raw.payload)) {
    if (part.partId === partId && isAttachment(part)) return part;
  }
  return null;
}

/** Un tipo MIME que se puede devolver tal cual; si no, bytes sin más. */
export function safeMimeType(mime: string | undefined): string {
  const m = (mime ?? '').trim().toLowerCase();
  return /^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*$/.test(m) ? m : 'application/octet-stream';
}

/** `Content-Disposition: attachment` con el nombre en ASCII y en UTF-8 (RFC 6266). */
export function attachmentDisposition(filename: string): string {
  const clean = filename.replace(/[\u0000-\u001f\u007f"\\/]+/g, '_').trim() || 'adjunto';
  const ascii = clean.replace(/[^\x20-\x7e]/g, '_');
  const utf8 = encodeURIComponent(clean).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
  return `attachment; filename="${ascii}"; filename*=UTF-8''${utf8}`;
}

type OriginalEnv = MailEnv &
  Required<Pick<MailEnv, 'SUPABASE_SERVICE_ROLE_KEY' | 'GOOGLE_OAUTH_CLIENT_ID' | 'GOOGLE_OAUTH_CLIENT_SECRET' | 'MAIL_TOKEN_KEY'>>;

interface EventRef {
  id: string;
  workspace_id: string;
  source: string;
  mail_account_id: string | null;
  provider_message_id: string | null;
  rfc_message_id: string | null;
}

export type OpenedOriginal =
  | { ok: true; raw: GmailRawMessage; client: GmailClient }
  | { ok: false; status: number; error: string };

/**
 * Las dos llaves y el mensaje bajado de Gmail. `not_found` cuando no se ve el
 * evento (no confirma que exista); `no_original` cuando se ve pero no es un
 * correo que Hour trajera de un buzón.
 */
export async function openOriginal(
  env: OriginalEnv,
  jwt: string,
  conversationId: string,
  eventId: string,
  fetchFn: typeof fetch = fetch,
): Promise<OpenedOriginal> {
  // 1. ¿Lo ve? Con su JWT: la RLS del evento decide.
  const r = await pgGet<EventRef>(env as unknown as SupabaseEnv, 'conversation_event', jwt, {
    search: {
      select:
        'id,workspace_id,source,mail_account_id:metadata->>mail_account_id,provider_message_id:metadata->>provider_message_id,rfc_message_id:metadata->>rfc_message_id',
      id: `eq.${eventId}`,
      conversation_id: `eq.${conversationId}`,
    },
  });
  const ev = r.data[0];
  if (!ev) return { ok: false, status: 404, error: 'not_found' };
  if (ev.source !== 'email' || !ev.mail_account_id || !ev.provider_message_id) {
    return { ok: false, status: 404, error: 'no_original' };
  }

  // 2. ¿Lo trajo Hour de ese buzón? Con la clave de servicio, sólo ids.
  const db = serviceMailDb(env, fetchFn);
  if (!(await db.messageIngested(ev.mail_account_id, ev.provider_message_id, ev.rfc_message_id))) {
    return { ok: false, status: 404, error: 'no_original' };
  }
  const account = await db.account(ev.mail_account_id);
  if (!account || account.workspace_id !== ev.workspace_id || account.provider !== 'google') {
    return { ok: false, status: 404, error: 'no_original' };
  }
  if (account.status !== 'active') return { ok: false, status: 409, error: 'mailbox_unavailable' };

  // 3. El token, sólo tras el permiso.
  const key = await importMailKey(env.MAIL_TOKEN_KEY);
  const refreshToken = await decryptSecret(
    key,
    account.refresh_token_ciphertext,
    refreshTokenAad(account.workspace_id, account.address),
  );
  const adapter = googleAdapter(fetchFn, {
    clientId: env.GOOGLE_OAUTH_CLIENT_ID,
    clientSecret: env.GOOGLE_OAUTH_CLIENT_SECRET,
  });
  const client = new GmailClient(fetchFn, await adapter.accessToken(refreshToken));
  const raw = await client.getMessage(ev.provider_message_id);

  // El mensaje es el del evento: mismo Message-ID.
  const rfc = headerOf(raw.payload, 'Message-ID') ?? headerOf(raw.payload, 'Message-Id');
  if (ev.rfc_message_id && rfc?.trim() !== ev.rfc_message_id) {
    return { ok: false, status: 404, error: 'no_original' };
  }
  return { ok: true, raw, client };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function noStore(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
}

/**
 * La parte común de las tres rutas del original: identidad, ids, las dos
 * llaves y los errores del buzón. `handle` recibe el mensaje ya autorizado.
 */
export async function withOriginal(
  args: {
    env: Partial<MailEnv> | undefined;
    jwt: string | null;
    conversationId: string;
    eventId: string;
    route: string;
    requestId?: string;
  },
  handle: (opened: { raw: GmailRawMessage; client: GmailClient }) => Promise<Response>,
): Promise<Response> {
  const { env } = args;
  if (!env) return noStore({ error: 'platform_unavailable' }, 500);
  if (!mailConfigured(env)) return noStore({ error: 'not_configured' }, 503);
  if (!args.jwt) return noStore({ error: 'missing_authorization' }, 401);
  if (!UUID.test(args.conversationId) || !UUID.test(args.eventId)) return noStore({ error: 'invalid_id' }, 400);
  try {
    const opened = await openOriginal(env, args.jwt, args.conversationId, args.eventId);
    if (!opened.ok) return noStore({ error: opened.error }, opened.status);
    return await handle(opened);
  } catch (err) {
    if (err instanceof ProviderAuthError) return noStore({ error: 'mailbox_revoked' }, 409);
    // Borrado en Gmail (o ya fuera del buzón): no hay original que traer.
    if (err instanceof ProviderError && (err.status === 404 || err.status === 400)) {
      return noStore({ error: 'original_gone' }, 410);
    }
    if (err instanceof PostgrestError && (err.status === 401 || err.status === 403)) {
      return noStore({ error: 'not_found' }, 404);
    }
    console.error(
      JSON.stringify({
        level: 'error',
        kind: 'mail_original',
        route: args.route,
        request_id: args.requestId ?? null,
        error: err instanceof Error ? err.message.slice(0, 200) : 'unknown_error',
      }),
    );
    return noStore({ error: 'original_failed' }, 502);
  }
}
