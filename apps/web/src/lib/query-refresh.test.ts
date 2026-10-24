import { QueryClient, QueryObserver } from '@tanstack/svelte-query';
import { describe, expect, test } from 'vitest';
import { refreshAfterWrite } from './query-refresh';

/**
 * The race of the Conversations lens (2026-10-24), without a browser: a list
 * on its first fetch reads the row before a write commits; the write then
 * asks for the list again.
 */
function setup() {
  let stored = 'contacted';
  const reads: Array<() => void> = [];
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const observer = new QueryObserver<string>(client, {
    queryKey: ['conversations', { q: 'zzz' }],
    // The read takes its value when it leaves and answers when released.
    queryFn: () => {
      const seen = stored;
      return new Promise<string>((resolve) => reads.push(() => resolve(seen)));
    },
  });
  const unsubscribe = observer.subscribe(() => {});
  const write = (value: string) => {
    stored = value;
  };
  const releaseAll = async () => {
    while (reads.length) reads.shift()!();
    await new Promise((r) => setTimeout(r, 0));
  };
  return { client, observer, unsubscribe, write, releaseAll, reads };
}

describe('refreshAfterWrite', () => {
  test('a bare invalidation keeps the first read that left before the write', async () => {
    const s = setup();
    expect(s.reads).toHaveLength(1);
    s.write('not_now');
    const invalidated = s.client.invalidateQueries({ queryKey: ['conversations'] });
    // No second read: the invalidation joined the one on its way.
    expect(s.reads).toHaveLength(1);
    await s.releaseAll();
    await invalidated;
    expect(s.observer.getCurrentResult().data).toBe('contacted');
    s.unsubscribe();
  });

  test('cancelling first reads the list again after the write', async () => {
    const s = setup();
    expect(s.reads).toHaveLength(1);
    s.write('not_now');
    const refreshed = refreshAfterWrite(s.client, ['conversations']);
    await new Promise((r) => setTimeout(r, 0));
    expect(s.reads).toHaveLength(2);
    await s.releaseAll();
    await refreshed;
    expect(s.observer.getCurrentResult().data).toBe('not_now');
    s.unsubscribe();
  });
});
