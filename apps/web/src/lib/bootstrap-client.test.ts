import { QueryClient } from '@tanstack/svelte-query';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { applyBootstrapPayload, bootstrapDatesFrom, hydrateFromBootstrap } from './bootstrap-client';
import { moneyAccessAnyQueryOptions } from './bolo-queries';
import { conversationAccessQueryOptions } from './conversation-access';
import { setAside } from './set-aside.svelte';

vi.mock('./api', () => ({
  fetchJSON: vi.fn(),
}));

import { fetchJSON } from './api';

describe('bootstrap-client', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.mocked(fetchJSON).mockReset();
  });

  it('computes datesFrom 14 days before today', () => {
    expect(bootstrapDatesFrom('2026-11-20')).toBe('2026-11-06');
  });

  it('seeds all existing TanStack query keys and setAside state without altering shapes', () => {
    const client = new QueryClient();
    applyBootstrapPayload(
      client,
      {
        workspaces: { items: [{ id: 'w1', slug: 'muk' }] },
        projects: { items: [{ id: 'p1', slug: 'mamemi' }] },
        lines: { items: [{ id: 'l1' }] },
        me: { person_id: 'per1', full_name: 'Marco', dossiers: [] },
        money_access: { read_money: true },
        conversation_access: { read: true, edit: true },
        set_aside: { items: { 'task-1': '2026-11-25' } },
        performances: { items: [{ id: 'pf1' }] },
        dates: { items: [{ id: 'd1' }] },
        tasks: { items: [{ id: 't1' }] },
        conversations: { limit: 500, offset: 0, items: [{ id: 'c1' }] },
      },
      { today: '2026-11-20', datesFrom: '2026-11-06' },
      123_456,
    );

    expect(client.getQueryData(['workspaces'])).toEqual({ items: [{ id: 'w1', slug: 'muk' }] });
    expect(client.getQueryData(['projects', { status: 'active' }])).toEqual({ items: [{ id: 'p1', slug: 'mamemi' }] });
    expect(client.getQueryData(['lines', 'all'])).toEqual({ items: [{ id: 'l1' }] });
    expect(client.getQueryData(['me'])).toEqual({ person_id: 'per1', full_name: 'Marco', dossiers: [] });
    expect(client.getQueryData(moneyAccessAnyQueryOptions().queryKey)).toEqual({ read_money: true });
    expect(client.getQueryData(conversationAccessQueryOptions().queryKey)).toEqual({ read: true, edit: true });
    expect(client.getQueryData(['pulse-performances', '2026-11-20'])).toEqual({ items: [{ id: 'pf1' }] });
    expect(client.getQueryData(['pulse-dates', '2026-11-06'])).toEqual({ items: [{ id: 'd1' }] });
    expect(client.getQueryData(['tasks', 'open'])).toEqual({ items: [{ id: 't1' }] });
    expect(client.getQueryData(['conversations', 'today'])).toEqual({ limit: 500, offset: 0, items: [{ id: 'c1' }] });
    expect(setAside.ready).toBe(true);
    expect(setAside.items['task-1']).toBe('2026-11-25');
  });

  it('aborts and returns false when /api/bootstrap exceeds the timeout ceiling', async () => {
    vi.useFakeTimers();
    let observedSignal: AbortSignal | undefined;
    vi.mocked(fetchJSON).mockImplementation((_url, signal) => {
      observedSignal = signal;
      return new Promise((_resolve, reject) => {
        signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
      });
    });

    const client = new QueryClient();
    const pending = hydrateFromBootstrap(client, '2026-11-20', 4_500);
    expect(observedSignal?.aborted).toBe(false);

    await vi.advanceTimersByTimeAsync(4_500);
    expect(observedSignal?.aborted).toBe(true);
    expect(await pending).toBe(false);
    expect(client.getQueryData(['workspaces'])).toBeUndefined();
  });

  it('hydrates and returns true when /api/bootstrap answers within the ceiling', async () => {
    vi.mocked(fetchJSON).mockResolvedValueOnce({
      workspaces: { items: [{ id: 'w1', slug: 'muk' }] },
    });

    const client = new QueryClient();
    expect(await hydrateFromBootstrap(client, '2026-11-20', 4_500)).toBe(true);
    expect(client.getQueryData(['workspaces'])).toEqual({ items: [{ id: 'w1', slug: 'muk' }] });
  });
});
