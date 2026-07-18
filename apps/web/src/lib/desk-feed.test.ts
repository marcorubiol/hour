import { describe, expect, it } from 'vitest';
import {
  buildDeskFeed,
  dayBucket,
  deskSummary,
  type DeskConcern,
  type DeskConvInput,
  type DeskDateInput,
  type DeskInvoiceInput,
  type DeskPerfInput,
} from './desk-feed';
import type { TaskItem } from './task';

// Friday 2026-07-17, 10:00 — LOCAL constructor so calendar-day math is
// deterministic in any test timezone.
const NOW = new Date(2026, 6, 17, 10, 0, 0);

function isoDay(offset: number): string {
  const d = new Date(2026, 6, 17 + offset);
  const m = String(d.getMonth() + 1).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${String(d.getDate()).padStart(2, '0')}`;
}
/** A date-only field (midnight UTC — `.slice(0,10)` is the day in any zone). */
function actionAt(offset: number): string {
  return `${isoDay(offset)}T00:00:00+00:00`;
}
/** A wall-clock timestamp (start_at / starts_at), LOCAL like NOW. */
function at(offset: number, hour = 0): string {
  return new Date(2026, 6, 17 + offset, hour, 0, 0).toISOString();
}

function conv(id: string, o: Partial<DeskConvInput> = {}): DeskConvInput {
  return {
    id,
    status: 'contacted',
    next_action_at: null,
    next_action_note: null,
    person: { full_name: 'Anna Prat', organization_name: null, slug: 'anna-prat' },
    project: { id: 'p1', slug: 'mamemi', name: 'MaMeMi' },
    ...o,
  };
}
function perf(id: string, o: Partial<DeskPerfInput> = {}): DeskPerfInput {
  return {
    id,
    slug: `perf-${id}`,
    performed_at: isoDay(0),
    status: 'confirmed',
    venue_name: null,
    city: null,
    load_in_at: null,
    soundcheck_at: null,
    start_at: null,
    loadout_at: null,
    wrap_at: null,
    venue: null,
    project: { id: 'p1', slug: 'mamemi', name: 'MaMeMi', workspace_id: 'w1' },
    ...o,
  };
}
function dateEv(id: string, o: Partial<DeskDateInput> = {}): DeskDateInput {
  return {
    id,
    kind: 'rehearsal',
    status: 'confirmed',
    title: null,
    starts_at: at(0, 12),
    all_day: false,
    city: null,
    performance_id: null,
    project: { id: 'p1', slug: 'mamemi', name: 'MaMeMi' },
    ...o,
  };
}
function invoice(id: string, o: Partial<DeskInvoiceInput> = {}): DeskInvoiceInput {
  return {
    id,
    number: 'F-001',
    status: 'issued',
    due_on: actionAt(-3),
    total: 1800,
    currency: 'EUR',
    payer: { full_name: 'Festival Grec', organization_name: null },
    project: { id: 'p1', slug: 'mamemi', name: 'MaMeMi' },
    ...o,
  };
}
function task(id: string, o: Partial<TaskItem> = {}): TaskItem {
  return {
    id,
    title: `Task ${id}`,
    status: 'open',
    origin: 'manual',
    due_at: null,
    from_at: null,
    lead_days: null,
    note: null,
    project: null,
    line: null,
    performance: null,
    conversation: null,
    ...o,
  } as unknown as TaskItem;
}

const EMPTY = { conversations: [], tasks: [], performances: [], dates: [] };

describe('dayBucket', () => {
  it('keys overdue / today / tomorrow / weekday / anytime', () => {
    expect(dayBucket(isoDay(-1), NOW, 'en').labelKey).toBe('overdue');
    expect(dayBucket(isoDay(0), NOW, 'en')).toMatchObject({ sortKey: 0, labelKey: 'today' });
    expect(dayBucket(isoDay(1), NOW, 'en')).toMatchObject({ sortKey: 1, labelKey: 'tomorrow' });
    expect(dayBucket(isoDay(3), NOW, 'en')).toMatchObject({ labelKey: 'weekday', weekday: 'Monday' });
    expect(dayBucket(null, NOW, 'en')).toMatchObject({ sortKey: 99, labelKey: 'anytime' });
  });
});

describe('buildDeskFeed — banners', () => {
  it("today's and tomorrow's gigs are bucket anchors, not rows", () => {
    const feed = buildDeskFeed(
      {
        ...EMPTY,
        performances: [
          perf('today', { venue: { name: 'Kursaal' }, start_at: at(0, 20) }),
          perf('tmrw', { performed_at: isoDay(1), venue: { name: 'Ateneu' }, start_at: at(1, 21) }),
        ],
      },
      NOW,
      'en',
    );
    expect(feed.find((b) => b.sortKey === 0)!.anchor).toMatchObject({ venue: 'Kursaal' });
    expect(feed.find((b) => b.sortKey === 0)!.runs).toEqual([]);
    expect(feed.find((b) => b.sortKey === 1)!.anchor).toMatchObject({ venue: 'Ateneu' });
  });

  it('a gig beyond tomorrow is an AGENDA row; past gigs drop', () => {
    const feed = buildDeskFeed(
      {
        ...EMPTY,
        performances: [
          perf('far', { performed_at: isoDay(3), venue: { name: 'Sala' }, start_at: at(3, 20) }),
          perf('past', { performed_at: isoDay(-2), venue: { name: 'Gone' } }),
        ],
      },
      NOW,
      'en',
    );
    expect(feed.map((b) => b.sortKey)).toEqual([3]);
    expect(feed[0].runs[0]).toMatchObject({ concern: 'agenda' });
    expect(feed[0].runs[0].items[0]).toMatchObject({ subject: 'Sala', atISO: at(3, 20) });
  });
});

describe('buildDeskFeed — agenda dates', () => {
  it('pure date events are agenda rows; a gig-slot date (performance_id) is dropped', () => {
    const feed = buildDeskFeed(
      {
        ...EMPTY,
        dates: [
          dateEv('ev', { starts_at: at(2, 18), title: 'Assaig' }),
          dateEv('slot', { starts_at: at(2, 20), performance_id: 'perf-x' }),
        ],
      },
      NOW,
      'en',
    );
    const rows = feed.flatMap((b) => b.runs).flatMap((r) => r.items);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ concern: 'agenda', subject: 'Assaig' });
  });
});

describe('buildDeskFeed — fixed within-day order', () => {
  it('OVERDUE keeps task → conversation → money', () => {
    const feed = buildDeskFeed(
      {
        conversations: [conv('c', { next_action_at: actionAt(-1) })],
        tasks: [task('t', { due_at: actionAt(-1) })],
        performances: [],
        dates: [],
        invoices: [invoice('i', { due_on: actionAt(-2) })],
      },
      NOW,
      'en',
    );
    const overdue = feed.find((b) => b.sortKey === -1)!;
    expect(overdue.runs.map((r) => r.concern)).toEqual(['task', 'conversation', 'money']);
    expect(overdue.runs[2].items[0]).toMatchObject({ concern: 'money', verbKey: 'remind', amount: 1800 });
  });

  it('a future bucket keeps task → agenda → conversation', () => {
    const feed = buildDeskFeed(
      {
        conversations: [conv('c', { status: 'hold', next_action_at: actionAt(3) })],
        tasks: [task('t', { due_at: actionAt(3) })],
        performances: [perf('p', { performed_at: isoDay(3), venue: { name: 'Sala' }, start_at: at(3, 20) })],
        dates: [],
      },
      NOW,
      'en',
    );
    const b = feed.find((x) => x.sortKey === 3)!;
    expect(b.runs.map((r) => r.concern)).toEqual(['task', 'agenda', 'conversation']);
    expect(b.runs[2].items[0]).toMatchObject({ verbKey: 'confirm', subject: 'Anna Prat' });
  });
});

describe('buildDeskFeed — tasks, AI, money', () => {
  it('dormant and done tasks are out; an AI task is a proposal ghost', () => {
    const feed = buildDeskFeed(
      {
        ...EMPTY,
        tasks: [
          task('done', { status: 'done', due_at: actionAt(0) }),
          task('sleep', { from_at: actionAt(5), due_at: actionAt(10), lead_days: 1 }),
          task('ai', { origin: 'ai', note: 'París en un mes · 20 contactes', due_at: actionAt(0) }),
        ],
      },
      NOW,
      'en',
    );
    const rows = feed.flatMap((b) => b.runs).flatMap((r) => r.items);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ isProposal: true, reason: 'París en un mes · 20 contactes' });
  });

  it('money: only issued invoices past due surface; paid ones ignored; no invoices → no money', () => {
    const withMoney = buildDeskFeed(
      { ...EMPTY, invoices: [invoice('overdue'), invoice('paid', { status: 'paid', due_on: actionAt(-9) })] },
      NOW,
      'en',
    );
    const money = withMoney.flatMap((b) => b.runs).filter((r) => r.concern === 'money');
    expect(money).toHaveLength(1);
    expect(money[0].items).toHaveLength(1);

    const noMoney = buildDeskFeed(EMPTY, NOW, 'en');
    expect(noMoney.flatMap((b) => b.runs).some((r) => r.concern === 'money')).toBe(false);
  });

  it('undated open task lands in the anytime tail', () => {
    const feed = buildDeskFeed({ ...EMPTY, tasks: [task('t')] }, NOW, 'en');
    expect(feed.map((b) => b.sortKey)).toEqual([99]);
  });
});

describe('buildDeskFeed — revive on quiet days', () => {
  it('offers dormant conversations only when no overdue and no show today', () => {
    const quiet = buildDeskFeed(
      { ...EMPTY, conversations: [conv('d', { status: 'dormant', person: { full_name: 'CC Brugge', organization_name: null, slug: 'cc' } })] },
      NOW,
      'en',
    );
    const revive = quiet.flatMap((b) => b.runs).flatMap((r) => r.items).filter((i) => i.verbKey === 'revive');
    expect(revive).toHaveLength(1);
    expect(revive[0]).toMatchObject({ isProposal: true, subject: 'CC Brugge' });

    // With an overdue call present, no revive.
    const loud = buildDeskFeed(
      {
        ...EMPTY,
        conversations: [conv('d', { status: 'dormant' }), conv('o', { next_action_at: actionAt(-1) })],
      },
      NOW,
      'en',
    );
    expect(loud.flatMap((b) => b.runs).flatMap((r) => r.items).some((i) => i.verbKey === 'revive')).toBe(false);
  });
});

describe('deskSummary', () => {
  it('needYou counts dated items (anytime excluded); pipeline sums open invoices', () => {
    const s = deskSummary(
      {
        conversations: [
          conv('a', { next_action_at: actionAt(-2) }), // overdue
          conv('b', { status: 'hold', next_action_at: actionAt(0) }), // today + hold
          conv('c', { next_action_at: actionAt(5) }), // future
        ],
        tasks: [task('dated', { due_at: actionAt(0) }), task('anytime')],
        performances: [perf('p', { performed_at: isoDay(2), city: 'Balsareny' })],
        dates: [],
        invoices: [invoice('open', { total: 1800, status: 'issued' }), invoice('paid', { total: 999, status: 'paid' })],
      },
      NOW,
    );
    expect(s).toMatchObject({
      needYou: 5, // 3 convs + 1 dated task + 1 overdue invoice; anytime task excluded
      overdue: 2, // 1 conv + 1 invoice
      nextShowCity: 'Balsareny',
      holds: 1,
      live: 3,
      pipeline: 1800,
      currency: 'EUR',
    });
  });

  it('pipeline is null when fees are not visible (no invoices passed)', () => {
    expect(deskSummary({ ...EMPTY, conversations: [conv('a', { next_action_at: actionAt(0) })] }, NOW).pipeline).toBeNull();
  });
});
