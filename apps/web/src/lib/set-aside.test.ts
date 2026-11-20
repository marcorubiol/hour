import { describe, expect, it } from 'vitest';
import type { DeskBucket, DeskItem } from './desk-feed';
import { asideUntil, isOld, plusDays, splitWaiting, SET_ASIDE_KEY } from './set-aside';

const item = (id: string, day: string | null): DeskItem => ({ id, day }) as DeskItem;
const bucket = (sortKey: number, ...runs: DeskItem[][]): DeskBucket =>
  ({ sortKey, runs: runs.map((items) => ({ concern: 'task', items })) }) as DeskBucket;

describe('set aside and old (ADR-232)', () => {
  const today = '2026-11-20';

  it('counts calendar days across months and years', () => {
    expect(plusDays('2026-12-30', 3)).toBe('2027-01-02');
    expect(plusDays('2026-11-20', -30)).toBe('2026-10-21');
  });

  it('a row is away until the day it comes back, and here on that day', () => {
    expect(asideUntil({ 'task-a': '2026-11-23' }, 'task-a', today)).toBe('2026-11-23');
    expect(asideUntil({ 'task-a': '2026-11-23' }, 'task-a', '2026-11-23')).toBeNull();
    expect(asideUntil({}, 'task-a', today)).toBeNull();
  });

  it('old is more than a month of waiting; no day is never old', () => {
    expect(isOld({ day: '2026-10-20' }, today)).toBe(true);
    expect(isOld({ day: '2026-10-21' }, today)).toBe(false);
    expect(isOld({ day: null }, today)).toBe(false);
  });

  it('takes the set-aside and the old out of the feed, and drops what is left empty', () => {
    const feed = [
      bucket(-1, [item('task-old', '2026-09-01'), item('task-late', '2026-11-18')]),
      bucket(0, [item('conv-away', today)]),
      bucket(2, [item('task-b', '2026-11-22')]),
    ];
    const split = splitWaiting(feed, { 'conv-away': '2026-11-27', 'task-b': '2026-11-19' }, today);
    expect(split.feed.map((b) => b.runs.flatMap((r) => r.items.map((i) => i.id)))).toEqual([['task-late'], ['task-b']]);
    expect(split.aside.map((a) => [a.item.id, a.until])).toEqual([['conv-away', '2026-11-27']]);
    expect(split.old.map((i) => i.id)).toEqual(['task-old']);
    // Nothing aside or old: the same buckets, untouched.
    expect(splitWaiting(feed.slice(1, 3), {}, today).feed[1]).toBe(feed[2]);
  });

  it('keys are the rows’ own ids', () => {
    for (const k of ['task-0b6e…'.replace('…', '1'), 'conv-abc', 'decision-2026-11-20:a1+b2', 'inv-x'])
      expect(SET_ASIDE_KEY.test(k)).toBe(true);
    expect(SET_ASIDE_KEY.test('anything goes')).toBe(false);
  });
});
