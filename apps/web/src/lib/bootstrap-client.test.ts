import { QueryClient } from '@tanstack/svelte-query';
import { describe, expect, it } from 'vitest';
import { applyBootstrapPayload, bootstrapDatesFrom } from './bootstrap-client';
import { moneyAccessAnyQueryOptions } from './bolo-queries';
import { conversationAccessQueryOptions } from './conversation-access';
import { setAside } from './set-aside.svelte';

describe('bootstrap-client', () => {
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
});
