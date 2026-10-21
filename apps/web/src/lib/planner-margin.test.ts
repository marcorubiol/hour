/**
 * The Planner's margin (ADR-138 § 6, plan § 8.4): the dated next steps of the
 * conversations and the tasks, from the same source as the Desk's «Te espera»
 * (`buildDeskFeed` → `rankWaiting`), bounded to the days the view shows. The
 * risk the plan names (§ 8.6): the margin and «Te espera» drift apart.
 */
import { describe, expect, it } from 'vitest';
import {
  buildDeskFeed,
  goingItem,
  overviewReplies,
  rankWaiting,
  waitingByDay,
  waitingCounts,
  waitingDay,
  type DeskConvInput,
  type DeskInvoiceInput,
} from './desk-feed';
import { conversationPlannerHref } from './planner';
import type { TaskItem } from './task';

// Friday 2026-07-17, 10:00, local: calendar-day math in any test zone.
const NOW = new Date(2026, 6, 17, 10, 0, 0);

function isoDay(offset: number): string {
  const d = new Date(2026, 6, 17 + offset);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
const actionAt = (offset: number) => `${isoDay(offset)}T00:00:00+00:00`;

function conv(id: string, o: Partial<DeskConvInput> = {}): DeskConvInput {
  return {
    id,
    relation: 'contacted',
    next_action_at: null,
    next_action_note: null,
    person: { full_name: 'Anna Prat', organization_name: null, slug: 'anna-prat' },
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
const invoice = {
  id: 'i',
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
} as unknown as DeskInvoiceInput;

const feed = buildDeskFeed(
  {
    conversations: [
      conv('late', { next_action_at: actionAt(-2) }),
      conv('far', { next_action_at: actionAt(20) }),
      conv('dormant', { relation: 'dormant' }),
      conv('back', { relation: 'not_now', not_now_until: isoDay(5) }),
    ],
    tasks: [task('t3', { due_at: actionAt(3) }), task('loose'), task('ai', { origin: 'ai', due_at: actionAt(3) })],
    invoices: [invoice],
    asks: [goingItem({ of: 'performance', id: 'voy', day: isoDay(3), subject: 'voy', projectId: 'p1', projectName: 'MaMeMi', href: null })],
  },
  NOW,
  'en',
);
const margin = (from: number, to: number) =>
  rankWaiting(feed, NOW, {
    window: { from: isoDay(from), to: isoDay(to) },
    concerns: ['task', 'conversation'],
    proposals: false,
  });

describe('the Planner margin — «Te espera» bounded to the view (ADR-138 § 6)', () => {
  it('is the Desk’s source: what «Te espera» ranks this week, the margin of the week shows', () => {
    const desk = rankWaiting(feed, NOW, { limit: Infinity })
      .rows.filter((r) => (r.concern === 'task' || r.concern === 'conversation') && !r.isProposal)
      .map((r) => r.id)
      .sort();
    expect(desk.length).toBeGreaterThan(0);
    expect(margin(0, 6).rows.map((r) => r.id).sort()).toEqual(desk);
  });

  it('only the days of the view; what is overdue waits on today, never on its past day', () => {
    expect(margin(3, 3).rows.map((r) => r.id)).toEqual(['task-t3']);
    expect(margin(0, 0).rows.map((r) => r.id)).toEqual(['conv-late']);
    expect(margin(-2, -1).rows).toEqual([]);
    // Past the Desk's week, the margin still has it on its day.
    expect(margin(20, 20).rows.map((r) => r.id)).toEqual(['conv-far']);
    expect(margin(21, 40).rows).toEqual([]);
  });

  it('a «not this time» with a day to come back is a step on that day', () => {
    const rows = margin(5, 5).rows;
    expect(rows.map((r) => r.id)).toEqual(['back-back']);
    expect(rows[0]).toMatchObject({ verbKey: 'followup', conversationId: 'back' });
  });

  it('leaves out money, the «voy», the anytime tail and Hour’s own proposals', () => {
    const ids = margin(-30, 30).rows.map((r) => r.id);
    expect(ids).not.toContain('inv-i');
    expect(ids).not.toContain('going-voy');
    expect(ids).not.toContain('task-loose');
    expect(ids).not.toContain('task-ai');
    expect(ids.some((id) => id.startsWith('revive-'))).toBe(false);
  });

  it('in day order, grouped by the day each waits on', () => {
    const rows = margin(-30, 30).rows;
    expect(rows.map((r) => r.id)).toEqual(['conv-late', 'task-t3', 'back-back', 'conv-far']);
    expect([...waitingByDay(rows, NOW).keys()]).toEqual([isoDay(0), isoDay(3), isoDay(5), isoDay(20)]);
    expect(waitingDay({ day: isoDay(-4) }, NOW)).toBe(isoDay(0));
    expect(waitingDay({ day: null }, NOW)).toBeNull();
  });

  it('Month and Season count per day: a number, not the rows', () => {
    const twoOnDay3 = buildDeskFeed(
      { conversations: [conv('c', { next_action_at: actionAt(3) })], tasks: [task('t', { due_at: actionAt(3) })] },
      NOW,
      'en',
    );
    const rows = rankWaiting(twoOnDay3, NOW, { window: { from: isoDay(-3), to: isoDay(38) }, concerns: ['task', 'conversation'] }).rows;
    const counts = waitingCounts(rows, NOW);
    expect(counts.get(isoDay(3))).toBe(2);
    expect(counts.size).toBe(1);
  });

  it('no cut in the margin; the Desk keeps its seven', () => {
    const many = buildDeskFeed(
      { conversations: [], tasks: Array.from({ length: 10 }, (_, i) => task(`m${i}`, { due_at: actionAt(1) })) },
      NOW,
      'en',
    );
    expect(rankWaiting(many, NOW, { window: { from: isoDay(1), to: isoDay(1) } }).rows).toHaveLength(10);
    expect(rankWaiting(many, NOW).rows).toHaveLength(7);
  });
});

describe('overviewReplies — the «te toca» rows, one reading for Desk and Planner', () => {
  it('keeps the replies and opens their conversation', () => {
    const rows = [
      { id: 'c1', reason: 'reply', title: 'Sala', workspace_id: 'w1', project_id: 'p1', at: actionAt(0) },
      { id: 'c2', reason: 'follow_up', title: 'Otra', workspace_id: 'w1', project_id: 'p1', at: actionAt(0) },
    ];
    expect(overviewReplies(rows, new Map([['w1', 'muk']]), new Map([['p1', 'MaMeMi']]))).toEqual([
      { id: 'c1', title: 'Sala', projectId: 'p1', projectName: 'MaMeMi', at: actionAt(0), href: '/h/muk/conversation/c1', tagName: null },
    ]);
  });

  it('names its tags when the page asks (ADR-138 fase 3: a reply from the press waits too)', () => {
    const rows = [{ id: 'c1', reason: 'reply', title: 'El Diari', workspace_id: 'w1', project_id: 'p1', at: actionAt(0), tags: ['press'] }];
    const named = overviewReplies(rows, new Map([['w1', 'muk']]), new Map([['p1', 'MaMeMi']]), (keys) => keys.join('+'));
    expect(named[0].tagName).toBe('press');
  });
});

describe('conversationPlannerHref — «Ver en el Planner»', () => {
  it('opens the Agenda on the first day ahead, with the project pinned', () => {
    expect(conversationPlannerHref('p1', ['2026-09-01', '2026-07-20', '2026-07-25'], '2026-07-17')).toBe(
      '/h/planner?view=agenda&d=2026-07-20&scope=p:p1',
    );
  });
  it('with nothing ahead, the book opens on today', () => {
    expect(conversationPlannerHref('p1', ['2026-03-01'], '2026-07-17')).toBe('/h/planner?view=agenda&scope=p:p1');
    expect(conversationPlannerHref('p1', [], '2026-07-17')).toBe('/h/planner?view=agenda&scope=p:p1');
  });
});
