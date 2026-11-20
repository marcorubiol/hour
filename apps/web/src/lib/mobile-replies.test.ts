import { describe, expect, it } from 'vitest';
import type { ConversationItem } from './conversation';
import { buildOverview, type OverviewInput } from './conversation-overview';
import { mobileReplyRows } from './mobile-replies';

const NOW = new Date('2026-11-20T12:00:00Z');

function makeConv(over: Partial<ConversationItem> = {}): ConversationItem {
  return {
    id: 'c1',
    workspace_id: 'w1',
    project_id: 'p1',
    line_id: null,
    organization_id: 'o1',
    person: null,
    project: { id: 'p1', slug: 'mamemi', name: 'MaMeMi', status: 'active' },
    organization: { id: 'o1', slug: 'kursaal', name: 'Kursaal', kind: 'theatre', city: 'Donostia' },
    contacts: [],
    last_turn: [{ direction: 'inbound', occurred_at: '2026-11-19T10:00:00Z', kind: 'email', subject: 'Hola' }],
    last_in: [{ occurred_at: '2026-11-19T10:00:00Z' }],
    regular: false,
    relation: 'talking',
    tags: ['sales'],
    not_now_at: null,
    not_now_until: null,
    last_contacted_at: '2026-11-19T10:00:00Z',
    first_contacted_at: '2026-11-10T10:00:00Z',
    contacted_undated: false,
    next_action_at: null,
    next_action_note: null,
    reply_settled_at: null,
    custom_fields: {},
    private_to: null,
    created_at: '2026-11-01T00:00:00Z',
    updated_at: '2026-11-19T10:00:00Z',
    deleted_at: null,
    created_by: 'u1',
    ...over,
  } as ConversationItem;
}

describe('mobileReplyRows', () => {
  it('matches buildOverview due replies (most recent first, settled and not_now excluded)', () => {
    const convs: ConversationItem[] = [
      makeConv({
        id: 'c-old',
        organization: { id: 'o1', slug: 'a', name: 'Teatro A', kind: 'theatre', city: null },
        last_turn: [{ direction: 'inbound', occurred_at: '2026-11-17T09:00:00Z', kind: 'email' }],
        tags: ['press'],
      }),
      makeConv({
        id: 'c-new',
        organization: { id: 'o2', slug: 'b', name: 'Teatro B', kind: 'theatre', city: null },
        last_turn: [{ direction: 'inbound', occurred_at: '2026-11-20T09:00:00Z', kind: 'email' }],
      }),
      makeConv({
        id: 'c-settled',
        last_turn: [{ direction: 'inbound', occurred_at: '2026-11-19T09:00:00Z', kind: 'email' }],
        reply_settled_at: '2026-11-19T09:00:00Z',
      }),
      makeConv({
        id: 'c-not-now',
        not_now_at: '2026-11-19T09:00:00Z',
        last_turn: [{ direction: 'inbound', occurred_at: '2026-11-20T10:00:00Z', kind: 'email' }],
      }),
      makeConv({
        id: 'c-outbound',
        last_turn: [{ direction: 'outbound', occurred_at: '2026-11-20T10:00:00Z', kind: 'email' }],
      }),
    ];

    const got = mobileReplyRows(convs, NOW);
    const overviewInputs: OverviewInput[] = convs.map((c) => ({
      id: c.id,
      workspace_id: c.workspace_id,
      project_id: c.project_id,
      line_id: c.line_id,
      not_now_at: c.not_now_at,
      not_now_until: c.not_now_until,
      last_contacted_at: c.last_contacted_at,
      first_contacted_at: c.first_contacted_at,
      contacted_undated: c.contacted_undated,
      regular: c.regular,
      next_action_at: c.next_action_at,
      next_action_note: c.next_action_note,
      reply_settled_at: c.reply_settled_at,
      title: c.organization?.name ?? '',
      person: null,
      last: c.last_turn?.[0] ?? null,
      last_in: c.last_in?.[0] ?? null,
      performance_days: [],
      tags: c.tags,
    }));
    const expected = buildOverview(overviewInputs, NOW)
      .due.rows.filter((r) => r.reason === 'reply')
      .map((r) => ({ id: r.id, title: r.title, at: r.at, tags: r.tags }));

    expect(got.map((r) => ({ id: r.id, title: r.title, at: r.at, tags: r.tags }))).toEqual(expected);
  });

  it('reserves up to 2 follow-up slots in the 5-row block cap just like buildOverview', () => {
    const convs: ConversationItem[] = [
      ...Array.from({ length: 5 }, (_, i) =>
        makeConv({
          id: `r${i}`,
          last_turn: [{ direction: 'inbound', occurred_at: `2026-11-1${i + 1}T10:00:00Z`, kind: 'email' }],
        }),
      ),
      makeConv({
        id: 'f1',
        last_turn: [{ direction: 'outbound', occurred_at: '2026-11-10T10:00:00Z', kind: 'email' }],
        next_action_at: '2026-11-19',
      }),
      makeConv({
        id: 'f2',
        last_turn: [{ direction: 'outbound', occurred_at: '2026-11-10T10:00:00Z', kind: 'email' }],
        next_action_at: '2026-11-18',
      }),
    ];

    const got = mobileReplyRows(convs, NOW);
    expect(got.map((r) => r.id)).toEqual(['r4', 'r3', 'r2']);
  });
});
