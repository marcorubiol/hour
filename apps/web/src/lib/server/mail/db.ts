/**
 * El acceso a la base de la sincronización, que corre sin persona detrás
 * (cron) y por eso con la clave de servicio que ya está en Wrangler
 * (`SUPABASE_SERVICE_ROLE_KEY`; ADR-099, añadido del 2026-10-11).
 *
 * Frontera: este módulo SOLO llama a las RPC `mail_*` que la migración
 * 20261011200000 concede a service_role, ninguna tabla. La clave no se usa en
 * ningún otro sitio del Worker; lo que hace una persona sigue yendo con su JWT
 * y RLS.
 */

export interface MailEnv {
  PUBLIC_SUPABASE_URL: string;
  PUBLIC_SUPABASE_ANON_KEY: string;
  SUPABASE_SERVICE_ROLE_KEY?: string;
  GOOGLE_OAUTH_CLIENT_ID?: string;
  GOOGLE_OAUTH_CLIENT_SECRET?: string;
  MAIL_TOKEN_KEY?: string;
}

/** Lo que la sincronización y el envío necesitan; falta algo → el correo está apagado. */
export function mailConfigured(env: Partial<MailEnv> | undefined | null): env is MailEnv & {
  SUPABASE_SERVICE_ROLE_KEY: string;
  GOOGLE_OAUTH_CLIENT_ID: string;
  GOOGLE_OAUTH_CLIENT_SECRET: string;
  MAIL_TOKEN_KEY: string;
} {
  return Boolean(
    env?.PUBLIC_SUPABASE_URL &&
      env.SUPABASE_SERVICE_ROLE_KEY &&
      env.GOOGLE_OAUTH_CLIENT_ID &&
      env.GOOGLE_OAUTH_CLIENT_SECRET &&
      env.MAIL_TOKEN_KEY,
  );
}

export interface MailAccountRow {
  id: string;
  workspace_id: string;
  scope: 'personal' | 'workspace';
  owner_user_id: string | null;
  provider: 'google';
  address: string;
  refresh_token_ciphertext: string;
  token_key_version: number;
  status: 'active' | 'revoked' | 'error';
  sync_cursor: string | null;
  sync_from: string;
  last_synced_at: string | null;
}

interface ContactAddress {
  address: string;
  /** Ya se trajeron sus últimos 12 meses en este buzón. */
  backfilled: boolean;
}

export interface IngestPayload {
  provider_message_id: string;
  provider_thread_id: string | null;
  rfc_message_id: string | null;
  /** Regla del hilo (ADR-102, añadido, punto 4): a qué correo responde. */
  in_reply_to?: string | null;
  references?: string[];
  occurred_at: string;
  direction: 'inbound' | 'outbound';
  subject: string | null;
  from: string;
  to: string[];
  cc: string[];
  counterparts: string[];
  body: string | null;
  /** An automatic reply: stored as `metadata.auto` (ADR-126 § 3). */
  auto?: boolean;
}

/** La interfaz que sync.ts usa: los tests la simulan en memoria. */
export interface MailDb {
  claim(limit: number, accountId?: string): Promise<MailAccountRow[]>;
  account(accountId: string): Promise<MailAccountRow | null>;
  contactAddresses(accountId: string): Promise<ContactAddress[]>;
  markBackfilled(accountId: string, addresses: string[]): Promise<void>;
  knownMessages(accountId: string, ids: string[]): Promise<string[]>;
  /** Correos que esperaban su hilo y ya lo encuentran (ADR-102): se vuelven a bajar. */
  deferredReady(accountId: string): Promise<string[]>;
  ingest(accountId: string, message: IngestPayload, createdBy?: string | null): Promise<number>;
  finish(
    accountId: string,
    r: {
      status: 'active' | 'revoked' | 'error';
      cursor: string | null;
      complete: boolean;
      ingested: number;
      error: string | null;
    },
  ): Promise<void>;
}

class MailDbError extends Error {
  constructor(
    public readonly status: number,
    public readonly body: string,
  ) {
    super(`mail db ${status}: ${body.slice(0, 200)}`);
  }
}

export function serviceMailDb(env: MailEnv & { SUPABASE_SERVICE_ROLE_KEY: string }, fetchFn: typeof fetch = fetch): MailDb {
  const key = env.SUPABASE_SERVICE_ROLE_KEY;
  // Las claves nuevas (`sb_secret_…`) van solo en `apikey`; la legada
  // service_role es un JWT y va también como Bearer.
  const headers: Record<string, string> = {
    apikey: key,
    'content-type': 'application/json',
    accept: 'application/json',
    ...(key.startsWith('eyJ') ? { authorization: `Bearer ${key}` } : {}),
  };
  async function rpc<T>(name: string, args: Record<string, unknown>): Promise<T> {
    const res = await fetchFn(new URL(`/rest/v1/rpc/${name}`, env.PUBLIC_SUPABASE_URL).toString(), {
      method: 'POST',
      headers,
      body: JSON.stringify(args),
    });
    const text = await res.text();
    if (!res.ok) throw new MailDbError(res.status, text);
    return (text ? JSON.parse(text) : null) as T;
  }
  return {
    claim: (limit, accountId) =>
      rpc<MailAccountRow[]>('mail_sync_claim', {
        p_limit: limit,
        ...(accountId ? { p_account_id: accountId } : {}),
      }),
    account: async (accountId) =>
      (await rpc<MailAccountRow[]>('mail_account_secret', { p_account_id: accountId }))[0] ?? null,
    contactAddresses: (accountId) => rpc<ContactAddress[]>('mail_contact_addresses', { p_account_id: accountId }),
    markBackfilled: async (accountId, addresses) => {
      if (addresses.length) await rpc('mail_mark_backfilled', { p_account_id: accountId, p_addresses: addresses });
    },
    knownMessages: (accountId, ids) =>
      ids.length ? rpc<string[]>('mail_known_messages', { p_account_id: accountId, p_ids: ids }) : Promise.resolve([]),
    deferredReady: (accountId) => rpc<string[]>('mail_deferred_ready', { p_account_id: accountId }),
    ingest: (accountId, message, createdBy) =>
      rpc<number>('mail_ingest_message', {
        p_account_id: accountId,
        p_message: message,
        ...(createdBy ? { p_created_by: createdBy } : {}),
      }),
    finish: async (accountId, r) => {
      await rpc('mail_sync_finish', {
        p_account_id: accountId,
        p_status: r.status,
        p_cursor: r.cursor,
        p_complete: r.complete,
        p_ingested: r.ingested,
        p_error: r.error,
      });
    },
  };
}
