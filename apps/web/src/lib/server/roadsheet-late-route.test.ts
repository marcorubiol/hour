import { afterEach, describe, expect, it, vi } from 'vitest';
import { POST as latePOST } from '../../routes/api/public/roadsheet/[token]/late/+server';
import { POST as sharesPOST } from '../../routes/api/performances/[key]/roadsheet/shares/+server';

// 121 B (ADR-183): the anonymous «llego tarde» route and the personal link.

const env = { PUBLIC_SUPABASE_URL: 'https://db.test', PUBLIC_SUPABASE_ANON_KEY: 'anon' };
const TOKEN = 'a'.repeat(64);
const PERF = '0190a0b0-0000-7000-8000-000000000003';
const PERSON = '0190a0b0-0000-7000-8000-000000000004';

interface Seen {
  path: string;
  auth: string | null;
  body: Record<string, unknown> | null;
}

function stub(answer: (path: string) => { status?: number; body: unknown }) {
  const seen: Seen[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string, init?: RequestInit) => {
      const url = new URL(input);
      const path = url.pathname.replace('/rest/v1/', '');
      const headers = new Headers(init?.headers);
      seen.push({
        path,
        auth: headers.get('authorization'),
        body: init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : null,
      });
      const a = answer(path);
      return new Response(JSON.stringify(a.body), { status: a.status ?? 200 });
    }),
  );
  return seen;
}

afterEach(() => vi.unstubAllGlobals());

const late = (body: unknown, token = TOKEN, kv?: unknown) =>
  latePOST({
    request: new Request(`https://hour.test/api/public/roadsheet/${token}/late`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'cf-connecting-ip': '1.2.3.4' },
      body: JSON.stringify(body),
    }),
    params: { token },
    platform: { env: { ...env, ...(kv ? { RATE_LIMIT: kv } : {}) } },
    locals: { requestId: 't' },
  } as unknown as Parameters<typeof latePOST>[0]);

describe('POST /api/public/roadsheet/:token/late', () => {
  it('sends only the token, the minutes and the note, as anon', async () => {
    const seen = stub(() => ({ body: { id: 'n', minutes: 20, note: 'x', milestone: null, seen_at: null, seen_by: null } }));
    const res = await late({ minutes: 20, note: '  Tráfico  ', performance_id: PERF });
    expect(res.status).toBe(201);
    expect(seen).toHaveLength(1);
    expect(seen[0]!.path).toBe('rpc/report_roadsheet_late');
    expect(seen[0]!.body).toEqual({ p_token: TOKEN, p_minutes: 20, p_note: 'Tráfico' });
    // No session: the anon key, never a user's JWT.
    expect(seen[0]!.auth).toBe('Bearer anon');
  });

  it('«No sé» and no note go as nulls', async () => {
    const seen = stub(() => ({ body: { id: 'n' } }));
    expect((await late({ minutes: null })).status).toBe(201);
    expect(seen[0]!.body).toEqual({ p_token: TOKEN, p_minutes: null, p_note: null });
  });

  it('refuses bad minutes, a long note or a bad token before the base', async () => {
    const seen = stub(() => ({ body: {} }));
    expect((await late({ minutes: 15 })).status).toBe(400);
    expect((await late({ minutes: 10, note: 'x'.repeat(281) })).status).toBe(400);
    expect((await late({})).status).toBe(400);
    expect((await late({ minutes: 10 }, 'not-a-token')).status).toBe(404);
    expect(seen).toHaveLength(0);
  });

  it('any link problem is an opaque 404; the day is 400; the flood is 429', async () => {
    stub(() => ({ status: 401, body: { code: '42501', message: 'link not usable' } }));
    expect((await late({ minutes: 10 })).status).toBe(404);
    stub(() => ({ status: 400, body: { code: '22023', message: 'only on the day of the performance' } }));
    expect((await late({ minutes: 10 })).status).toBe(400);
    stub(() => ({ status: 503, body: { code: '53400', message: 'too many notices from this link' } }));
    expect((await late({ minutes: 10 })).status).toBe(429);
  });

  it('the address limit answers 429 without asking the base', async () => {
    const seen = stub(() => ({ body: {} }));
    const kv = { get: async () => '10', put: async () => undefined };
    expect((await late({ minutes: 10 }, TOKEN, kv)).status).toBe(429);
    expect(seen).toHaveLength(0);
  });
});

describe('POST /api/performances/:key/roadsheet/shares { person_id }', () => {
  const create = (body: unknown) =>
    sharesPOST({
      request: new Request(`https://hour.test/api/performances/${PERF}/roadsheet/shares`, {
        method: 'POST',
        headers: { authorization: 'Bearer jwt', 'content-type': 'application/json' },
        body: JSON.stringify(body),
      }),
      url: new URL(`https://hour.test/api/performances/${PERF}/roadsheet/shares`),
      params: { key: PERF },
      platform: { env },
      locals: { requestId: 't' },
    } as unknown as Parameters<typeof sharesPOST>[0]);

  it('a person: the personal RPC, which sets the role itself', async () => {
    const seen = stub((path) =>
      path === 'rpc/create_roadsheet_share_for_person'
        ? { body: { id: 's', token: TOKEN, role: 'tech_manager', person_id: PERSON, created_at: 'c', expires_at: 'e' } }
        : { body: [{ id: PERF }] },
    );
    const res = await create({ person_id: PERSON });
    expect(res.status).toBe(201);
    const rpc = seen.find((s) => s.path === 'rpc/create_roadsheet_share_for_person');
    expect(rpc?.body).toEqual({ p_performance_id: PERF, p_person_id: PERSON });
    const body = (await res.json()) as { share: { person: { id: string } | null; role: string } };
    expect(body.share.person?.id).toBe(PERSON);
  });

  it('a role still goes to the role RPC; neither is 400', async () => {
    const seen = stub((path) =>
      path === 'rpc/create_roadsheet_share'
        ? { body: { id: 's', token: TOKEN, role: 'venue', person_id: null, created_at: 'c', expires_at: 'e' } }
        : { body: [{ id: PERF }] },
    );
    expect((await create({ role: 'venue' })).status).toBe(201);
    expect(seen.some((s) => s.path === 'rpc/create_roadsheet_share')).toBe(true);
    expect((await create({ person_id: 'nope' })).status).toBe(400);
  });
});
