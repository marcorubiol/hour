/**
 * Offline — IndexedDB schema (D-PRE-08), the query cache kept on the device
 * (ADR-144) and Service Worker registration (D-PRE-13). Browser-only.
 */

export {
  bumpWriteRetries,
  DB_NAME,
  DB_VERSION,
  dequeueWrite,
  enqueueWrite,
  getDB,
  listQueuedWrites,
  prewarmDB,
  type QueuedWrite,
  type WriteQueueMethod,
} from './db';
export { registerServiceWorker } from './register';
export {
  bindQueryCache,
  cachedSessionUser,
  claimQueryCache,
  startQueryCache,
  wipeQueryCache,
} from './query-cache';
