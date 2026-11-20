import { QueryClient } from '@tanstack/svelte-query';
import { describe, expect, test, vi } from 'vitest';
import { scopeExpensesQueryOptions } from './bolo-queries';
import { conversationFeedQueryOptions } from './conversation-feed-query';
import { lensWarmReads, lineSparesData, warmLenses, type LensWarmInput } from './lens-warm';
import {
  agendaFeedOptions,
  agendaSeedWindow,
  decisionsFeedOptions,
  gridFeedOptions,
  monthSeedWindow,
} from './planner-feeds.svelte';

const now = new Date('2026-11-20T10:00:00Z');
const base: LensWarmInput = {
  planner: true,
  conversations: true,
  books: true,
  filterIds: { projectIds: ['p1'], workspaceIds: [] },
  plannerView: null,
  now,
  todayIso: '2026-11-20',
};
const keys = (input: LensWarmInput) => lensWarmReads(input).map((r) => JSON.stringify(r.queryKey));

describe('lensWarmReads: what the frame asks before the first tap', () => {
  test('the keys are the sections’ own, under the scope', () => {
    const { from, to } = agendaSeedWindow(now, '2026-11-20');
    expect(from).toBe('2026-11-20');
    expect(to).toBe('2026-11-30');
    const book = agendaFeedOptions({ from, to, unresolved: false, ...base.filterIds });
    const got = keys(base);
    for (const read of [book.performances, book.dates, book.availability, book.notes]) {
      expect(got).toContain(JSON.stringify(read.queryKey));
    }
    expect(got).toContain(JSON.stringify(conversationFeedQueryOptions(base.filterIds).queryKey));
    expect(got).toContain(JSON.stringify(conversationFeedQueryOptions(base.filterIds, { tag: 'team' }).queryKey));
    expect(got).toContain(JSON.stringify(scopeExpensesQueryOptions(base.filterIds).queryKey));
  });

  test('the list’s key is the one the chats list has always used', () => {
    expect(conversationFeedQueryOptions({ projectIds: [], workspaceIds: ['w'] }).queryKey).toEqual([
      'conversation-feed',
      [],
      ['w'],
      '',
      100,
      null,
    ]);
  });

  test('a section that is off, on screen or not readable is not asked', () => {
    expect(keys({ ...base, planner: false }).some((k) => k.includes('planner-agenda'))).toBe(false);
    expect(keys({ ...base, conversations: false }).some((k) => k.includes('conversation-feed'))).toBe(false);
    expect(keys({ ...base, books: false }).some((k) => k.includes('expenses'))).toBe(false);
    expect(lensWarmReads({ ...base, planner: false, conversations: false, books: false })).toEqual([]);
  });

  test('the Month reads its own window: the book is not asked for it; the Board has no notes', () => {
    expect(keys({ ...base, plannerView: 'month' }).some((k) => k.includes('planner-agenda'))).toBe(false);
    expect(keys(base).some((k) => k.includes('"planner-performances"'))).toBe(false);
    const board = keys({ ...base, plannerView: 'board' });
    expect(board.some((k) => k.includes('planner-agenda-performances'))).toBe(true);
    expect(board.some((k) => k.includes('planner-agenda-notes'))).toBe(false);
  });
});

describe('lineSparesData', () => {
  test('stays out when offline, on data saver or on 2g', () => {
    expect(lineSparesData(undefined)).toBe(true);
    expect(lineSparesData({ onLine: true })).toBe(true);
    expect(lineSparesData({ onLine: false })).toBe(false);
    expect(lineSparesData({ connection: { saveData: true, effectiveType: '4g' } })).toBe(false);
    expect(lineSparesData({ connection: { effectiveType: '2g' } })).toBe(false);
    expect(lineSparesData({ connection: { effectiveType: 'slow-2g' } })).toBe(false);
    expect(lineSparesData({ connection: { effectiveType: '3g' } })).toBe(true);
  });
});

describe('warmLenses', () => {
  const client = () => new QueryClient({ defaultOptions: { queries: { retry: false } } });

  test('reads one at a time and leaves each answer under its key', async () => {
    const c = client();
    let running = 0;
    let most = 0;
    const read = (name: string) => ({
      queryKey: [name],
      queryFn: async () => {
        running += 1;
        most = Math.max(most, running);
        await new Promise((r) => setTimeout(r, 1));
        running -= 1;
        return { name };
      },
    });
    await warmLenses(c, [read('a'), read('b'), read('c')], () => false);
    expect(most).toBe(1);
    expect(c.getQueryData(['b'])).toEqual({ name: 'b' });
  });

  test('a fresh answer is not asked again', async () => {
    const c = client();
    c.setQueryData(['a'], { kept: true });
    const queryFn = vi.fn(async () => ({ kept: false }));
    await warmLenses(c, [{ queryKey: ['a'], queryFn }], () => false);
    expect(queryFn).not.toHaveBeenCalled();
    expect(c.getQueryData(['a'])).toEqual({ kept: true });
  });

  test('a failure leaves no error under the key, and the rest still go', async () => {
    const c = client();
    await warmLenses(
      c,
      [
        { queryKey: ['bad'], queryFn: async () => Promise.reject(new Error('403')) },
        { queryKey: ['good'], queryFn: async () => 1 },
      ],
      () => false,
    );
    expect(c.getQueryState(['bad'])).toBeUndefined();
    expect(c.getQueryData(['good'])).toBe(1);
  });

  test('stops when cancelled', async () => {
    const c = client();
    const queryFn = vi.fn(async () => 1);
    await warmLenses(c, [{ queryKey: ['a'], queryFn }], () => true);
    expect(queryFn).not.toHaveBeenCalled();
  });
});

describe('lensWarmReads: the Month and what is pending', () => {
  test('a person who opens in the Month gets the Month’s window, under its own keys', () => {
    const { from, to } = monthSeedWindow(now);
    expect(from <= '2026-11-01').toBe(true);
    expect(to >= '2027-01-31').toBe(true);
    const grid = gridFeedOptions({ from, to, unresolved: false, ...base.filterIds });
    const got = keys({ ...base, plannerView: 'month' });
    for (const read of [grid.performances, grid.dates, grid.availability]) {
      expect(got).toContain(JSON.stringify(read.queryKey));
    }
  });

  test('the decisions window is asked whatever the drawing', () => {
    const key = JSON.stringify(decisionsFeedOptions({ unresolved: false, ...base.filterIds }, '2026-11-20').queryKey);
    for (const plannerView of [null, 'agenda', 'board', 'month'] as const) {
      expect(keys({ ...base, plannerView })).toContain(key);
    }
    expect(keys({ ...base, planner: false })).not.toContain(key);
  });
});
