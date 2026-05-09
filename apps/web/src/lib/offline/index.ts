/**
 * Offline scaffold — IndexedDB schema (D-PRE-08) + Service Worker
 * registration (D-PRE-13). Browser-only.
 *
 * Phase 0.0: surface only. Pages still fetch directly via TanStack Query;
 * no UI mutations exist to enqueue. Wiring lands in Phase 0.2.
 */

export {
  bumpWriteRetries,
  cacheRead,
  clearReadCache,
  DB_NAME,
  DB_VERSION,
  dequeueWrite,
  enqueueWrite,
  getCachedRead,
  getDB,
  listQueuedWrites,
  type CachedRead,
  type QueuedWrite,
  type WriteQueueMethod,
} from './db';
export { registerServiceWorker } from './register';
