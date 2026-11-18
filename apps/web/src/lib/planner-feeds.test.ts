import { afterEach, describe, expect, it, vi } from 'vitest';
import { absentFeed, seasonAvailabilityQueryOptions } from './planner-feeds.svelte';

// The feed's own fetch, answered by the test: it rejects the way a real
// fetch does when its signal is aborted.
vi.mock('$lib/api', () => ({
  fetchJSON: (_url: string, signal?: AbortSignal) =>
    new Promise((_resolve, reject) => {
      signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
    }),
}));

/**
 * A CANCELLED FETCH IS NOT AN ABSENT FEED (2026-11-18). Opening the Month or
 * the Agenda cancels the fetches of the window it leaves; the feeds' catch
 * answered each of those with `{ absent: true }` and a «feed absent» warning.
 */
describe('absentFeed', () => {
  afterEach(() => vi.restoreAllMocks());

  it('rethrows when the query was cancelled, and says nothing', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const ctl = new AbortController();
    ctl.abort();
    const err = new DOMException('signal is aborted without reason', 'AbortError');
    expect(() => absentFeed('decisions', err, ctl.signal)).toThrow(err);
    expect(warn).not.toHaveBeenCalled();
  });

  it('lets Unauthorized through, so the session bounce happens', () => {
    const err = new Error('Unauthorized');
    expect(() => absentFeed('notes', err, new AbortController().signal)).toThrow(err);
  });

  it('degrades a real failure to an absent feed, and says so', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const out = absentFeed('availability', new Error('Bad gateway'), new AbortController().signal);
    expect(out).toEqual({ items: [], absent: true });
    expect(warn).toHaveBeenCalledOnce();
  });

  it('holds inside a real feed: a fetch aborted mid-flight rejects', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const ctl = new AbortController();
    const { queryFn } = seasonAvailabilityQueryOptions('2026-11-01', '2026-11-30');
    const pending = queryFn({ signal: ctl.signal });
    ctl.abort();
    await expect(pending).rejects.toThrow();
    expect(warn).not.toHaveBeenCalled();
  });
});
