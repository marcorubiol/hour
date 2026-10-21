import { describe, expect, it } from 'vitest';
import {
  compareFeed,
  conversationView,
  feedKey,
  feedView,
  markConversationRead,
  sortFeed,
  type ConversationFeedView,
  type FeedConversation,
  type FeedThreadRow,
} from './conversation-feed';
import { dueReason, turnOf } from './conversation-overview';

const NOW = new Date('2026-10-21T12:00:00');

function conv(id: string, over: Partial<FeedConversation> = {}): FeedConversation {
  return {
    kind: 'conversation',
    id,
    workspace_id: 'w',
    project_id: 'p',
    line_id: null,
    created_at: '2026-09-01T10:00:00Z',
    title: `Sala ${id}`,
    person: null,
    tags: [],
    unread_count: 0,
    event_unread: 0,
    thread_unread: 0,
    thread_id: null,
    last: null,
    last_in: null,
    last_at: null,
    last_contacted_at: null,
    reply_settled_at: null,
    next_action_at: null,
    next_action_note: null,
    not_now_at: null,
    not_now_until: null,
    ...over,
  };
}

function thread(id: string, over: Partial<FeedThreadRow> = {}): FeedThreadRow {
  return {
    kind: 'thread',
    thread_id: id,
    workspace_id: 'w',
    project_id: 'p',
    anchor_kind: 'bolo',
    anchor_id: `b-${id}`,
    facet_id: null,
    facet_key: null,
    label: null,
    labels: {},
    message_count: 1,
    unread_count: 0,
    last_message_at: '2026-10-10T10:00:00Z',
    last_message: { author_id: 'u', body: 'hola', created_at: '2026-10-10T10:00:00Z' },
    bolo: null,
    conversation: null,
    ...over,
  };
}

const inbound = (at: string) => ({ direction: 'inbound' as const, occurred_at: at, kind: 'email', subject: 'Re: fechas' });
const outbound = (at: string) => ({ direction: 'outbound' as const, occurred_at: at, kind: 'email', subject: 'Fechas' });

describe('conversationView: the turn, with the panel’s rule', () => {
  it('their last word asks for an answer: te toca (reply)', () => {
    const v = conversationView(conv('a', { last: inbound('2026-10-19T09:00:00Z'), last_in: { occurred_at: '2026-10-19T09:00:00Z' } }), NOW);
    expect(v.turn).toBe('ours');
    expect(v.due).toBe('reply');
  });

  it('our last word: their turn, nothing due', () => {
    const v = conversationView(conv('a', { last: outbound('2026-10-19T09:00:00Z') }), NOW);
    expect(v).toMatchObject({ turn: 'theirs', due: null });
  });

  it('«no pide respuesta» settles it; a follow-up for today is still due', () => {
    const settled = conv('a', { last: inbound('2026-10-19T09:00:00Z'), reply_settled_at: '2026-10-19T10:00:00Z' });
    expect(conversationView(settled, NOW)).toMatchObject({ turn: null, due: null });
    const followUp = conv('b', { next_action_at: '2026-10-21T00:00:00Z' });
    expect(conversationView(followUp, NOW).due).toBe('follow_up');
  });

  it('«no esta vez» in force closes the turn and the follow-up', () => {
    const closed = conv('a', {
      last: inbound('2026-10-01T09:00:00Z'),
      last_in: { occurred_at: '2026-10-01T09:00:00Z' },
      not_now_at: '2026-10-02T09:00:00Z',
      next_action_at: '2026-10-20T00:00:00Z',
    });
    expect(conversationView(closed, NOW)).toMatchObject({ turn: null, due: null });
  });

  it('reads exactly what turnOf and dueReason read (ADR-118 § 7: the lens and Desk cannot count apart)', () => {
    const rows = [
      conv('a', { last: inbound('2026-10-19T09:00:00Z'), last_in: { occurred_at: '2026-10-19T09:00:00Z' } }),
      conv('b', { last: outbound('2026-10-19T09:00:00Z'), next_action_at: '2026-10-01T00:00:00Z' }),
      conv('c', { not_now_at: '2026-10-02T09:00:00Z', not_now_until: '2026-10-21' }),
    ];
    for (const r of rows) {
      const input = { ...r, first_contacted_at: null, contacted_undated: false };
      const v = conversationView(r, NOW);
      expect(v.turn).toBe(turnOf(input, NOW)?.side ?? null);
      expect(v.due).toBe(dueReason(input, NOW));
    }
  });
});

describe('the order of the common list', () => {
  it('unread first, then te toca, then the latest; a thread has no turn', () => {
    const rows = feedView(
      [
        thread('old', { last_message_at: '2026-10-01T10:00:00Z' }),
        conv('due', { last: inbound('2026-10-05T09:00:00Z'), last_at: '2026-10-05T09:00:00Z' }),
        thread('new', { unread_count: 2, last_message_at: '2026-10-02T10:00:00Z' }),
        conv('quiet', { last: outbound('2026-10-20T09:00:00Z'), last_at: '2026-10-20T09:00:00Z' }),
        conv('fresh', { event_unread: 1, unread_count: 1, last_at: '2026-09-30T10:00:00Z' }),
      ],
      NOW,
    );
    expect(rows.map(feedKey)).toEqual(['t:new', 'c:fresh', 'c:due', 'c:quiet', 't:old']);
  });

  it('a conversation that never moved sorts by when it was born; ties go by id', () => {
    const rows = sortFeed([
      conversationView(conv('b', { created_at: '2026-10-01T00:00:00Z' }), NOW),
      conversationView(conv('a', { created_at: '2026-10-01T00:00:00Z' }), NOW),
      conversationView(conv('c', { created_at: '2026-10-15T00:00:00Z' }), NOW),
    ]);
    expect(rows.map(feedKey)).toEqual(['c:c', 'c:a', 'c:b']);
  });

  it('compareFeed is the order sortFeed uses', () => {
    const a = conversationView(conv('a', { unread_count: 1, event_unread: 1 }), NOW);
    const b = thread('b', { last_message_at: '2026-10-20T00:00:00Z' });
    expect(compareFeed(a, b)).toBeLessThan(0);
    expect(compareFeed(b, a)).toBeGreaterThan(0);
  });
});

describe('the unread rule when a conversation is opened', () => {
  const view = (items: ConversationFeedView['items']): ConversationFeedView => ({ me: 'u', items, more: false, authors: {} });

  it('opening it clears what came from outside; its team thread is read when seen, not here', () => {
    const before = view(
      sortFeed([
        conversationView(conv('a', { event_unread: 2, thread_unread: 1, unread_count: 3, last_at: '2026-10-01T00:00:00Z' }), NOW),
        conversationView(conv('b', { event_unread: 1, unread_count: 1, last_at: '2026-10-02T00:00:00Z' }), NOW),
      ]),
    );
    const after = markConversationRead(before, 'a');
    const a = after.items.find((r) => r.kind === 'conversation' && r.id === 'a');
    expect(a).toMatchObject({ event_unread: 0, thread_unread: 1, unread_count: 1 });
    // Still unread (its thread), so it keeps its place among the unread, by its last movement.
    expect(after.items.map(feedKey)).toEqual(['c:b', 'c:a']);
  });

  it('only the team thread new: the row stays unread; nothing new: the same view back', () => {
    const v = view([conversationView(conv('a', { thread_unread: 1, unread_count: 1 }), NOW)]);
    expect(markConversationRead(v, 'a')).toBe(v);
    expect(markConversationRead(v, 'missing')).toBe(v);
  });

  it('read, it drops below what is still new', () => {
    const before = view(
      sortFeed([
        conversationView(conv('a', { event_unread: 1, unread_count: 1, last_at: '2026-10-20T00:00:00Z' }), NOW),
        thread('t', { unread_count: 1, last_message_at: '2026-10-01T00:00:00Z' }),
      ]),
    );
    expect(before.items.map(feedKey)).toEqual(['c:a', 't:t']);
    expect(markConversationRead(before, 'a').items.map(feedKey)).toEqual(['t:t', 'c:a']);
  });
});
