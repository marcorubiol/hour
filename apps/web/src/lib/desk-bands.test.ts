import { describe, expect, it } from 'vitest';
import { changedBandLoading, changedLensChip, changesSince, elapsedSince, paymentNews, paymentsSinceEarlier, plannerDoor, sinceInstant, todayThings, CHANGED_ROWS } from './desk-bands';
import type { MoneyBolo } from './money';

describe('changedBandLoading', () => {
  const base = { errored: false, pending: [false, false, false], mailoutPending: false, hasChanges: false };

  it('waits for the mailout only when it has nothing else to show', () => {
    expect(changedBandLoading({ ...base, mailoutPending: true })).toBe(true);
    expect(changedBandLoading({ ...base, mailoutPending: true, hasChanges: true })).toBe(false);
  });

  it('never says «nothing new» before the mailout has answered, and settles once it has', () => {
    expect(changedBandLoading({ ...base, mailoutPending: true })).toBe(true);
    expect(changedBandLoading({ ...base, mailoutPending: false })).toBe(false);
  });

  it('any other pending source holds the band, with or without news', () => {
    expect(changedBandLoading({ ...base, pending: [false, true, false], hasChanges: true })).toBe(true);
  });

  it('an error is not loading', () => {
    expect(changedBandLoading({ ...base, errored: true, pending: [true, false, false], mailoutPending: true })).toBe(false);
  });
});
import type { DateEvent, PerformanceEvent } from './month-events';
import type { HotRow, LastMailout } from './conversation-overview';
import type { FeedThread } from './threads';
import type { Change } from './desk-bands';

const NOW = new Date('2026-10-15T10:00:00Z');
const TODAY = '2026-10-15';
const project = { id: 'p1', slug: 'mamemi', name: 'MaMeMi', workspace_id: 'w1' };

function perf(id: string, day: string, o: Partial<PerformanceEvent> = {}): PerformanceEvent {
  return {
    id,
    slug: id,
    performed_at: day,
    status: 'confirmed',
    start_at: `${day}T18:00:00Z`,
    venue_name: 'Kursaal',
    city: 'Manresa',
    country: 'ES',
    line_id: null,
    project,
    venue: null,
    ...o,
  };
}
function date(id: string, day: string, o: Partial<DateEvent> = {}): DateEvent {
  return {
    id,
    kind: 'rehearsal',
    status: 'confirmed',
    title: null,
    starts_at: `${day}T00:00:00Z`,
    all_day: true,
    venue_name: null,
    city: null,
    project,
    venue: null,
    ...o,
  };
}

describe('changesSince — «Ha cambiado»', () => {
  const since = '2026-10-14T18:00:00Z';
  const thread = (id: string, at: string, unread: number) =>
    ({ thread_id: id, last_message_at: at, unread_count: unread }) as unknown as FeedThread;
  const hot = (id: string, at: string, turn: 'ours' | 'theirs') =>
    ({ id, at, turn, title: id, workspace_id: 'w1' }) as unknown as HotRow;

  it('threads with new messages after the visit, rooms whose last word is theirs, newest first', () => {
    const out = changesSince(
      {
        threads: [thread('new', '2026-10-15T08:00:00Z', 2), thread('read', '2026-10-15T09:00:00Z', 0), thread('old', '2026-10-13T08:00:00Z', 4)],
        hot: [hot('replied', '2026-10-15T09:30:00Z', 'ours'), hot('waiting', '2026-10-15T09:40:00Z', 'theirs'), hot('before', '2026-10-14T10:00:00Z', 'ours')],
        lastMailout: null,
      },
      since,
      NOW,
    );
    expect(out.map((c) => c.kind + ':' + (c.kind === 'thread' ? c.thread.thread_id : c.kind === 'reply' ? c.row.id : ''))).toEqual([
      'reply:replied',
      'thread:new',
    ]);
  });

  it('a reply «Te espera» already holds is not news twice', () => {
    const out = changesSince(
      { threads: [], hot: [hot('waiting', '2026-10-15T09:30:00Z', 'ours'), hot('other', '2026-10-15T09:40:00Z', 'ours')], lastMailout: null },
      since,
      NOW,
      new Set(['waiting']),
    );
    expect(out.map((c) => (c.kind === 'reply' ? c.row.id : c.kind))).toEqual(['other']);
  });

  it('the last send is news for two weeks, whatever the visit', () => {
    const m = (queued: string, recipients = 40) => ({ id: 'm', queued_at: queued, figures: { recipients } }) as unknown as LastMailout;
    expect(changesSince({ threads: [], hot: [], lastMailout: m('2026-10-05T10:00:00Z') }, since, NOW)).toHaveLength(1);
    expect(changesSince({ threads: [], hot: [], lastMailout: m('2026-09-20T10:00:00Z') }, since, NOW)).toHaveLength(0);
    // A send that reached nobody is not news.
    expect(changesSince({ threads: [], hot: [], lastMailout: m('2026-10-05T10:00:00Z', 0) }, since, NOW)).toHaveLength(0);
  });

  it('the way into Conversations goes to the chip the news share (ADR-138 fase 3)', () => {
    const reply = (id: string, tags: string[]): Change => ({ kind: 'reply', at: since, row: { ...hot(id, since, 'ours'), tags } });
    const th: Change = { kind: 'thread', at: since, thread: thread('t', since, 1) };
    expect(changedLensChip([])).toBeNull();
    expect(changedLensChip([th])).toBe('team');
    expect(changedLensChip([reply('a', ['press']), reply('b', ['press'])])).toBe('press');
    // No tag is Difusión.
    expect(changedLensChip([reply('a', []), reply('b', ['sales'])])).toBe('sales');
    expect(changedLensChip([reply('a', ['press']), reply('b', ['sales'])])).toBe('all');
    expect(changedLensChip([reply('a', ['press', 'sales'])])).toBe('all');
    expect(changedLensChip([th, reply('a', ['press'])])).toBe('all');
  });

  it('at most five lines', () => {
    const threads = Array.from({ length: 8 }, (_, i) => thread(`t${i}`, `2026-10-15T0${i}:00:00Z`, 1));
    expect(changesSince({ threads, hot: [], lastMailout: null }, since, NOW)).toHaveLength(CHANGED_ROWS);
  });

  it('the last visit reads in minutes, then hours, then days', () => {
    const at = (ms: number) => new Date(NOW.getTime() - ms).toISOString();
    expect(elapsedSince(at(20_000), NOW)).toEqual({ unit: 'min', n: 1 });
    expect(elapsedSince(at(42 * 60_000), NOW)).toEqual({ unit: 'min', n: 42 });
    expect(elapsedSince(at(3 * 3_600_000 + 5 * 60_000), NOW)).toEqual({ unit: 'h', n: 3 });
    expect(elapsedSince(at(50 * 3_600_000), NOW)).toEqual({ unit: 'd', n: 2 });
  });

  it('with no visit on file, since is a week back', () => {
    expect(sinceInstant(null, NOW)).toBe('2026-10-08T10:00:00.000Z');
    expect(sinceInstant('garbage', NOW)).toBe('2026-10-08T10:00:00.000Z');
    expect(sinceInstant(since, NOW)).toBe('2026-10-14T18:00:00.000Z');
  });
});

describe('plannerDoor — the Planner census, its window', () => {
  it('carries the Planner figures and counts travel days inside the window', () => {
    const fig = plannerDoor(
      { confirmed: 3, holds: 2, clashes: 1 },
      {
        dates: [
          date('t', '2026-10-16', { kind: 'travel_day' }),
          date('x', '2026-10-18', { kind: 'travel_day', status: 'cancelled' }),
          date('far', '2027-03-01', { kind: 'travel_day' }),
          date('r', '2026-10-16'),
        ],
        viewerTz: 'UTC',
      },
      { from: TODAY, to: '2027-01-03' },
    );
    expect(fig).toEqual({ confirmed: 3, holds: 2, clashes: 1, travel: 1 });
  });
});

describe('paymentNews — «cobrado», named by its deal', () => {
  const bolo: MoneyBolo = {
    id: 'b1',
    project_id: 'p1',
    line_id: null,
    conversation_id: null,
    venue_name: 'Kursaal',
    city: 'Manresa',
    country: 'ES',
    fee_amount: 3000,
    fee_currency: 'EUR',
    status: 'confirmed',
    collected: 0,
    function_count: 1,
    first_performed_at: null,
    last_performed_at: null,
    project: { ...project, accent: null },
  };
  const bolos = new Map([['b1', bolo]]);
  const invoices = new Map([
    ['i1', { currency: 'USD', lines: [{ bolo_id: 'b1' }], payer: { id: 'o', slug: 'o', name: 'Teatre', fiscal_identity_id: null } }],
    ['i2', { currency: 'EUR', lines: [], payer: { id: 'o2', slug: 'o2', name: 'Festival', fiscal_identity_id: null } }],
  ]);

  it('names a payment by its bolo, straight or through its invoice, in the invoice currency first', () => {
    const out = paymentNews(
      [
        { id: 'x', invoice_id: null, bolo_id: 'b1', amount: 500, created_at: '2026-10-15T09:00:00Z' },
        { id: 'y', invoice_id: 'i1', bolo_id: null, amount: 200, created_at: '2026-10-15T09:30:00Z' },
        { id: 'z', invoice_id: 'i2', bolo_id: null, amount: 80, created_at: '2026-10-15T09:40:00Z' },
        { id: 'neg', invoice_id: null, bolo_id: 'b1', amount: 0, created_at: '2026-10-15T09:50:00Z' },
      ],
      bolos,
      invoices,
    );
    expect(out.map((p) => [p.id, p.bolo?.id ?? null, p.currency, p.payer])).toEqual([
      ['x', 'b1', 'EUR', null],
      ['y', 'b1', 'USD', 'Teatre'],
      ['z', null, 'EUR', 'Festival'],
    ]);
  });

  it('enters «Ha cambiado» only after the last visit', () => {
    const news = paymentNews(
      [
        { id: 'new', invoice_id: null, bolo_id: 'b1', amount: 500, created_at: '2026-10-15T09:00:00Z' },
        { id: 'old', invoice_id: null, bolo_id: 'b1', amount: 500, created_at: '2026-10-14T09:00:00Z' },
      ],
      bolos,
      invoices,
    );
    const out = changesSince({ threads: [], hot: [], lastMailout: null, payments: news }, '2026-10-15T08:00:00Z', NOW);
    expect(out.map((c) => (c.kind === 'payment' ? c.payment.id : c.kind))).toEqual(['new']);
  });
});

describe('todayThings — the title says the day, not the debt (ADR-139 § 6)', () => {
  const input = (performances: PerformanceEvent[], dates: DateEvent[]) => ({ performances, dates, viewerTz: 'Europe/Madrid' });

  it('names what today is: the confirmed show first, then the confirmed dates', () => {
    const things = todayThings(
      input(
        [perf('show', TODAY), perf('hold', TODAY, { status: 'hold_1' }), perf('tomorrow', '2026-10-16')],
        [date('trip', TODAY, { kind: 'travel_day', destination_city: 'Girona' }), date('maybe', TODAY, { status: 'tentative' })],
      ),
      TODAY,
    );
    expect(things).toEqual([
      { of: 'performance', kind: 'show', label: null, where: 'Manresa' },
      { of: 'date', kind: 'travel_day', label: null, where: 'Girona' },
    ]);
  });

  it('an «other» date names itself; nothing settled is an empty day', () => {
    expect(todayThings(input([], [date('o', TODAY, { kind: 'other', title: 'Reunió de producció' })]), TODAY)).toEqual([
      { of: 'date', kind: 'other', label: 'Reunió de producció', where: null },
    ]);
    expect(todayThings(input([perf('opt', TODAY, { status: 'proposed' })], []), TODAY)).toEqual([]);
  });
});

describe('paymentsSinceEarlier', () => {
  const pay = (id: string, created_at: string) => ({ id, invoice_id: null, bolo_id: null, amount: 1, created_at });
  const ws = ['w1'];
  it('the newest earlier answer over the same spaces, cut to this instant', () => {
    const cached = [
      [['desk-payments', '2026-10-01T00:00:00.000Z', ws], { items: [pay('old', '2026-10-02T00:00:00Z')] }],
      [
        ['desk-payments', '2026-10-20T00:00:00.000Z', ws],
        { items: [pay('a', '2026-10-21T00:00:00+00:00'), pay('b', '2026-10-23T00:00:00+00:00')] },
      ],
      [['desk-payments', '2026-10-23T12:00:00.000Z', ['w2']], { items: [pay('other', '2026-10-24T00:00:00Z')] }],
      [['desk-payments', '2026-10-25T00:00:00.000Z', ws], { items: [pay('future', '2026-10-26T00:00:00Z')] }],
    ] as const;
    expect(paymentsSinceEarlier(cached, '2026-10-22T00:00:00.000Z', ws)?.items.map((p) => p.id)).toEqual(['b']);
  });
  it('nothing earlier, no placeholder', () => {
    expect(paymentsSinceEarlier([], '2026-10-22T00:00:00.000Z', ws)).toBeUndefined();
  });
});
