import { describe, expect, test } from 'vitest';
import { PostgrestError } from '$lib/supabase';
import { runConversationBulk, type BulkPg } from './conversation-bulk';

const WS = 'aaaaaaaa-0000-4000-8000-000000000001';
const SALES = 'bbbbbbbb-0000-4000-8000-000000000001';
const PRESS = 'bbbbbbbb-0000-4000-8000-000000000002';
const OFF = 'bbbbbbbb-0000-4000-8000-000000000003';
const id = (n: number) => `cccccccc-0000-4000-8000-${String(n).padStart(12, '0')}`;
const NOW = new Date('2026-10-22T10:00:00Z');

interface FakeRow {
  id: string;
  readable: boolean;
  editable: boolean;
  not_now_at: string | null;
  not_now_until: string | null;
  next_action_at: string | null;
  next_action_note: string | null;
  reply_settled_at: string | null;
  tags: string[];
  last: { direction: string | null; occurred_at: string } | null;
}

function row(n: number, over: Partial<FakeRow> = {}): FakeRow {
  return {
    id: id(n),
    readable: true,
    editable: true,
    not_now_at: null,
    not_now_until: null,
    next_action_at: null,
    next_action_note: null,
    reply_settled_at: null,
    tags: [SALES],
    last: null,
    ...over,
  };
}

function idsOf(search: URLSearchParams): string[] {
  return (search.get('id') ?? '').replace(/^in\.\(|\)$/g, '').split(',');
}

/** PostgREST as the RLS leaves it: what you do not read is not there; what you do not edit is not patched. */
function fakePg(rows: FakeRow[], opts: { failGroupPatch?: boolean } = {}) {
  const calls = { get: 0, patch: 0, rpc: 0, patchIds: [] as string[][] };
  const byId = new Map(rows.map((r) => [r.id, r]));
  const pg: BulkPg = {
    async get<T>(path: string, search: URLSearchParams) {
      calls.get++;
      if (path === 'conversation_tag') {
        return [
          { id: SALES, key: 'sales', workspace_id: null },
          { id: PRESS, key: 'press', workspace_id: null },
          { id: OFF, key: 'off', workspace_id: WS },
        ].filter((t) => (search.get('key') ?? '').includes(t.key)) as T[];
      }
      if (path === 'workspace_conversation_tag_setting') return [{ workspace_id: WS, tag_id: OFF }] as T[];
      return idsOf(search)
        .map((x) => byId.get(x))
        .filter((r): r is FakeRow => Boolean(r?.readable))
        .map((r) => ({
          ...r,
          workspace_id: WS,
          tagging: r.tags.map((tag_id) => ({ tag_id })),
          last_turn: r.last ? [r.last] : [],
        })) as T[];
    },
    async patch<T>(_path: string, body: Record<string, unknown>, search: URLSearchParams) {
      calls.patch++;
      const ids = idsOf(search);
      calls.patchIds.push(ids);
      if (opts.failGroupPatch && ids.length > 1) throw new PostgrestError(403, '{"code":"42501"}');
      const hit = ids.map((x) => byId.get(x)).filter((r): r is FakeRow => Boolean(r?.readable && r.editable));
      for (const r of hit) Object.assign(r, body);
      return hit.map((r) => ({ id: r.id })) as T[];
    },
    async rpc<T>(name: string, args: Record<string, unknown>) {
      calls.rpc++;
      expect(name).toBe('set_conversation_tags');
      const r = byId.get(args.p_conversation_id as string);
      if (!r?.editable) throw new PostgrestError(403, '{"code":"42501"}');
      r.tags = args.p_tag_ids as string[];
      return [r.tags] as T[];
    },
  };
  return { pg, calls, byId };
}

describe('runConversationBulk', () => {
  test('«no esta vez»: one PATCH for the group; unread rows not_found, read-only rows forbidden', async () => {
    const { pg, calls, byId } = fakePg([row(1), row(2, { editable: false }), row(3, { readable: false, editable: false })]);
    const r = await runConversationBulk(pg, { action: 'not_now', ids: [id(1), id(2), id(3)], until: '2026-11-05' }, NOW);
    expect(r.done).toEqual([id(1)]);
    expect(r.failed).toEqual([
      { id: id(2), reason: 'forbidden' },
      { id: id(3), reason: 'not_found' },
    ]);
    expect(calls.patch).toBe(1);
    expect(byId.get(id(1))!.not_now_at).toBe(NOW.toISOString());
    expect(byId.get(id(1))!.not_now_until).toBe('2026-11-05');
    expect(byId.get(id(2))!.not_now_at).toBeNull();
    // The undo is only of what changed, with what it had.
    expect(r.undo).toEqual([{ id: id(1), columns: { not_now_at: null, not_now_until: null } }]);
  });

  test('never patches an id that was not asked for', async () => {
    const { pg, calls } = fakePg([row(1), row(2)]);
    await runConversationBulk(pg, { action: 'next_step', ids: [id(1)], next_action_at: '2026-11-05', next_action_note: 'llamar' }, NOW);
    expect(calls.patchIds).toEqual([[id(1)]]);
  });

  test('a group that fails whole is retried one by one, so the failure is only its own', async () => {
    const { pg, calls } = fakePg([row(1), row(2), row(3, { editable: false })], { failGroupPatch: true });
    const r = await runConversationBulk(pg, { action: 'next_step', ids: [id(1), id(2), id(3)], next_action_at: null, next_action_note: null }, NOW);
    expect(r.done).toEqual([id(1), id(2)]);
    expect(r.failed).toEqual([{ id: id(3), reason: 'forbidden' }]);
    expect(calls.patch).toBe(4);
  });

  test('«no pide respuesta»: the last reply settled at its own instant; without one, not_due', async () => {
    const at = '2026-10-21T09:00:00Z';
    const { pg, byId } = fakePg([
      row(1, { last: { direction: 'inbound', occurred_at: at } }),
      row(2, { last: { direction: 'outbound', occurred_at: at } }),
      row(3, { last: { direction: 'inbound', occurred_at: at }, reply_settled_at: at }),
    ]);
    const r = await runConversationBulk(pg, { action: 'settle', ids: [id(1), id(2), id(3)] }, NOW);
    expect(r.done).toEqual([id(1)]);
    expect(r.failed.map((f) => f.reason)).toEqual(['not_due', 'not_due']);
    expect(byId.get(id(1))!.reply_settled_at).toBe(at);
    expect(r.undo).toEqual([{ id: id(1), columns: { reply_settled_at: null } }]);
  });

  test('tag add: keeps the others; an untagged one keeps Difusión; already there is done without a write', async () => {
    const { pg, calls, byId } = fakePg([row(1, { tags: [] }), row(2, { tags: [SALES, PRESS] }), row(3, { tags: [SALES] })]);
    const r = await runConversationBulk(pg, { action: 'tag', ids: [id(1), id(2), id(3)], key: 'press', op: 'add' }, NOW);
    expect(r.done).toEqual([id(1), id(2), id(3)]);
    expect(byId.get(id(1))!.tags).toEqual([SALES, PRESS]);
    expect(byId.get(id(3))!.tags).toEqual([SALES, PRESS]);
    expect(calls.rpc).toBe(2);
    expect(r.undo).toEqual([
      { id: id(1), tag_ids: [] },
      { id: id(3), tag_ids: [SALES] },
    ]);
  });

  test('tag remove: the last tag stays (last_tag); an inactive tag is never sent, nor lost', async () => {
    const { pg, byId } = fakePg([row(1, { tags: [PRESS] }), row(2, { tags: [SALES, PRESS, OFF] }), row(3, { tags: [] })]);
    const r = await runConversationBulk(pg, { action: 'tag', ids: [id(1), id(2), id(3)], key: 'press', op: 'remove' }, NOW);
    expect(r.done).toEqual([id(2), id(3)]);
    expect(r.failed).toEqual([{ id: id(1), reason: 'last_tag' }]);
    expect(byId.get(id(2))!.tags).toEqual([SALES]);
    expect(r.undo).toEqual([{ id: id(2), tag_ids: [SALES, PRESS] }]);
  });

  test('a tag inactive in the space is tag_unavailable; who does not edit is forbidden', async () => {
    const { pg } = fakePg([row(1), row(2, { editable: false })]);
    const off = await runConversationBulk(pg, { action: 'tag', ids: [id(1)], key: 'off', op: 'add' }, NOW);
    expect(off.failed).toEqual([{ id: id(1), reason: 'tag_unavailable' }]);
    const r = await runConversationBulk(pg, { action: 'tag', ids: [id(1), id(2)], key: 'press', op: 'add' }, NOW);
    expect(r.done).toEqual([id(1)]);
    expect(r.failed).toEqual([{ id: id(2), reason: 'forbidden' }]);
  });

  test('restore puts back columns and tags, each with its own value', async () => {
    const { pg, byId } = fakePg([row(1, { not_now_at: NOW.toISOString() }), row(2, { tags: [SALES, PRESS] }), row(3, { editable: false })]);
    const r = await runConversationBulk(
      pg,
      {
        action: 'restore',
        items: [
          { id: id(1), columns: { not_now_at: null, not_now_until: null } },
          { id: id(2), tag_ids: [] },
          { id: id(3), columns: { not_now_at: null } },
        ],
      },
      NOW,
    );
    expect(r.done).toEqual([id(1), id(2)]);
    expect(r.failed).toEqual([{ id: id(3), reason: 'forbidden' }]);
    expect(byId.get(id(1))!.not_now_at).toBeNull();
    expect(byId.get(id(2))!.tags).toEqual([]);
    expect(r.undo).toEqual([]);
  });
});
