/**
 * Offline scaffold — IndexedDB schema for read cache + write queue (D-PRE-08).
 *
 * Phase 0.0: schema and surface only. Nothing reads/writes through here yet
 * — pages still fetch directly via TanStack Query, and we have no UI
 * mutations to enqueue. The wiring lands in Phase 0.2 when Plaza/Desk start
 * mutating engagement state and a network drop should buffer instead of
 * losing the change.
 *
 * Schema versioning (when adding/changing stores in the future):
 *   1. Bump `DB_VERSION`.
 *   2. Extend the `upgrade` callback with the previous-version branch — IDB
 *      gives you the old version, run additive migrations conditionally.
 *   3. Never rename or delete a store without a migration path; users with
 *      pending writes in `write_queue` would lose them.
 */

import { type DBSchema, type IDBPDatabase, openDB } from 'idb';

export const DB_NAME = 'hour-offline';
export const DB_VERSION = 1;

export interface CachedRead {
  /** URL the response was fetched from — used as primary key. */
  url: string;
  /** Parsed JSON payload. Stored as-is; consumer is responsible for shape. */
  data: unknown;
  /** Wall-clock millis at fetch time. Caller decides freshness policy. */
  fetchedAt: number;
}

export type WriteQueueMethod = 'POST' | 'PATCH' | 'PUT' | 'DELETE';

export interface QueuedWrite {
  /** Auto-incrementing primary key (from `autoIncrement: true`). */
  id?: number;
  /** Absolute or path-relative URL the request should target on replay. */
  url: string;
  method: WriteQueueMethod;
  /** JSON-serialised body. null for methods that carry no body. */
  body: string | null;
  /**
   * Non-secret headers that the request needs for replay (e.g.
   * `content-type: application/json`). Auth headers are NOT stored — the
   * replayer attaches the current JWT at send time so a stale token from
   * the queue can't bypass a sign-out.
   */
  headers: Record<string, string>;
  queuedAt: number;
  /** Number of failed replay attempts. The replayer may give up after N. */
  retries: number;
}

interface HourOfflineDB extends DBSchema {
  read_cache: {
    key: string;
    value: CachedRead;
    indexes: { 'by-fetchedAt': number };
  };
  write_queue: {
    key: number;
    value: QueuedWrite;
    indexes: { 'by-queuedAt': number };
  };
}

let dbPromise: Promise<IDBPDatabase<HourOfflineDB>> | null = null;

/**
 * Open the schema without using it. Triggers `upgrade` so v1 stores exist
 * in DevTools → Application → IndexedDB even before any data is written.
 * Browser-only; safe to fire-and-forget. Idempotent.
 */
export function prewarmDB(): void {
  if (typeof indexedDB === 'undefined') return;
  void getDB().catch((e) => console.warn('[offline] prewarmDB failed:', e));
}

/**
 * Lazy singleton — first caller opens (and runs upgrade if needed); later
 * callers reuse the same connection. Browser-only; throws on the server.
 */
export function getDB(): Promise<IDBPDatabase<HourOfflineDB>> {
  if (typeof indexedDB === 'undefined') {
    throw new Error('getDB() requires a browser environment.');
  }
  if (!dbPromise) {
    dbPromise = openDB<HourOfflineDB>(DB_NAME, DB_VERSION, {
      upgrade(db, oldVersion) {
        // Initial schema (v1).
        if (oldVersion < 1) {
          const reads = db.createObjectStore('read_cache', { keyPath: 'url' });
          reads.createIndex('by-fetchedAt', 'fetchedAt');

          const writes = db.createObjectStore('write_queue', {
            keyPath: 'id',
            autoIncrement: true,
          });
          writes.createIndex('by-queuedAt', 'queuedAt');
        }
        // Future: `if (oldVersion < 2) { ... }` etc.
      },
    });
  }
  return dbPromise;
}

// ── Read cache helpers ──────────────────────────────────────────────────

export async function cacheRead(url: string, data: unknown): Promise<void> {
  const db = await getDB();
  await db.put('read_cache', { url, data, fetchedAt: Date.now() });
}

export async function getCachedRead(url: string): Promise<CachedRead | undefined> {
  const db = await getDB();
  return db.get('read_cache', url);
}

export async function clearReadCache(): Promise<void> {
  const db = await getDB();
  await db.clear('read_cache');
}

// ── Write queue helpers ─────────────────────────────────────────────────

/** Enqueue a mutation for later replay. Returns the new auto-id. */
export async function enqueueWrite(
  entry: Omit<QueuedWrite, 'id' | 'queuedAt' | 'retries'>,
): Promise<number> {
  const db = await getDB();
  const full: Omit<QueuedWrite, 'id'> = {
    ...entry,
    queuedAt: Date.now(),
    retries: 0,
  };
  return db.add('write_queue', full as QueuedWrite);
}

/** All pending writes ordered oldest-first. */
export async function listQueuedWrites(): Promise<QueuedWrite[]> {
  const db = await getDB();
  return db.getAllFromIndex('write_queue', 'by-queuedAt');
}

/** Remove a successfully-replayed write. Idempotent. */
export async function dequeueWrite(id: number): Promise<void> {
  const db = await getDB();
  await db.delete('write_queue', id);
}

/** Increment the retry count after a failed replay. */
export async function bumpWriteRetries(id: number): Promise<void> {
  const db = await getDB();
  const tx = db.transaction('write_queue', 'readwrite');
  const existing = await tx.store.get(id);
  if (existing) {
    existing.retries += 1;
    await tx.store.put(existing);
  }
  await tx.done;
}
