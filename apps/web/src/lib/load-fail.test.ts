import { describe, expect, it, vi } from 'vitest';

vi.mock('$app/navigation', () => ({ goto: vi.fn() }));
vi.mock('$lib/session.svelte', () => ({ clearSession: vi.fn() }));

const { ApiError } = await import('$lib/api');
const { loadFailKind, retryLoad } = await import('./load-fail');

describe('loadFailKind', () => {
  it.each([404, 403])('%i is missing: not there for you', (status) => {
    expect(loadFailKind(new ApiError(status, 'x'))).toBe('missing');
  });
  it.each([500, 502, 503, 400, 409])('%i is a failure, never «does not exist»', (status) => {
    expect(loadFailKind(new ApiError(status, 'boom'))).toBe('failed');
  });
  it('the network (fetch’s TypeError) and anything unknown fail', () => {
    expect(loadFailKind(new TypeError('Failed to fetch'))).toBe('failed');
    expect(loadFailKind(new Error('Not found'))).toBe('failed');
    expect(loadFailKind('boom')).toBe('failed');
  });
});

describe('retryLoad', () => {
  it('never asks again for a missing record', () => {
    expect(retryLoad(0, new ApiError(404, 'Not found'))).toBe(false);
    expect(retryLoad(0, new ApiError(403, 'Forbidden'))).toBe(false);
  });
  it('asks a failure once, then hands over to «Try again»', () => {
    expect(retryLoad(0, new ApiError(500, 'boom'))).toBe(true);
    expect(retryLoad(1, new ApiError(500, 'boom'))).toBe(false);
  });
});

describe('fetchJSON', () => {
  it('throws an ApiError carrying the status, with the message it always had', async () => {
    const { fetchJSON } = await import('$lib/api');
    const reply = (status: number, body: unknown) =>
      vi.fn(async () => new Response(JSON.stringify(body), { status }));
    vi.stubGlobal('fetch', reply(404, {}));
    await expect(fetchJSON('/x')).rejects.toMatchObject({ status: 404, message: 'Not found' });
    vi.stubGlobal('fetch', reply(500, { detail: 'boom' }));
    await expect(fetchJSON('/x')).rejects.toMatchObject({ status: 500, message: 'boom' });
    vi.unstubAllGlobals();
  });
});
