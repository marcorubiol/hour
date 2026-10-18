import { describe, expect, it } from 'vitest';
import {
  buildDeskFeed,
  dayBucket,
  goingItem,
  invoiceHref,
  laterSummary,
  overdueInvoices,
  rankWaiting,
  type DeskConvInput,
  type DeskInvoiceInput,
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
/** Issued 30 days ago, due three days ago, no payments, on bolo b1. */
function invoice(id: string, o: Partial<DeskInvoiceInput> = {}): DeskInvoiceInput {
  return {
    id,
    workspace_id: 'w1',
    project_id: 'p1',
    payer_organization_id: null,
    payer_fiscal_identity_id: null,
    doc_type: 'factura',
    number: 'F-001',
    status: 'issued',
    issued_on: isoDay(-30),
    due_on: isoDay(-3),
    expected_on: null,
    payment_condition: null,
    subtotal: 1800,
    total: 1800,
    currency: 'EUR',
    country: 'ES',
    tax_lines: [],
    notes: null,
    paid_amount: 0,
    payer: null,
    project: { id: 'p1', slug: 'mamemi', name: 'MaMeMi', workspace_id: 'w1' },
    lines: [{ bolo_id: 'b1' }],
    payments: [],
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

const EMPTY = { conversations: [], tasks: [] };

describe('dayBucket', () => {
  it('keys overdue / today / tomorrow / weekday / anytime', () => {
    expect(dayBucket(isoDay(-1), NOW, 'en').labelKey).toBe('overdue');
    expect(dayBucket(isoDay(0), NOW, 'en')).toMatchObject({ sortKey: 0, labelKey: 'today' });
    expect(dayBucket(isoDay(1), NOW, 'en')).toMatchObject({ sortKey: 1, labelKey: 'tomorrow' });
    expect(dayBucket(isoDay(3), NOW, 'en')).toMatchObject({ labelKey: 'weekday', weekday: 'Monday' });
    expect(dayBucket(null, NOW, 'en')).toMatchObject({ sortKey: 99, labelKey: 'anytime' });
  });
});

describe('buildDeskFeed — fixed within-day order', () => {
  it('OVERDUE keeps task → conversation → money', () => {
    const feed = buildDeskFeed(
      {
        conversations: [conv('c', { next_action_at: actionAt(-1) })],
        tasks: [task('t', { due_at: actionAt(-1) })],
        invoices: [invoice('i', { due_on: isoDay(-2) })],
      },
      NOW,
      'en',
    );
    const overdue = feed.find((b) => b.sortKey === -1)!;
    expect(overdue.runs.map((r) => r.concern)).toEqual(['task', 'conversation', 'money']);
    expect(overdue.runs[2].items[0]).toMatchObject({ concern: 'money', verbKey: 'remind', amount: 1800 });
  });

  it('a future bucket keeps task → conversation, and no agenda (ADR-117: that is the Planner)', () => {
    const feed = buildDeskFeed(
      {
        conversations: [conv('c', { status: 'hold', next_action_at: actionAt(3) })],
        tasks: [task('t', { due_at: actionAt(3) })],
      },
      NOW,
      'en',
    );
    const b = feed.find((x) => x.sortKey === 3)!;
    expect(b.runs.map((r) => r.concern)).toEqual(['task', 'conversation']);
    expect(b.runs[1].items[0]).toMatchObject({ verbKey: 'confirm', subject: 'Anna Prat' });
  });

  it('ADR-102: a conversation is titled by its organization, also without a person', () => {
    const feed = buildDeskFeed(
      {
        conversations: [
          conv('c', { status: 'hold', next_action_at: actionAt(3), organization: { name: 'Teatro Pradillo' } }),
          conv('d', { status: 'hold', next_action_at: actionAt(3), person: null, organization: { name: 'Sala Beckett' } }),
        ],
        tasks: [],
      },
      NOW,
      'en',
    );
    const items = feed.find((x) => x.sortKey === 3)!.runs[0].items;
    expect(items.map((i) => i.subject).sort()).toEqual(['Sala Beckett', 'Teatro Pradillo']);
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

  it('money: only issued invoices past the date Cuentas expects surface; paid ones ignored; no invoices → no money', () => {
    const withMoney = buildDeskFeed(
      { ...EMPTY, invoices: [invoice('overdue'), invoice('paid', { status: 'paid', due_on: isoDay(-9) })] },
      NOW,
      'en',
    );
    const money = withMoney.flatMap((b) => b.runs).filter((r) => r.concern === 'money');
    expect(money).toHaveLength(1);
    expect(money[0].items).toHaveLength(1);
    expect(money[0].items[0]).toMatchObject({ href: '/h/books#bolo-b1', amount: 1800 });

    const noMoney = buildDeskFeed(EMPTY, NOW, 'en');
    expect(noMoney.flatMap((b) => b.runs).some((r) => r.concern === 'money')).toBe(false);
  });

  it('ADR-117 § 4: vencido is the aging, not due_on (an explicit expected date wins)', () => {
    const late = invoice('a', { due_on: isoDay(10), expected_on: isoDay(-1) });
    const notYet = invoice('b', { due_on: isoDay(-5), expected_on: isoDay(5) });
    const partly = invoice('c', {
      total: 1000,
      payments: [{ id: 'pay', invoice_id: 'c', amount: 400, received_on: isoDay(-20) } as never],
    });
    const rows = overdueInvoices([late, notYet, partly], NOW);
    expect(rows.map((r) => r.invoice.id).sort()).toEqual(['a', 'c']);
    expect(rows.find((r) => r.invoice.id === 'c')!.owed).toBe(600);
  });

  it('an invoice with no bolo opens the lens', () => {
    expect(invoiceHref({ lines: [{ bolo_id: null }] })).toBe('/h/books');
  });

  it('a task with only «desde» that has surfaced is today, never overdue, and has no when', () => {
    const feed = buildDeskFeed({ ...EMPTY, tasks: [task('from', { from_at: actionAt(-6) })] }, NOW, 'en');
    expect(feed.map((b) => b.sortKey)).toEqual([0]);
    const row = feed[0].runs[0].items[0];
    expect(row).toMatchObject({ overdue: false, dueDay: null, dueLabel: null });
    expect(rankWaiting(feed, NOW).overdue).toBe(0);
  });

  it('a conversation call carries its conversation, so the row opens it (not the person)', () => {
    const feed = buildDeskFeed({ ...EMPTY, conversations: [conv('c9', { workspace_id: 'w1', next_action_at: actionAt(1) })] }, NOW, 'en');
    expect(feed[0].runs[0].items[0]).toMatchObject({ conversationId: 'c9', workspaceId: 'w1', href: null });
  });

  it('a reply waiting for us sits today, most recent first, and replaces its next-action call', () => {
    const feed = buildDeskFeed(
      {
        conversations: [conv('c1', { next_action_at: actionAt(4) }), conv('c3', { next_action_at: actionAt(4) })],
        tasks: [],
        replies: [
          { id: 'c1', title: 'Teatre de Salt', projectId: 'p1', projectName: 'MaMeMi', at: `${isoDay(-3)}T09:00:00Z`, href: '/h/w/conversation/c1' },
          { id: 'c2', title: 'Teatro Central', projectId: 'p1', projectName: 'MaMeMi', at: `${isoDay(-1)}T09:00:00Z`, href: '/h/w/conversation/c2' },
        ],
      },
      NOW,
      'en',
    );
    const rows = feed.flatMap((b) => b.runs).flatMap((r) => r.items);
    expect(rows.map((r) => r.id)).toEqual(['reply-c2', 'reply-c1', 'conv-c3']);
    expect(rows[0]).toMatchObject({ verbKey: 'reply', href: '/h/w/conversation/c2', day: isoDay(0), overdue: false });
    expect(rankWaiting(feed, NOW).rows.map((r) => r.id)).toEqual(['reply-c2', 'reply-c1', 'conv-c3']);
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
    // Hour's suggestion does not count as what waits for you.
    expect(rankWaiting(quiet, NOW)).toMatchObject({ asking: 0 });
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

describe('buildDeskFeed — horizon', () => {
  it('keeps a block per day up to the end of this week; everything past it is ONE later bucket', () => {
    const feed = buildDeskFeed(
      {
        ...EMPTY,
        conversations: [
          conv('near', { next_action_at: actionAt(6) }),
          conv('nextweek', { next_action_at: actionAt(8) }),
          conv('far', { next_action_at: actionAt(40) }),
        ],
        tasks: [task('t', { due_at: isoDay(20) } as Partial<TaskItem>)],
      },
      NOW,
      'en',
    );
    expect(feed.map((b) => b.labelKey)).toEqual(['weekday', 'later']);
    expect(feed[1].runs.flatMap((r) => r.items)).toHaveLength(3);
  });

  it('laterSummary counts the later things and spans first to last day', () => {
    const feed = buildDeskFeed(
      {
        ...EMPTY,
        conversations: [conv('a', { next_action_at: actionAt(40) }), conv('b', { next_action_at: actionAt(9) })],
        tasks: [task('t', { due_at: isoDay(15) } as Partial<TaskItem>)],
      },
      NOW,
      'en',
    );
    expect(laterSummary(feed)).toEqual({ count: 3, from: isoDay(9), until: isoDay(40) });
  });

  it('laterSummary is null when nothing lies past this week', () => {
    const feed = buildDeskFeed({ ...EMPTY, conversations: [conv('a', { next_action_at: actionAt(2) })] }, NOW, 'en');
    expect(laterSummary(feed)).toBeNull();
  });
});


describe('rankWaiting — «Te espera» by weight (ADR-117)', () => {
  const ask = (id: string, offset: number) =>
    goingItem({ of: 'performance', id, day: isoDay(offset), subject: id, projectId: 'p1', projectName: 'MaMeMi', href: null });

  it('overdue first, then today, then the week; inside a tier money > call > voy > task > proposal', () => {
    const feed = buildDeskFeed(
      {
        conversations: [conv('call-today', { next_action_at: actionAt(0) }), conv('call-late', { next_action_at: actionAt(-1) })],
        tasks: [
          task('t-today', { due_at: actionAt(0) }),
          task('ai-today', { origin: 'ai', due_at: actionAt(0) }),
          task('t-week', { due_at: actionAt(3) }),
          task('t-late', { due_at: actionAt(-2) }),
        ],
        invoices: [invoice('i')],
        asks: [ask('voy-today', 0), ask('voy-far', 10)],
      },
      NOW,
      'en',
    );
    const w = rankWaiting(feed, NOW);
    expect(w.rows.map((r) => r.id)).toEqual([
      'inv-i',
      'conv-call-late',
      'task-t-late',
      'conv-call-today',
      'going-voy-today',
      'task-t-today',
      'task-ai-today',
    ]);
    expect(w.total).toBe(9);
    expect(w.asking).toBe(8);
    expect(w.overdue).toBe(3);
  });

  it('a «voy» sits on its day in the list by days, so «Ver todo» keeps it', () => {
    const feed = buildDeskFeed({ ...EMPTY, asks: [ask('voy-far', 10)] }, NOW, 'en');
    expect(feed.map((b) => b.labelKey)).toEqual(['later']);
    expect(feed[0].runs[0]).toMatchObject({ concern: 'going' });
    expect(rankWaiting(feed, NOW).rows.map((r) => r.id)).toEqual(['going-voy-far']);
  });

  it('the anytime tail and what lies past this week stay in the day list', () => {
    const feed = buildDeskFeed(
      { conversations: [conv('far', { next_action_at: actionAt(20) })], tasks: [task('loose')] },
      NOW,
      'en',
    );
    expect(rankWaiting(feed, NOW).total).toBe(0);
  });

  it('a task inside its warning joins the week even when its due day is further', () => {
    const feed = buildDeskFeed(
      { conversations: [], tasks: [task('van', { due_at: actionAt(8), lead_days: 9 }), task('far', { due_at: actionAt(8) })] },
      NOW,
      'en',
    );
    expect(rankWaiting(feed, NOW).rows.map((r) => r.id)).toEqual(['task-van']);
  });

  it('calm keeps overdue and today only', () => {
    const feed = buildDeskFeed(
      { conversations: [], tasks: [task('a', { due_at: actionAt(0) }), task('b', { due_at: actionAt(3) })], asks: [ask('v', 4)] },
      NOW,
      'en',
    );
    expect(rankWaiting(feed, NOW, { calm: true }).rows.map((r) => r.id)).toEqual(['task-a']);
  });

  it('at most seven rows, the total says how many qualified', () => {
    const feed = buildDeskFeed(
      { conversations: [], tasks: Array.from({ length: 10 }, (_, i) => task(`t${i}`, { due_at: actionAt(0) })) },
      NOW,
      'en',
    );
    const w = rankWaiting(feed, NOW);
    expect(w.rows).toHaveLength(7);
    expect(w.total).toBe(10);
  });
});
