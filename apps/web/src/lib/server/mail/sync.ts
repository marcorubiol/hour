/**
 * La sincronización del buzón (ADR-099 punto 3): incremental, idempotente y
 * mínima. Corre en el cron del Worker (src/worker-cron.ts) y, a mano, desde
 * «Sincronizar ahora» y justo después de conectar.
 *
 * Una pasada por buzón:
 *  1. descifra el refresh token y pide uno de acceso (revocado → `revoked`);
 *  2. pide a la base las direcciones de los contactos que este buzón puede
 *     traer; sin contactos no se pregunta nada al proveedor;
 *  3. contactos nuevos (también todos, la primera vez): busca su correo de los
 *     últimos 12 meses y, cuando termina, los marca como traídos (ADR-099,
 *     añadido del 2026-10-11);
 *  4. contactos ya traídos: con cursor, pregunta si hubo correo nuevo; si lo
 *     hubo, busca SOLO por esas direcciones desde la última pasada (con una
 *     hora de solape);
 *  5. descarta los ids ya procesados y baja el resto empezando por el más
 *     viejo de todo lo pendiente (regla del hilo, ADR-102), empareja
 *     (provider.ts) y registra; lo que no empareja se apunta como procesado sin asunto ni
 *     cuerpo, para no volver a bajarlo;
 *  5b. vuelve a bajar los que esperaban su hilo y ya lo encuentran
 *     (`mail_deferred_ready`): una respuesta que llegó antes que su original
 *     no se pierde;
 *  6. avanza el cursor solo si la parte incremental terminó entera. Si se cortó
 *     por el tope, la siguiente repite la búsqueda y salta lo ya procesado.
 *
 * Solo imports relativos (lo empaqueta también el cron, fuera de SvelteKit).
 */

import { decryptSecret, importMailKey, refreshTokenAad } from './crypto';
import { serviceMailDb, mailConfigured, type MailAccountRow, type MailDb, type MailEnv } from './db';
import { googleAdapter, ProviderAuthError } from './gmail';
import { matchMessage, oldestFirst, type MailAdapter, type MailMessage } from './provider';

/** Tope de correos que se bajan por buzón y pasada (CPU del Worker). */
export const MAX_MESSAGES_PER_PASS = 100;
/** Tope de ids que se listan por pasada (listar es barato: 100 por llamada). */
export const MAX_IDS_PER_PASS = 1000;
/** Lo que se trae de un contacto nuevo. */
export const BACKFILL_MS = 365 * 24 * 60 * 60 * 1000;
/** Solape con la pasada anterior: el reloj y la indexación de Gmail no son exactos. */
const OVERLAP_MS = 60 * 60 * 1000;

export interface SyncDeps {
  db: MailDb;
  adapter: (provider: MailAccountRow['provider']) => MailAdapter;
  key: CryptoKey;
  maxMessages?: number;
  now?: () => number;
}

export interface SyncResult {
  accountId: string;
  status: 'active' | 'revoked' | 'error';
  fetched: number;
  ingested: number;
  complete: boolean;
  error: string | null;
}

function errorCode(err: unknown): string {
  if (err instanceof Error) return err.message.slice(0, 200) || err.name;
  return 'unknown_error';
}

export async function syncAccount(deps: SyncDeps, account: MailAccountRow): Promise<SyncResult> {
  const { db, key } = deps;
  const max = deps.maxMessages ?? MAX_MESSAGES_PER_PASS;
  const base = { accountId: account.id, fetched: 0, ingested: 0 };

  const finish = async (r: Omit<SyncResult, 'accountId' | 'fetched' | 'ingested'> & { cursor: string | null }, counts = base) => {
    await db.finish(account.id, {
      status: r.status,
      cursor: r.cursor,
      complete: r.complete,
      ingested: counts.ingested,
      error: r.error,
    });
    return { ...counts, status: r.status, complete: r.complete, error: r.error };
  };

  let refreshToken: string;
  try {
    refreshToken = await decryptSecret(
      key,
      account.refresh_token_ciphertext,
      refreshTokenAad(account.workspace_id, account.address),
    );
  } catch {
    return finish({ status: 'error', cursor: null, complete: false, error: 'token_unreadable' });
  }

  const adapter = deps.adapter(account.provider);
  let access: string;
  try {
    access = await adapter.accessToken(refreshToken);
  } catch (err) {
    if (err instanceof ProviderAuthError) {
      return finish({ status: 'revoked', cursor: null, complete: false, error: 'access_revoked' });
    }
    return finish({ status: 'active', cursor: null, complete: false, error: errorCode(err) });
  }

  try {
    const all = await db.contactAddresses(account.id);
    const contacts = new Set(all.map((a) => a.address.toLowerCase()));
    const fresh = all.filter((a) => !a.backfilled).map((a) => a.address.toLowerCase());
    const settled = all.filter((a) => a.backfilled).map((a) => a.address.toLowerCase());
    const now = deps.now?.() ?? Date.now();

    // Dónde estamos y si hubo correo nuevo desde el cursor.
    let cursor: string | null;
    let changed = true;
    const syncFromMs = Date.parse(account.sync_from);
    const lastMs = account.last_synced_at ? Date.parse(account.last_synced_at) : null;
    if (!account.sync_cursor) {
      cursor = (await adapter.profile(access)).cursor;
    } else {
      const c = await adapter.changesSince(access, account.sync_cursor);
      if (c.expired) {
        cursor = (await adapter.profile(access)).cursor;
      } else {
        cursor = c.cursor;
        changed = c.changed;
      }
    }

    if (contacts.size === 0) return finish({ status: 'active', cursor, complete: true, error: null });

    const counts = { ...base };
    let budget = max;

    /** Baja y registra estos ids, del más viejo al más nuevo (regla del hilo, ADR-102). */
    const ingestIds = async (ids: string[]) => {
      const fetched: MailMessage[] = [];
      for (const id of ids) {
        fetched.push(await adapter.fetchMessage(access, id));
        counts.fetched++;
        budget--;
      }
      for (const msg of oldestFirst(fetched)) {
        const match = matchMessage(msg, account.address, contacts);
        counts.ingested += await db.ingest(account.id, {
          provider_message_id: msg.providerMessageId,
          provider_thread_id: msg.providerThreadId,
          rfc_message_id: msg.rfcMessageId,
          in_reply_to: match ? msg.inReplyTo : null,
          references: match ? msg.references : [],
          occurred_at: msg.occurredAt,
          direction: match?.direction ?? 'inbound',
          // Sin emparejado no se guarda ni asunto ni cuerpo: solo que ya se miró.
          subject: match ? msg.subject : null,
          from: match ? msg.fromHeader : '',
          to: match ? msg.to : [],
          cc: match ? msg.cc : [],
          counterparts: match?.counterparts ?? [],
          body: match ? msg.body || null : null,
        });
      }
    };

    /** Baja y registra lo pendiente de una búsqueda; true si no quedó nada. */
    const drain = async (found: { ids: string[]; truncated: boolean }): Promise<boolean> => {
      const known = new Set(await db.knownMessages(account.id, found.ids));
      // Gmail lista cada búsqueda del más nuevo al más viejo: se empieza por el
      // final de TODO lo pendiente, no solo del lote, para que el correo al que
      // responde otro entre casi siempre antes que la respuesta. La garantía no
      // es este orden sino la espera de `mail_message` (más abajo): una
      // respuesta que llega antes que su hilo se reintenta cuando el hilo está.
      const pending = found.ids.filter((id) => !known.has(id)).reverse();
      const batch = pending.slice(0, Math.max(0, budget));
      await ingestIds(batch);
      return !found.truncated && batch.length === pending.length;
    };

    // Contactos nuevos: sus últimos 12 meses.
    if (fresh.length) {
      const found = await adapter.search(access, fresh, Math.floor((now - BACKFILL_MS) / 1000), MAX_IDS_PER_PASS);
      if (await drain(found)) await db.markBackfilled(account.id, fresh);
    }

    // Contactos ya traídos: lo nuevo desde la última pasada.
    let incrementalDone = true;
    if (settled.length && changed) {
      const fromMs = Math.max(syncFromMs, (lastMs ?? syncFromMs) - OVERLAP_MS);
      const found = await adapter.search(access, settled, Math.floor(fromMs / 1000), MAX_IDS_PER_PASS);
      incrementalDone = await drain(found);
    }

    // Los que esperaban su hilo y ya lo encuentran (llegó el original en esta
    // pasada, o por otro buzón): se vuelven a bajar y registrar.
    if (budget > 0) {
      const ready = await db.deferredReady(account.id);
      await ingestIds(ready.slice(0, budget));
    }

    return finish({ status: 'active', cursor, complete: incrementalDone, error: null }, counts);
  } catch (err) {
    if (err instanceof ProviderAuthError) {
      return finish({ status: 'revoked', cursor: null, complete: false, error: 'access_revoked' });
    }
    return finish({ status: 'active', cursor: null, complete: false, error: errorCode(err) });
  }
}

/** Las dependencias reales a partir del entorno del Worker. */
export async function liveSyncDeps(env: MailEnv, fetchFn: typeof fetch = fetch): Promise<SyncDeps | null> {
  if (!mailConfigured(env)) return null;
  const key = await importMailKey(env.MAIL_TOKEN_KEY);
  const google = googleAdapter(fetchFn, {
    clientId: env.GOOGLE_OAUTH_CLIENT_ID,
    clientSecret: env.GOOGLE_OAUTH_CLIENT_SECRET,
  });
  return { db: serviceMailDb(env, fetchFn), adapter: () => google, key };
}

/**
 * Una pasada del cron: toma los buzones que tocan y los sincroniza uno a uno.
 * Con `accountId`, solo ese (sincronizar ahora), aunque no le toque.
 */
export async function runMailSync(
  env: MailEnv,
  opts: { accountId?: string; limit?: number } = {},
): Promise<SyncResult[]> {
  const deps = await liveSyncDeps(env);
  if (!deps) return [];
  const accounts = await deps.db.claim(opts.limit ?? 10, opts.accountId);
  const results: SyncResult[] = [];
  for (const account of accounts) {
    results.push(await syncAccount(deps, account));
  }
  console.log(
    JSON.stringify({
      level: 'info',
      kind: 'mail_sync',
      accounts: results.length,
      ingested: results.reduce((n, r) => n + r.ingested, 0),
      errors: results.filter((r) => r.error).map((r) => ({ id: r.accountId, error: r.error })),
    }),
  );
  return results;
}
