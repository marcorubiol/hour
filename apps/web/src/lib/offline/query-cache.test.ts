import { QueryClient } from '@tanstack/svelte-query';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type { PersistedQueryCache, QueryCacheStore } from './query-cache';

// The module keeps one cache per tab in module memory: each test imports a
// fresh copy over its own in-memory store (IndexedDB is the app's store).

const A = { sub: 'user-a', email: 'a@x.y', name: 'A' };
const B = { sub: 'user-b', email: 'b@x.y', name: 'B' };
const WS = { items: [{ id: 'w1', slug: 'w1', name: 'W1', my_role: 'owner' }] };
const DAY = 24 * 3_600_000;

function memoryStore() {
  let record: PersistedQueryCache | undefined;
  const store: QueryCacheStore & { peek: () => PersistedQueryCache | undefined } = {
    get: async () => (record ? structuredClone(record) : undefined),
    set: async (r) => {
      record = structuredClone(r);
    },
    clear: async () => {
      record = undefined;
    },
    peek: () => record,
  };
  return store;
}

async function load(store = memoryStore()) {
  vi.resetModules();
  const mod = await import('./query-cache');
  mod.setQueryCacheStore(store);
  return { ...mod, store };
}

const client = () => new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: DAY } } });

/** A client that has read the workspaces and one lens feed. */
function warm(c = client()) {
  c.setQueryData(['workspaces'], WS);
  c.setQueryData(['bolos', 'w1'], { items: [{ id: 'b1', fee: 1200 }] });
  return c;
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
});
afterEach(() => {
  vi.useRealTimers();
});

describe('buster', () => {
  test('a dirty build is only itself; a clean one is its SHA', async () => {
    const { buildIdOf } = await load();
    expect(buildIdOf({ sha: 'abc1234', dirty: false, builtAt: 't1' })).toBe('abc1234');
    expect(buildIdOf({ sha: 'abc1234', dirty: true, builtAt: 't1' })).not.toBe(
      buildIdOf({ sha: 'abc1234', dirty: true, builtAt: 't2' }),
    );
  });

  test('a record of another build is wiped, not restored', async () => {
    const { store, writeQueryCache, readQueryCache, setQueryCacheStore } = await load();
    await writeQueryCache(warm(), A);
    store.peek()!.build = 'some-older-build';
    setQueryCacheStore(store); // forget the memoized read
    expect(await readQueryCache()).toBeUndefined();
    expect(store.peek()).toBeUndefined();
  });

  test('a record older than the max age is wiped, not restored', async () => {
    const { store, writeQueryCache, readQueryCache, setQueryCacheStore, MAX_AGE_MS } = await load();
    await writeQueryCache(warm(), A);
    vi.setSystemTime(Date.now() + MAX_AGE_MS + 1);
    setQueryCacheStore(store);
    expect(await readQueryCache()).toBeUndefined();
    expect(store.peek()).toBeUndefined();
  });

  test('the scope is the workspaces with the role in each', async () => {
    const { scopeOf } = await load();
    const c = client();
    expect(scopeOf(c)).toBeNull();
    c.setQueryData(['workspaces'], { items: [{ id: 'w2', my_role: 'member' }, { id: 'w1', my_role: 'owner' }] });
    expect(scopeOf(c)).toBe('w1:owner,w2:member');
  });
});

describe('restore', () => {
  test('hydrates the last answers before the network: data at once, stale so it refetches', async () => {
    const first = await load();
    await first.writeQueryCache(warm(), A);
    const { startQueryCache } = await load(first.store);

    const c = client();
    const { restored } = startQueryCache(c, () => A);
    expect(await restored).toEqual(A);
    expect(c.getQueryData(['bolos', 'w1'])).toEqual({ items: [{ id: 'b1', fee: 1200 }] });
    const q = c.getQueryCache().find({ queryKey: ['bolos', 'w1'] })!;
    expect(q.state.status).toBe('success');
    expect(q.state.fetchStatus).toBe('idle');
    vi.advanceTimersByTime(30_001);
    expect(q.isStaleByTime(30_000)).toBe(true);
  });

  test('keeps only successful queries, never mutations, and honours meta.persist = false', async () => {
    const { store, writeQueryCache } = await load();
    const c = warm();
    await c.prefetchQuery({ queryKey: ['draft'], queryFn: async () => ({ secret: 1 }), meta: { persist: false } });
    await c.prefetchQuery({ queryKey: ['broken'], queryFn: () => Promise.reject(new Error('x')) });
    c.getMutationCache().build(c, { mutationKey: ['save'] });
    await writeQueryCache(c, A);
    const keys = store.peek()!.state.queries.map((q) => q.queryKey[0]);
    expect(keys.sort()).toEqual(['bolos', 'workspaces']);
    expect(store.peek()!.state.mutations).toEqual([]);
  });

  test('a changed membership or role resets everything restored once the workspaces answer', async () => {
    const first = await load();
    await first.writeQueryCache(warm(), A);
    const { startQueryCache } = await load(first.store);

    const c = client();
    await startQueryCache(c, () => A).restored;
    expect(c.getQueryData(['bolos', 'w1'])).toBeDefined();
    // The network says: still in w1, but no longer owner.
    vi.advanceTimersByTime(10);
    await c.fetchQuery({
      queryKey: ['workspaces'],
      queryFn: async () => ({ items: [{ id: 'w1', slug: 'w1', name: 'W1', my_role: 'viewer' }] }),
      staleTime: 0,
    });
    expect(c.getQueryData(['bolos', 'w1'])).toBeUndefined();
  });

  test('the same scope keeps what was restored', async () => {
    const first = await load();
    await first.writeQueryCache(warm(), A);
    const { startQueryCache } = await load(first.store);

    const c = client();
    await startQueryCache(c, () => A).restored;
    vi.advanceTimersByTime(10);
    await c.fetchQuery({ queryKey: ['workspaces'], queryFn: async () => WS, staleTime: 0 });
    expect(c.getQueryData(['bolos', 'w1'])).toBeDefined();
  });
});

describe('writes', () => {
  test('throttled: a burst of answers is one write', async () => {
    const { store, startQueryCache } = await load();
    const set = vi.spyOn(store, 'set');
    const c = client();
    startQueryCache(c, () => A);
    await vi.advanceTimersByTimeAsync(0);
    warm(c);
    c.setQueryData(['team'], { items: [] });
    expect(set).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(set).toHaveBeenCalledTimes(1);
    expect(store.peek()!.user).toEqual(A);
    expect(store.peek()!.scope).toBe('w1:owner');
  });

  test('no user, no write', async () => {
    const { store, writeQueryCache } = await load();
    await writeQueryCache(warm(), null);
    expect(store.peek()).toBeUndefined();
  });
});

describe('wipe', () => {
  test('logout clears the device record, the memory and the cached user', async () => {
    const { store, writeQueryCache, wipeQueryCache, bindQueryCache, cachedSessionUser } = await load();
    const c = warm();
    bindQueryCache(c);
    await writeQueryCache(c, A);
    expect(await cachedSessionUser()).toEqual(A);

    await wipeQueryCache();
    expect(store.peek()).toBeUndefined();
    expect(c.getQueryCache().getAll()).toHaveLength(0);
    expect(await cachedSessionUser()).toBeNull();
  });

  test('a write pending at logout does not bring the data back', async () => {
    let user: typeof A | null = A;
    const { store, startQueryCache, wipeQueryCache } = await load();
    const c = client();
    startQueryCache(c, () => user);
    await vi.advanceTimersByTimeAsync(0);
    warm(c); // schedules a write
    user = null;
    await wipeQueryCache();
    await vi.advanceTimersByTimeAsync(2_000);
    expect(store.peek()).toBeUndefined();
  });

  test('a restore that started before the wipe does not hydrate after it', async () => {
    const first = await load();
    await first.writeQueryCache(warm(), A);
    const { startQueryCache, wipeQueryCache } = await load(first.store);
    const c = client();
    const { restored } = startQueryCache(c, () => null);
    await wipeQueryCache();
    expect(await restored).toBeNull();
    expect(c.getQueryData(['bolos', 'w1'])).toBeUndefined();
  });

  test('login as another user wipes the first one’s cache; the same user keeps it', async () => {
    const { store, writeQueryCache, claimQueryCache } = await load();
    await writeQueryCache(warm(), A);
    await claimQueryCache(A);
    expect(store.peek()?.user).toEqual(A);
    await claimQueryCache(B);
    expect(store.peek()).toBeUndefined();
  });
});
