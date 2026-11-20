import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import DeskWaiting from './DeskWaiting.svelte';
import type { DeskItem } from '$lib/desk-feed';

const item = (over: Partial<DeskItem> & Pick<DeskItem, 'id' | 'subject'>): DeskItem => ({
  concern: 'conversation',
  verbKey: 'reply',
  projectName: '—',
  lineName: null,
  projectId: null,
  overdue: false,
  conversationId: null,
  workspaceId: null,
  href: null,
  taskId: null,
  taskDone: false,
  surfacesDay: null,
  dueDay: null,
  dueLabel: null,
  isProposal: false,
  reason: null,
  amount: null,
  currency: null,
  day: '2026-11-20',
  repliedAt: null,
  tagName: null,
  option: null,
  ...over,
});

function setup(onaside = vi.fn()) {
  const here = item({ id: 'conv-here', subject: 'Teatro Arriaga' });
  const away = item({ id: 'conv-away', subject: 'Sala Beckett' });
  const old = item({ id: 'conv-old', subject: 'Festival de Otoño', day: '2026-09-01' });
  render(DeskWaiting, {
    waiting: { rows: [here], total: 1, asking: 1, overdue: 0 },
    rows: 3,
    today: '2026-11-20',
    feed: [],
    later: null,
    loading: false,
    errored: false,
    onretry: () => {},
    locale: 'en',
    contextPath: () => '',
    conversationHref: () => null,
    money: (n: number) => String(n),
    isGhost: () => false,
    ontoggle: () => {},
    onremove: () => {},
    onaccept: () => {},
    aside: [{ item: away, until: '2026-11-21' }],
    old: [old],
    onaside,
  });
  return { here, away, onaside };
}

describe('Te espera: «Ahora no» and the old (ADR-232)', () => {
  afterEach(cleanup);
  it('a row is set aside for the span picked, counted from today', async () => {
    const { here, onaside } = setup();
    await fireEvent.click(screen.getByRole('button', { name: 'Not now: Teatro Arriaga' }));
    await fireEvent.click(screen.getByRole('menuitem', { name: 'Three days' }));
    expect(onaside).toHaveBeenCalledWith(here, '2026-11-23');
  });

  it('what is set aside folds at the foot, says when it comes back, and comes back now', async () => {
    const { away, onaside } = setup();
    const fold = screen.getByTestId('desk-aside');
    expect(fold.textContent).toContain('Set aside · 1');
    expect(screen.queryByText('Sala Beckett')).toBeNull();
    await fireEvent.click(fold);
    expect(screen.getByText('back tomorrow')).toBeTruthy();
    await fireEvent.click(screen.getByRole('button', { name: 'Bring back: Sala Beckett' }));
    expect(onaside).toHaveBeenCalledWith(away, null);
  });

  it('the old fold is closed until opened', async () => {
    setup();
    const fold = screen.getByTestId('desk-old');
    expect(fold.textContent).toContain('Old · 1');
    expect(screen.queryByText('Festival de Otoño')).toBeNull();
    await fireEvent.click(fold);
    expect(screen.getByText('Festival de Otoño')).toBeTruthy();
  });
});
