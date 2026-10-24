import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

// The session module keeps its renewal state in module memory: each test
// imports a fresh copy (with api.ts on top of it) after `vi.resetModules()`.
vi.mock('$app/navigation', () => ({ goto: vi.fn() }));

type Handler = (url: string, init?: RequestInit) => Response | Promise<Response>;

const HOUR = 3_600_000;
let calls: string[];

function json(body: unknown, init: { status?: number; date?: number } = {}): Response {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (init.date !== undefined) headers.date = new Date(init.date).toUTCString();
  return new Response(JSON.stringify(body), { status: init.status ?? 200, headers });
}

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

function route(handler: Handler) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      calls.push(`${init?.method ?? 'GET'} ${url}`);
      return handler(url, init);
    }),
  );
}

const count = (needle: string) => calls.filter((c) => c.endsWith(needle) || c.includes(`${needle}?`)).length;
const user = { sub: 'u1', email: 'a@b.c', name: null };

async function load() {
  vi.resetModules();
  const session = await import('./session.svelte');
  const api = await import('./api');
  return { ...session, ...api };
}

beforeEach(() => {
  calls = [];
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('getAccessToken', () => {
  test('one request for concurrent callers, then the token in hand until its last minute', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const now = Date.now();
    route(() => json({ token: 't1', expiresAt: now + HOUR }));
    const { getAccessToken } = await load();

    const [a, b] = await Promise.all([getAccessToken(), getAccessToken()]);
    expect([a, b]).toEqual(['t1', 't1']);
    expect(count('/api/auth/token')).toBe(1);

    vi.setSystemTime(now + HOUR - 61_000);
    expect(await getAccessToken()).toBe('t1');
    expect(count('/api/auth/token')).toBe(1);

    // Under a minute left: ask again (the endpoint renews the cookie).
    vi.setSystemTime(now + HOUR - 59_000);
    await getAccessToken();
    expect(count('/api/auth/token')).toBe(2);
  });

  test('waits for the boot probe on the wire instead of renewing alongside it', async () => {
    const probe = deferred<Response>();
    route((url) => (url === '/api/auth/session' ? probe.promise : json({ token: 't', expiresAt: Date.now() + HOUR })));
    const { ensureSession, getAccessToken } = await load();

    void ensureSession();
    const token = getAccessToken();
    await Promise.resolve();
    expect(count('/api/auth/token')).toBe(0);

    probe.resolve(json({ user, expiresAt: Date.now() + HOUR }));
    expect(await token).toBe('t');
    expect(calls).toEqual(['GET /api/auth/session', 'GET /api/auth/token']);
  });

  test('a failed token request is not cached', async () => {
    route(() => json({ error: 'no_session' }, { status: 401 }));
    const { getAccessToken } = await load();
    expect(await getAccessToken()).toBeNull();
    expect(await getAccessToken()).toBeNull();
    expect(count('/api/auth/token')).toBe(2);
  });
});

describe('fetchJSON and the renewal', () => {
  test('401s while the boot probe renews the cookie join it: no refresh, one retry each', async () => {
    const probe = deferred<Response>();
    let renewed = false;
    route((url) => {
      if (url === '/api/auth/session') return probe.promise;
      if (url === '/api/auth/refresh') return json({ user, expiresAt: Date.now() + HOUR });
      return renewed ? json({ items: [url] }) : json({ error: 'expired' }, { status: 401 });
    });
    const { ensureSession, fetchJSON } = await load();

    void ensureSession();
    const reads = ['/api/workspaces', '/api/lines', '/api/projects'].map((u) => fetchJSON<{ items: string[] }>(u));
    await new Promise((r) => setTimeout(r, 0));
    renewed = true;
    probe.resolve(json({ user, expiresAt: Date.now() + HOUR }));

    const out = await Promise.all(reads);
    expect(out.map((o) => o.items[0])).toEqual(['/api/workspaces', '/api/lines', '/api/projects']);
    expect(count('/api/auth/refresh')).toBe(0);
    expect(count('/api/workspaces')).toBe(2);
  });

  test('a 401 that left before a renewal landed retries without renewing again', async () => {
    const read = deferred<Response>();
    route((url) => {
      if (url === '/api/auth/session') return json({ user, expiresAt: Date.now() + HOUR });
      if (url === '/api/slow') return read.promise;
      return json({ ok: true });
    });
    const { ensureSession, fetchJSON } = await load();

    const slow = fetchJSON('/api/slow');
    await new Promise((r) => setTimeout(r, 2));
    await ensureSession(); // the probe vouches for the cookie after /api/slow left
    read.resolve(json({ error: 'expired' }, { status: 401 }));
    route(() => json({ ok: true }));
    await expect(slow).resolves.toEqual({ ok: true });
    expect(count('/api/auth/refresh')).toBe(0);
  });

  test('a cookie known to be dead is renewed once before the reads, not after three 401s', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const now = Date.now();
    let alive = false;
    route((url) => {
      if (url === '/api/auth/session') return json({ user, expiresAt: now + HOUR }, { date: now });
      if (url === '/api/auth/refresh') {
        alive = true;
        return json({ user, expiresAt: Date.now() + HOUR }, { date: Date.now() });
      }
      return alive ? json({ ok: true }) : json({ error: 'expired' }, { status: 401 });
    });
    const { ensureSession, fetchJSON } = await load();
    await ensureSession();

    // An hour later (a phone that slept): the reads find the session renewed first.
    vi.setSystemTime(now + HOUR + 1_000);
    await Promise.all([fetchJSON('/api/a'), fetchJSON('/api/b'), fetchJSON('/api/c')]);
    expect(count('/api/auth/refresh')).toBe(1);
    expect(calls.filter((c) => /\/api\/[abc]$/.test(c))).toHaveLength(3);
  });

  test('concurrent 401s with no renewal in sight share one refresh', async () => {
    let alive = false;
    const refresh = deferred<Response>();
    route((url) => {
      if (url === '/api/auth/refresh') return refresh.promise;
      return alive ? json({ ok: true }) : json({ error: 'expired' }, { status: 401 });
    });
    const { fetchJSON } = await load();

    const reads = [fetchJSON('/api/a'), fetchJSON('/api/b'), fetchJSON('/api/c')];
    await new Promise((r) => setTimeout(r, 0));
    alive = true;
    refresh.resolve(json({ user, expiresAt: Date.now() + HOUR }));
    await Promise.all(reads);
    expect(count('/api/auth/refresh')).toBe(1);
  });

  test('the server clock decides the expiry: a phone an hour fast does not renew on every read', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const serverNow = Date.now();
    vi.setSystemTime(serverNow + HOUR); // this phone runs an hour ahead
    route((url) => {
      if (url === '/api/auth/session') return json({ user, expiresAt: serverNow + 30 * 60_000 }, { date: serverNow });
      return json({ ok: true });
    });
    const { ensureSession, fetchJSON } = await load();
    await ensureSession();
    await fetchJSON('/api/a');
    expect(count('/api/auth/refresh')).toBe(0);
  });

  test('a dead session still bounces: refresh refused, cleared, sent to /login', async () => {
    route((url) => (url === '/api/auth/refresh' ? json({ error: 'no_session' }, { status: 401 }) : json({}, { status: 401 })));
    const { fetchJSON, session } = await load();
    const { goto } = await import('$app/navigation');
    await expect(fetchJSON('/api/a')).rejects.toMatchObject({ status: 401 });
    expect(count('/api/auth/refresh')).toBe(1);
    expect(session.user).toBeNull();
    expect(goto).toHaveBeenCalledWith('/login', { replaceState: true });
  });
});

describe('probe outcome (device cache, ADR-144)', () => {
  test('a 401 is a refusal; no answer is not', async () => {
    route(() => json({ error: 'no_session' }, { status: 401 }));
    let s = await load();
    await s.ensureSession();
    expect(s.probeOutcome()).toBe('denied');

    route(() => {
      throw new TypeError('Failed to fetch');
    });
    s = await load();
    await s.ensureSession();
    expect(s.probeOutcome()).toBe('unreachable');

    route(() => json({ error: 'rate_limited' }, { status: 429 }));
    s = await load();
    await s.ensureSession();
    expect(s.probeOutcome()).toBe('unreachable');
  });

  test('the cached user paints only until the server names one', async () => {
    route(() => json({ user, expiresAt: Date.now() + HOUR }));
    const s = await load();
    s.adoptCachedUser({ sub: 'cached', email: null, name: null });
    expect(s.session.user?.sub).toBe('cached');
    await s.ensureSession();
    expect(s.session.user?.sub).toBe('u1');
    s.adoptCachedUser({ sub: 'cached', email: null, name: null });
    expect(s.session.user?.sub).toBe('u1');
  });

  test('painted from the cache, a read waits for the probe instead of collecting a 401', async () => {
    const probe = deferred<Response>();
    route((url) => (url.endsWith('/api/auth/session') ? probe.promise : json({ ok: true })));
    const s = await load();
    void s.ensureSession();
    s.adoptCachedUser({ sub: 'u1', email: null, name: null });
    const read = s.fetchJSON('/api/thing');
    await Promise.resolve();
    expect(count('/api/thing')).toBe(0);
    probe.resolve(json({ user, expiresAt: Date.now() + HOUR }));
    await read;
    expect(count('/api/thing')).toBe(1);
  });
});
