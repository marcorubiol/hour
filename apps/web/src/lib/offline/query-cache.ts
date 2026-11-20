/**
 * The query cache kept on the device (ADR-144).
 *
 * Every open used to start blank and wait for the network: the frame painted
 * in half a second and the lens two to three later. Now the last-known
 * answers of every read live in IndexedDB; an open hydrates Hoy's small boot
 * set before the lens mounts, so it paints what it showed last time, and the
 * queries refetch behind it (they are stale: stale-while-revalidate is
 * TanStack's own behaviour once a query has data).
 *
 * Partitioned persistence (2026-11-20):
 *   - `query_cache` (`'query-client'`): holds metadata (`schema`, `user`,
 *     `scope`, `savedAt`) plus ONLY Hoy's boot queries so cold-open IDB
 *     deserialization stays tiny even after warming Planner, Conversations,
 *     Books and road sheets.
 *   - `query_entries`: holds every other query keyed by `queryHash`, written
 *     incrementally (only the queries that changed) and hydrated right after
 *     Hoy's boot set resolves, without blocking first paint.
 *
 * One record per device, owned by one user. It is only good while all of
 * this holds, and wiped as soon as one does not:
 *   - `schema`: the shape of what is kept (`CACHE_SCHEMA`). A deploy that
 *     does not change it keeps the cache (ADR-158).
 *   - `user`: the session user it was written for. Logout, a dead session
 *     and a login as someone else wipe it (`wipeQueryCache`).
 *   - `scope`: the user's workspaces and role in each, when it was written.
 *   - `savedAt`: older than `MAX_AGE_MS`, ignored and wiped.
 */

import { dehydrate, hydrate, type DehydratedState, type Query, type QueryClient } from '@tanstack/svelte-query';
import type { SessionUser } from '$lib/session.svelte';

/** A record, or a query in it, older than this is not shown. */
export const MAX_AGE_MS = 7 * 24 * 3_600_000;
/** At most one write per this long while answers keep arriving. */
export const WRITE_THROTTLE_MS = 1_000;
/** A device store that does not answer in this long is skipped: the open goes to the network. */
export const RESTORE_TIMEOUT_MS = 1_500;

/**
 * The version of the shape of what this cache keeps. BUMP IT BY HAND, in the
 * same commit, whenever a change alters the data a query stores: a response's
 * fields or nesting, a query key that now means something else, or what a
 * `queryFn` makes of the response before returning it. Every device then
 * wipes its record once and starts from the network. A deploy that only
 * changes screens, styles or texts leaves it alone and the cache survives.
 * When in doubt, bump it: the cost is one slow open per device.
 */
export const CACHE_SCHEMA = 38;

/** Query prefixes needed to paint Hoy immediately on open. Everything else
 *  lives in `query_entries` and hydrates right behind Hoy. */
const BOOT_KEY_PREFIXES = new Set([
  'workspaces',
  'projects',
  'lines',
  'me',
  'money-access',
  'conversation-access',
  'pulse-performances',
  'pulse-dates',
  'tasks',
  'conversations',
  'conversation-overview',
  'conversation-tags',
  'planner-team',
  'late-notices',
]);

export function isBootQueryKey(queryKey: readonly unknown[]): boolean {
  const head = queryKey[0];
  if (typeof head !== 'string' || !BOOT_KEY_PREFIXES.has(head)) return false;
  // Keep only the Desk's own conversation read in the boot partition; the
  // Conversations lens pages/filters stay in `query_entries`.
  if (head === 'conversations') return queryKey[1] === 'today';
  return true;
}

export interface PersistedQueryCache {
  schema: number;
  user: SessionUser;
  scope: string;
  savedAt: number;
  state: DehydratedState;
}

export type DehydratedQuery = DehydratedState['queries'][number];

export interface PersistedQueryEntry {
  schema: number;
  userSub: string;
  savedAt: number;
  queryHash: string;
  query: DehydratedQuery;
}

/** Where the record lives: IndexedDB in the app, a Map in the tests. */
export interface QueryCacheStore {
  get(): Promise<PersistedQueryCache | undefined>;
  set(record: PersistedQueryCache): Promise<void>;
  clear(): Promise<void>;
  /** Optional incremental secondary store for non-boot queries. */
  getEntries?(): Promise<PersistedQueryEntry[]>;
  putEntries?(entries: PersistedQueryEntry[]): Promise<void>;
}

/** The workspaces the cached data was read under, with the role in each. Null until known. */
export function scopeOf(client: QueryClient): string | null {
  const data = client.getQueryData<{ items?: { id: string; my_role?: string | null }[] }>(['workspaces']);
  if (!data?.items) return null;
  return data.items
    .map((w) => `${w.id}:${w.my_role ?? ''}`)
    .sort()
    .join(',');
}

export function shouldPersistQuery(query: Query, now = Date.now()): boolean {
  return (
    query.state.status === 'success' &&
    query.meta?.persist !== false &&
    now - query.state.dataUpdatedAt < MAX_AGE_MS
  );
}

/**
 * The newest answer kept under any key that starts with `prefix`, to show
 * while a key that changed (a new day) asks the network: what a calendar
 * does, last known first and the fresh answer behind it (20-11-2026). Hoy's
 * day feeds are keyed by the date, so the first open of each morning, which
 * is the open that matters, found nothing under today's key and waited for
 * the slowest read of the screen. As `placeholderData` it is never written
 * under the new key nor kept on the device: only the real answer is.
 */
export function newestUnder<T>(client: QueryClient, prefix: readonly unknown[]): T | undefined {
  let best: { at: number; data: T } | undefined;
  for (const query of client.getQueryCache().findAll({ queryKey: prefix })) {
    const { data, dataUpdatedAt, status } = query.state;
    if (status !== 'success' || data === undefined) continue;
    if (!best || dataUpdatedAt > best.at) best = { at: dataUpdatedAt, data: data as T };
  }
  return best?.data;
}

// ── Module state: one cache per tab ─────────────────────────────────────

let store: QueryCacheStore | null = null;
let bound: QueryClient | null = null;
let recordRead: Promise<PersistedQueryCache | undefined> | null = null;
/** The scope of the record restored on this open; checked once the network says the real one. */
let restoredScope: string | null = null;
/** This open painted from the device: a crash while painting may be its data. */
let restoredThisOpen = false;
/** Bumped on every wipe: a write or restore that started before it must not land after it. */
let epoch = 0;

/** The device store. Defaults to IndexedDB; the tests pass their own. */
export function setQueryCacheStore(s: QueryCacheStore | null): void {
  store = s;
  recordRead = null;
}

/**
 * Off under an automated browser (as the service worker is), unless the
 * page opts in: an E2E reload must still prove what the server kept, not
 * what this device remembers. `tests/device-cache.spec.ts` opts in.
 */
export const E2E_OPT_IN_KEY = 'hour.e2e.device-cache';
function automatedWithoutOptIn(): boolean {
  if (typeof navigator === 'undefined' || !navigator.webdriver) return false;
  try {
    return localStorage.getItem(E2E_OPT_IN_KEY) !== 'on';
  } catch {
    return true;
  }
}

async function defaultStore(): Promise<QueryCacheStore | null> {
  if (store) return store;
  if (typeof indexedDB === 'undefined' || automatedWithoutOptIn()) return null;
  const { idbQueryCacheStore } = await import('./db');
  store ??= idbQueryCacheStore();
  return store;
}

function withTimeout<T>(p: Promise<T>, ms: number, fallback: T): Promise<T> {
  return Promise.race([p, new Promise<T>((r) => setTimeout(() => r(fallback), ms))]);
}

/**
 * The record on this device if it is still good for this schema and age; a
 * bad one is wiped. Read once per tab (the root page and the /h frame share
 * it). Never throws: a broken store is an empty one.
 */
export function readQueryCache(now = Date.now()): Promise<PersistedQueryCache | undefined> {
  recordRead ??= (async () => {
    const s = await defaultStore().catch(() => null);
    if (!s) return undefined;
    const record = await withTimeout(
      s.get().catch(() => undefined),
      RESTORE_TIMEOUT_MS,
      undefined,
    );
    if (!record) return undefined;
    if (record.schema !== CACHE_SCHEMA || now - record.savedAt > MAX_AGE_MS || !record.user?.sub) {
      await s.clear().catch(() => {});
      return undefined;
    }
    return record;
  })();
  return recordRead;
}

/** The user the device cache belongs to, without hydrating anything. */
export async function cachedSessionUser(): Promise<SessionUser | null> {
  return (await readQueryCache())?.user ?? null;
}

/** Hydrate the secondary `query_entries` store in the background after boot. */
async function hydrateSecondaryEntries(
  client: QueryClient,
  userSub: string,
  startedAt: number,
  now = Date.now(),
): Promise<void> {
  const s = await defaultStore().catch(() => null);
  if (!s?.getEntries || epoch !== startedAt) return;
  const entries = await withTimeout(s.getEntries().catch(() => []), RESTORE_TIMEOUT_MS, []);
  if (epoch !== startedAt || entries.length === 0) return;
  const valid = entries
    .filter((e) => e.schema === CACHE_SCHEMA && e.userSub === userSub && now - e.savedAt < MAX_AGE_MS)
    .map((e) => e.query);
  if (valid.length === 0) return;
  hydrate(client, { mutations: [], queries: valid });
}

/**
 * Hydrate the client from the device and keep writing it back. Returns the
 * user the restored data belongs to (null when nothing was restored), and a
 * stop function for when the frame unmounts.
 */
export function startQueryCache(
  client: QueryClient,
  currentUser: () => SessionUser | null,
): { restored: Promise<SessionUser | null>; stop: () => void } {
  bound = client;
  const startedAt = epoch;
  const restored = readQueryCache().then((record) => {
    if (!record || epoch !== startedAt) return null;
    hydrate(client, record.state);
    restoredScope = record.scope;
    restoredThisOpen = true;
    // The network may have answered the workspaces before the device did.
    if ((client.getQueryState(['workspaces'])?.dataUpdatedAt ?? 0) > record.savedAt) checkScope(client);
    // Secondary lenses hydrate right after boot resolves, off the critical path.
    void hydrateSecondaryEntries(client, record.user.sub, startedAt);
    return record.user;
  });

  let timer: ReturnType<typeof setTimeout> | null = null;
  let bootDirty = false;
  const dirtyEntryHashes = new Set<string>();

  const flush = () => {
    if (timer) clearTimeout(timer);
    timer = null;
    const writeBoot = bootDirty;
    const hashes = [...dirtyEntryHashes];
    bootDirty = false;
    dirtyEntryHashes.clear();
    void flushDirtyQueries(client, currentUser(), { writeBoot, entryHashes: hashes });
  };
  const schedule = () => {
    timer ??= setTimeout(flush, WRITE_THROTTLE_MS);
  };

  const unsubscribe = client.getQueryCache().subscribe((event) => {
    // Only an answer changes what is worth keeping; observers coming and
    // going do not.
    if (event.type !== 'updated' || event.action.type !== 'success') return;
    if (event.query.queryKey[0] === 'workspaces') checkScope(client);
    if (isBootQueryKey(event.query.queryKey)) {
      bootDirty = true;
    } else {
      dirtyEntryHashes.add(event.query.queryHash);
    }
    schedule();
  });
  // A phone closes the app without warning: write what is pending as the
  // page goes to the background.
  const onHide = () => {
    if (document.visibilityState === 'hidden' && timer) flush();
  };
  if (typeof document !== 'undefined') document.addEventListener('visibilitychange', onHide);

  return {
    restored,
    stop: () => {
      unsubscribe();
      if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', onHide);
      if (timer) flush();
    },
  };
}

/**
 * The network has said which workspaces (and roles) the user has. If that is
 * not what the restored data was read under, nothing restored may be trusted:
 * every other query goes back to empty and refetches.
 */
function checkScope(client: QueryClient): void {
  if (restoredScope === null) return;
  const live = scopeOf(client);
  if (live === null) return;
  const before = restoredScope;
  restoredScope = null;
  if (live !== before) void client.resetQueries({ predicate: (q) => q.queryKey[0] !== 'workspaces' });
}

/** Write only what changed: boot record when a boot query updated (or no meta
 *  exists yet), and single entries in `query_entries` for secondary queries. */
async function flushDirtyQueries(
  client: QueryClient,
  user: SessionUser | null,
  dirty: { writeBoot: boolean; entryHashes: readonly string[] },
  now = Date.now(),
): Promise<void> {
  if (!user) return;
  const startedAt = epoch;
  const s = await defaultStore().catch(() => null);
  if (!s || epoch !== startedAt) return;

  // Stores without `putEntries` (legacy in-memory test mocks) keep single-record behavior.
  if (!s.putEntries) {
    await writeQueryCache(client, user, now);
    return;
  }

  const hasBootRecord = Boolean(await recordRead?.catch(() => undefined));
  if (dirty.writeBoot || !hasBootRecord) {
    const bootState = dehydrate(client, {
      shouldDehydrateQuery: (q) => shouldPersistQuery(q, now) && isBootQueryKey(q.queryKey),
      shouldDehydrateMutation: () => false,
    });
    const record: PersistedQueryCache = {
      schema: CACHE_SCHEMA,
      user: { sub: user.sub, email: user.email, name: user.name },
      scope: scopeOf(client) ?? '',
      savedAt: now,
      state: bootState,
    };
    try {
      await s.set(record);
    } catch {
      // Full or private-mode store.
    }
    recordRead = Promise.resolve(epoch === startedAt ? record : undefined);
  }

  if (dirty.entryHashes.length > 0 && epoch === startedAt) {
    const hashSet = new Set(dirty.entryHashes);
    const secondary = dehydrate(client, {
      shouldDehydrateQuery: (q) => shouldPersistQuery(q, now) && !isBootQueryKey(q.queryKey) && hashSet.has(q.queryHash),
      shouldDehydrateMutation: () => false,
    });
    const entries: PersistedQueryEntry[] = secondary.queries.map((query) => ({
      schema: CACHE_SCHEMA,
      userSub: user.sub,
      savedAt: now,
      queryHash: query.queryHash,
      query,
    }));
    if (entries.length > 0) {
      try {
        await s.putEntries(entries);
      } catch {
        // Full or private-mode store.
      }
    }
  }
}

/** Write the client's answers for `user`. No user, no write: a signed-out tab keeps nothing. */
export async function writeQueryCache(client: QueryClient, user: SessionUser | null, now = Date.now()): Promise<void> {
  if (!user) return;
  const startedAt = epoch;
  const s = await defaultStore().catch(() => null);
  if (!s || epoch !== startedAt) return;
  const partitioned = Boolean(s.putEntries);
  const state = dehydrate(client, {
    shouldDehydrateQuery: (q) => shouldPersistQuery(q, now) && (!partitioned || isBootQueryKey(q.queryKey)),
    shouldDehydrateMutation: () => false,
  });
  const record: PersistedQueryCache = {
    schema: CACHE_SCHEMA,
    user: { sub: user.sub, email: user.email, name: user.name },
    scope: scopeOf(client) ?? '',
    savedAt: now,
    state,
  };
  try {
    await s.set(record);
    if (s.putEntries && epoch === startedAt) {
      const secondary = dehydrate(client, {
        shouldDehydrateQuery: (q) => shouldPersistQuery(q, now) && !isBootQueryKey(q.queryKey),
        shouldDehydrateMutation: () => false,
      });
      if (secondary.queries.length > 0) {
        await s.putEntries(
          secondary.queries.map((query) => ({
            schema: CACHE_SCHEMA,
            userSub: user.sub,
            savedAt: now,
            queryHash: query.queryHash,
            query,
          })),
        );
      }
    }
  } catch {
    // A full or private-mode store: the next open goes to the network.
  }
  recordRead = Promise.resolve(epoch === startedAt ? record : undefined);
}

/**
 * Forget everything this device knows: the IndexedDB record, the in-memory
 * cache and the cached session user (it lives in the record). Logout, a
 * session the server refuses, and a login as someone else.
 */
export async function wipeQueryCache(): Promise<void> {
  epoch++;
  restoredScope = null;
  restoredThisOpen = false;
  recordRead = Promise.resolve(undefined);
  bound?.clear();
  const s = await defaultStore().catch(() => null);
  await s?.clear().catch(() => {});
}

/**
 * Login as `user`: the device cache stays only if it is this user's. With no
 * record, whatever is in memory has no known owner, so it goes too.
 */
export async function claimQueryCache(user: SessionUser | null): Promise<void> {
  const owner = await cachedSessionUser();
  if (!user || owner?.sub !== user.sub) await wipeQueryCache();
}

/** The app's one client: a wipe clears its memory too, on any page. */
export function bindQueryCache(client: QueryClient): void {
  bound = client;
}

/** Whether this open painted from the device record (for the open's own timing, ADR-157). */
export function restoredFromDevice(): boolean {
  return restoredThisOpen;
}

const RECOVERED_KEY = 'hour.device-cache.recovered';

/**
 * The frame's error boundary caught a crash. If this open painted from the
 * device, the restored data may be what broke (a shape `CACHE_SCHEMA` should
 * have caught): wipe it and reload once, from the network. Returns false when
 * the crash is not the cache's, or a reload already happened this tab, so
 * the caller lets it through.
 */
export function recoverFromRestoredCrash(): boolean {
  if (!restoredThisOpen) return false;
  try {
    if (sessionStorage.getItem(RECOVERED_KEY)) return false;
    sessionStorage.setItem(RECOVERED_KEY, '1');
  } catch {
    return false;
  }
  void wipeQueryCache().finally(() => location.reload());
  return true;
}
