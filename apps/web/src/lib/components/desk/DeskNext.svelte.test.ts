/**
 * La tarjeta de Hoy es para hoy (ADR-153): sin nada que quede de hoy, no hay
 * tarjeta ni agenda de otro día; lo siguiente es una fila de «Después».
 */
import { QueryClient } from '@tanstack/svelte-query';
import { cleanup, render } from '@testing-library/svelte';
import { afterEach, describe, expect, it } from 'vitest';
import DeskNext from './DeskNext.svelte';
import { agendaDay, dayAgenda } from '$lib/day-agenda';
import { upcoming } from '$lib/pulse';
import { pulseSlipContext } from '$lib/pulse-feeds.svelte';
import type { PerformanceEvent } from '$lib/month-events';

const TZ = 'Europe/Madrid';

// A bolo guest's hold on Tuesday, no hour on file: all they may have.
const hold: PerformanceEvent = {
  id: 'p-hold',
  slug: 'p-hold',
  performed_at: '2026-08-18',
  status: 'hold_1',
  start_at: null,
  venue_name: 'Teatre de Salt',
  city: 'Girona',
  country: null,
  line_id: null,
  project: { id: 'pr-gota', name: 'Gota', workspace_id: 'ws-a' } as PerformanceEvent['project'],
  venue: { timezone: TZ } as PerformanceEvent['venue'],
};

function mount(now: Date, today: string) {
  const input = { performances: [hold], dates: [], viewerTz: TZ };
  const coming = upcoming(input, now, 12);
  const on = agendaDay(input, now);
  const agenda = on ? dayAgenda(input, on, now) : null;
  return render(DeskNext, {
    props: {
      agenda,
      after: coming.filter((x) => x.day !== on).slice(0, 3),
      settled: true,
      errored: false,
      onretry: () => {},
      today,
      viewerTz: TZ,
      now,
      slipCtx: pulseSlipContext([], TZ, (k) => k),
      workspaces: [],
      locale: 'es',
    },
    context: new Map([['$$_queryClient', new QueryClient({ defaultOptions: { queries: { enabled: false } } })]]),
  });
}

describe('DeskNext: la tarjeta es para hoy (ADR-153)', () => {
  afterEach(cleanup);
  it('with nothing left of today, no card and no agenda: the hold is a row of «Después»', () => {
    // Saturday 15 at 23h30 in Madrid (21h30Z).
    const r = mount(new Date('2026-08-15T21:30:00Z'), '2026-08-15');
    expect(r.queryByTestId('desk-next')).toBeNull();
    expect(r.queryByTestId('desk-agenda')).toBeNull();
    expect(r.getByTestId('desk-after').textContent).toContain('Teatre de Salt');
  });

  it('on its own day it is the card', () => {
    const r = mount(new Date('2026-08-18T08:00:00Z'), '2026-08-18');
    expect(r.getByTestId('desk-next')).toBeTruthy();
    expect(r.queryByTestId('desk-after')).toBeNull();
  });
});
