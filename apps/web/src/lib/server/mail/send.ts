/**
 * Enviar desde Hour por el buzón conectado (ADR-099 punto 2).
 *
 * El permiso lo decide la base con el JWT de quien envía
 * (`mail_send_authorize`: edita la conversación, el buzón es suyo o el común
 * de ese espacio, y el destinatario es el contacto de la conversación, nunca
 * una dirección que mande el cliente). Solo después se usa la clave de
 * servicio para leer el token cifrado. Lo enviado queda en el registro como
 * un correo `outbound` a nombre de quien lo envió.
 */

import { pgGet, pgPostRpc, type SupabaseEnv } from '../../supabase';
import { decryptSecret, importMailKey, refreshTokenAad } from './crypto';
import { serviceMailDb, type MailEnv } from './db';
import { googleAdapter } from './gmail';
import { effectiveSignature, withSignature, type SignatureParts } from '../../mail';

export interface SendRequest {
  conversationId: string;
  accountId: string;
  subject: string;
  body: string;
  replyToEventId?: string | null;
}

export type SendOutcome =
  | { ok: true; providerMessageId: string; eventsCreated: number }
  | { ok: false; status: number; error: string };

interface ReplyContext {
  rfc_message_id: string | null;
  provider_thread_id: string | null;
  mail_account_id: string | null;
}

export async function sendFromConversation(
  env: MailEnv & Required<Pick<MailEnv, 'SUPABASE_SERVICE_ROLE_KEY' | 'GOOGLE_OAUTH_CLIENT_ID' | 'GOOGLE_OAUTH_CLIENT_SECRET' | 'MAIL_TOKEN_KEY'>>,
  jwt: string,
  userId: string,
  req: SendRequest,
  messageIdDomain: string,
  fetchFn: typeof fetch = fetch,
): Promise<SendOutcome> {
  const supa = env as unknown as SupabaseEnv;

  // 1. ¿Puede? (con su JWT: RLS y la RPC deciden)
  const auth = await pgPostRpc<{ recipient_address: string; recipient_name: string | null; account_address: string }>(
    supa,
    'mail_send_authorize',
    jwt,
    { p_conversation_id: req.conversationId, p_account_id: req.accountId },
  );
  const target = auth.data[0];
  if (!target?.recipient_address) return { ok: false, status: 400, error: 'no_recipient' };

  // 2. Si responde a un correo: sus cabeceras de hilo (leídas también con su JWT).
  let reply: ReplyContext | null = null;
  if (req.replyToEventId) {
    const r = await pgGet<ReplyContext>(supa, 'conversation_event', jwt, {
      search: {
        select:
          'rfc_message_id:metadata->>rfc_message_id,provider_thread_id:metadata->>provider_thread_id,mail_account_id:metadata->>mail_account_id',
        id: `eq.${req.replyToEventId}`,
        conversation_id: `eq.${req.conversationId}`,
      },
    });
    reply = r.data[0] ?? null;
  }

  // 3. El token, con la clave de servicio, solo tras el permiso.
  const db = serviceMailDb(env, fetchFn);
  const account = await db.account(req.accountId);
  if (!account || account.status !== 'active') return { ok: false, status: 409, error: 'mailbox_unavailable' };
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
  const access = await adapter.accessToken(refreshToken);

  const messageId = `<${crypto.randomUUID()}@${messageIdDomain}>`;
  // La firma es de Hour, no la de Gmail, y es de la persona en esa compañía
  // (ADR-099, añadido): la de quien envía en el espacio de la conversación, o
  // la de la compañía si sale por el buzón común. Con su JWT: solo la propia.
  const sig = await pgPostRpc<SignatureParts>(supa, 'my_mail_signature', jwt, {
    p_workspace_id: account.workspace_id,
  });
  const parts = sig.data[0];
  const body = withSignature(req.body, parts ? effectiveSignature(parts, account.scope) : null);
  const sent = await adapter.send(access, {
    from: account.address,
    to: target.recipient_address,
    toName: target.recipient_name,
    subject: req.subject,
    body,
    messageId,
    inReplyTo: reply?.rfc_message_id ?? null,
    references: reply?.rfc_message_id ?? null,
    // El hilo de Gmail es de cada buzón: solo vale si responde desde el mismo.
    threadId: reply?.mail_account_id === account.id ? reply.provider_thread_id : null,
  });

  // 4. Al registro, a nombre de quien envió. La sincronización lo saltará
  //    (mismo id de proveedor en este buzón, mismo Message-ID en los demás).
  const eventsCreated = await db.ingest(
    account.id,
    {
      provider_message_id: sent.providerMessageId,
      provider_thread_id: sent.providerThreadId,
      rfc_message_id: messageId,
      in_reply_to: reply?.rfc_message_id ?? null,
      references: reply?.rfc_message_id ? [reply.rfc_message_id] : [],
      occurred_at: new Date().toISOString(),
      direction: 'outbound',
      subject: req.subject,
      from: account.address,
      to: [target.recipient_address],
      cc: [],
      counterparts: [target.recipient_address.toLowerCase()],
      body,
    },
    userId,
  );
  return { ok: true, providerMessageId: sent.providerMessageId, eventsCreated };
}
