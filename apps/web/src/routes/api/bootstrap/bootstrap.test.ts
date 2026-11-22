import { afterEach, describe, expect, it, vi } from 'vitest';
import { GET } from './+server';

const ENV = {
  PUBLIC_SUPABASE_URL: 'https://example.supabase.co',
  PUBLIC_SUPABASE_ANON_KEY: 'anon-key',
};

// Minimal valid base64url JWT with sub = 'user-1'.
const FAKE_JWT = `eyJhbGciOiJIUzI1NiJ9.${btoa(JSON.stringify({ sub: 'user-1', exp: 9999999999 }))
  .replace(/\+/g, '-')
  .replace(/\//g, '_')
  .replace(/=+$/, '')}.sig`;

function makeEvent(urlStr: string, jwt: string | null = FAKE_JWT) {
  const headers = new Headers();
  if (jwt) headers.set('authorization', `Bearer ${jwt}`);
  return {
    request: new Request(urlStr, { headers }),
    url: new URL(urlStr),
    platform: { env: ENV },
    locals: { requestId: 'req-1' },
  } as unknown as Parameters<typeof GET>[0];
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('GET /api/bootstrap', () => {
  it('returns 401 when missing authorization', async () => {
    const res = await GET(makeEvent('https://hour.test/api/bootstrap', null));
    expect(res.status).toBe(401);
  });

  it('aggregates all Hoy slices in one response and omits failed optional slices', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes('/rest/v1/workspace?')) return new Response(JSON.stringify([{ id: 'w1', slug: 'muk' }]));
      if (url.includes('/rest/v1/membership?')) return new Response(JSON.stringify([{ workspace_id: 'w1', workspace_role: 'owner' }]));
      if (url.includes('/rest/v1/project?')) return new Response(JSON.stringify([{ id: 'p1', custom_fields: { preparation: ['a'] } }]));
      if (url.includes('/rest/v1/line?')) return new Response(JSON.stringify([{ id: 'l1' }]));
      if (url.includes('/rest/v1/user_profile?')) return new Response(JSON.stringify([{ person_id: null, full_name: 'Marco' }]));
      if (url.endsWith('/rpc/money_access_any')) return new Response(JSON.stringify(true));
      if (url.endsWith('/rpc/conversation_access')) return new Response(JSON.stringify([{ read: true, edit: false }]));
      if (url.includes('/rest/v1/desk_set_aside?')) return new Response(JSON.stringify([{ items: { 'task-1': '2026-11-30' } }]));
      if (url.includes('/rest/v1/performance?')) return new Response(JSON.stringify([]));
      if (url.includes('/rest/v1/date?')) return new Response(JSON.stringify([]));
      if (url.includes('/rest/v1/task?')) return new Response(JSON.stringify([]));
      // Simulate a transient 500 on conversations: other slices still succeed.
      if (url.includes('/rest/v1/conversation?')) return new Response(JSON.stringify({ message: 'boom' }), { status: 500 });
      throw new Error(`unexpected fetch: ${url}`);
    });

    const res = await GET(makeEvent('https://hour.test/api/bootstrap?today=2026-11-20&dates_from=2026-11-06'));
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.workspaces).toEqual({
      items: [{ id: 'w1', slug: 'muk', my_role: 'owner', my_preset: null, view_scope: null, planner_view: null, calendar_scope: null }],
    });
    expect(body.projects).toEqual({ items: [{ id: 'p1', preparation: ['a'] }] });
    expect(body.money_access).toEqual({ read_money: true });
    expect(body.conversation_access).toEqual({ read: true, edit: false });
    expect(body.set_aside).toEqual({ items: { 'task-1': '2026-11-30' } });
    expect(body.performances).toEqual({ items: [] });
    expect(body.dates).toEqual({ items: [] });
    expect(body.tasks).toEqual({ items: [] });
    expect(body.conversations).toBeUndefined();
  });

  it('propagates 401 when PostgREST rejects an expired JWT', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(
      async () => new Response(JSON.stringify({ message: 'JWT expired' }), { status: 401 }),
    );
    const res = await GET(makeEvent('https://hour.test/api/bootstrap?today=2026-11-20'));
    expect(res.status).toBe(401);
  });
});
