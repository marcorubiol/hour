/**
 * The query cache kept on the device (ADR-144).
 *
 * Every open used to start blank and wait for the network: the frame painted
 * in half a second and the lens two to three later. Now the last-known
 * answers of every read live in IndexedDB; an open hydrates them before the
 * lens mounts, so it paints what it showed last time, and the queries
 * refetch behind it (they are stale: stale-while-revalidate is TanStack's own
 * behaviour once a query has data).
 *
 * One record per device, owned by one user. It is only good while all of
 * this holds, and wiped as soon as one does not:
 *   - `schema`: the shape of what is kept (`CACHE_SCHEMA`). A deploy that
 *     does not change it keeps the cache (ADR-158, amending ADR-144 § 3: the
 *     build SHA wiped it on every deploy, and the first open after each one
 *     waited for the whole network again). The frame's error boundary is
 *     the second net: an open that throws while painting restored data
 *     wipes it and reloads (`recoverFromRestoredCrash`).
 *   - `user`: the session user it was written for. Logout, a dead session
 *     and a login as someone else wipe it (`wipeQueryCache`).
 *   - `scope`: the user's workspaces and role in each, when it was written.
 *     It cannot be checked before the network answers, so it is checked when
 *     it does: a membership or role that changed resets every other query.
 *   - `savedAt`: older than `MAX_AGE_MS`, ignored and wiped.
 *
 * What is never kept: mutations, a query that has not succeeded, and a query
 * that opts out with `meta: { persist: false }`. Auth never goes through
 * TanStack (tokens are module memory in `$lib/session.svelte`), so no token
 * can land here.
 *
 * The record also carries the session user (`sub`, `email`, `name`: what
 * `/api/auth/session` returns, nothing secret), so the frame can paint before
 * the session probe answers.
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
export const CACHE_SCHEMA = 18;

export interface PersistedQueryCache {
  schema: number;
  user: SessionUser;
  scope: string;
  savedAt: number;
  state: DehydratedState;
}

/** Where the record lives: IndexedDB in the app, a Map in the tests. */
export interface QueryCacheStore {
  get(): Promise<PersistedQueryCache | undefined>;
  set(record: PersistedQueryCache): Promise<void>;
  clear(): Promise<void>;
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
    return record.user;
  });

  let timer: ReturnType<typeof setTimeout> | null = null;
  const flush = () => {
    if (timer) clearTimeout(timer);
    timer = null;
    void writeQueryCache(client, currentUser());
  };
  const schedule = () => {
    timer ??= setTimeout(flush, WRITE_THROTTLE_MS);
  };

  const unsubscribe = client.getQueryCache().subscribe((event) => {
    // Only an answer changes what is worth keeping; observers coming and
    // going do not.
    if (event.type !== 'updated' || event.action.type !== 'success') return;
    if (event.query.queryKey[0] === 'workspaces') checkScope(client);
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

/** Write the client's answers for `user`. No user, no write: a signed-out tab keeps nothing. */
export async function writeQueryCache(client: QueryClient, user: SessionUser | null, now = Date.now()): Promise<void> {
  if (!user) return;
  const startedAt = epoch;
  const s = await defaultStore().catch(() => null);
  if (!s || epoch !== startedAt) return;
  const state = dehydrate(client, {
    shouldDehydrateQuery: (q) => shouldPersistQuery(q, now),
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
