import { describe, expect, it, vi } from 'vitest';
import { allowNativeRequest, type NativeRateLimiter } from './rate-limit';

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
