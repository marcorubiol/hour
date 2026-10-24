import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadLastMailout } from './conversation-overview';
import { GET as overviewGET } from '../../routes/api/conversations/overview/+server';

// The panel / last-mailout split (2026-10-24): the panel no longer reads any
// mailout, and the last mailout reads its candidates' previews at once.

const env = { PUBLIC_SUPABASE_URL: 'https://db.test', PUBLIC_SUPABASE_ANON_KEY: 'anon' };
const QUEUED = '2026-10-20T10:00:00Z';

interface Seen {
  path: string;
  search: URLSearchParams;
  body: Record<string, unknown> | null;
  at: number;
}

function stub(answer: (path: string, search: URLSearchParams, body: Record<string, unknown> | null) => unknown) {
  const seen: Seen[] = [];
  let open = 0;
  let maxOpen = 0;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string, init?: RequestInit) => {
      const url = new URL(input);
      const path = url.pathname.replace('/rest/v1/', '');
      const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : null;
      seen.push({ path, search: url.searchParams, body, at: open });
      open += 1;
      maxOpen = Math.max(maxOpen, open);
      await new Promise((r) => setTimeout(r, 5));
      open -= 1;
      return new Response(JSON.stringify(answer(path, url.searchParams, body)), { status: 200 });
    }),
  );
  return { seen, maxOpen: () => maxOpen };
}

const candidates = ['m1', 'm2', 'm3', 'm4'].map((id, i) => ({
  id,
  workspace_id: 'w1',
  subject: `Envío ${i}`,
  from_address: 'a@b.c',
  status: 'done',
  queued_at: QUEUED,
  mail_domain_id: id === 'm2' ? 'd1' : null,
}));

afterEach(() => vi.unstubAllGlobals());

describe('loadLastMailout', () => {
  it('asks the four previews at once and keeps the first, in order, with someone in it', async () => {
    const io = stub((path, search, body) => {
      if (path === 'mailout') return candidates;
      if (path === 'rpc/mailout_preview') {
        // m1 reaches nobody you can read; m2 and m3 do: m2 wins (it is newer).
        if (body?.p_id === 'm2') return [{ recipient_id: 'r1', conversation_id: 'c1', status: 'delivered' }, { recipient_id: 'r2', conversation_id: 'c2', status: 'delivered' }];
        if (body?.p_id === 'm3') return [{ recipient_id: 'r9', conversation_id: 'c9', status: 'delivered' }];
        return [];
      }
      if (path === 'mail_domain') return [{ provider: 'ses' }];
      if (path === 'mailout_recipient') return [{ id: 'r1', sent_at: QUEUED }, { id: 'r2', sent_at: QUEUED }];
      if (path === 'conversation') return [{ id: 'c1', last_in: [{ occurred_at: '2026-10-21T09:00:00Z' }] }, { id: 'c2', last_in: [] }];
      throw new Error(`unexpected ${path} ${search}`);
    });

    const m = await loadLastMailout(env, 'jwt', { projectIds: [], workspaceIds: ['w1'] });

    expect(m?.id).toBe('m2');
    expect(m?.simulated).toBe(false);
    expect(m?.figures).toMatchObject({ recipients: 2, delivered: 2, replies: 1 });
    const previews = io.seen.filter((s) => s.path === 'rpc/mailout_preview');
    expect(previews.map((p) => p.body?.p_id)).toEqual(['m1', 'm2', 'm3', 'm4']);
    // All four were on the wire together, not one after another.
    expect(io.maxOpen()).toBeGreaterThanOrEqual(4);
  });

  it('reads the last inbound word of the recipients only, live and in the scope', async () => {
    const io = stub((path, _search, body) => {
      if (path === 'mailout') return candidates.slice(0, 1);
      if (path === 'rpc/mailout_preview' && body?.p_id === 'm1') return [{ recipient_id: 'r1', conversation_id: 'c1', status: 'sent' }];
      if (path === 'mailout_recipient') return [];
      if (path === 'conversation') return [];
      return [];
    });
    await loadLastMailout(env, 'jwt', { projectIds: ['p1'], workspaceIds: [] });
    const read = io.seen.find((s) => s.path === 'conversation')!;
    expect(read.search.get('id')).toBe('in.(c1)');
    expect(read.search.get('deleted_at')).toBe('is.null');
    expect(read.search.get('project_id')).toBe('in.(p1)');
    expect(read.search.get('select')).toContain('last_in:conversation_event');
    expect(read.search.get('last_in.direction')).toBe('eq.inbound');
    expect(read.search.get('last_turn.direction')).toBeNull();
  });

  it('is null when no candidate reaches anyone you can read', async () => {
    stub((path) => (path === 'mailout' ? candidates : []));
    expect(await loadLastMailout(env, 'jwt', { projectIds: [], workspaceIds: [] })).toBeNull();
  });
});

describe('GET /api/conversations/overview', () => {
  it('draws the panel without reading any mailout', async () => {
    const io = stub((path) => (path === 'rpc/conversations_bolos' ? [] : []));
    const res = await overviewGET({
      request: new Request('https://hour.test/api/conversations/overview', { headers: { authorization: 'Bearer jwt' } }),
      url: new URL('https://hour.test/api/conversations/overview'),
      platform: { env },
      locals: { requestId: 't' },
    } as unknown as Parameters<typeof overviewGET>[0]);
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).not.toHaveProperty('last_mailout');
    expect(io.seen.some((s) => s.path.startsWith('mailout') || s.path === 'rpc/mailout_preview')).toBe(false);
  });
});
