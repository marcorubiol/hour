import { describe, expect, it, vi } from 'vitest';
import { allowNativeRequest, allowRequest, type NativeRateLimiter } from './rate-limit';

describe('allowNativeRequest', () => {
  it('allows local development when the binding is absent', async () => {
    await expect(allowNativeRequest(undefined, 'login:127.0.0.1')).resolves.toBe(true);
  });

  it('uses the supplied key and returns the native decision', async () => {
    const limit = vi.fn().mockResolvedValue({ success: false });
    const limiter: NativeRateLimiter = { limit };

    await expect(allowNativeRequest(limiter, 'login:203.0.113.7')).resolves.toBe(false);
    expect(limit).toHaveBeenCalledOnce();
    expect(limit).toHaveBeenCalledWith({ key: 'login:203.0.113.7' });
  });

  it('fails open on a transient native-service error', async () => {
    const limiter: NativeRateLimiter = {
      limit: vi.fn().mockRejectedValue(new Error('rate limit unavailable')),
    };

    await expect(allowNativeRequest(limiter, 'login:203.0.113.8')).resolves.toBe(true);
  });
});

describe('allowRequest', () => {
  it('offloads kv.put to waitUntil when provided so responses do not block on KV writes', async () => {
    let resolvePut!: () => void;
    const putPromise = new Promise<void>((r) => {
      resolvePut = r;
    });
    const kv = {
      get: vi.fn().mockResolvedValue('2'),
      put: vi.fn().mockReturnValue(putPromise),
    } as unknown as KVNamespace;
    const background: Promise<unknown>[] = [];

    const allowed = await allowRequest(kv, 'session:1.2.3.4', { limit: 10, windowSec: 300 }, (p) => background.push(p));
    expect(allowed).toBe(true);
    expect(background).toHaveLength(1);
    expect(kv.put).toHaveBeenCalledOnce();
    resolvePut();
    await Promise.all(background);
  });
});
