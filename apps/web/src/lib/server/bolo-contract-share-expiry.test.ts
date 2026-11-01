import { afterEach, describe, expect, it, vi } from 'vitest';
import { PATCH as boloPATCH } from '../../routes/api/money/bolos/[id]/+server';
import { PATCH as sharePATCH } from '../../routes/api/performances/[key]/roadsheet/shares/[id]/+server';
import { GET as sharesGET } from '../../routes/api/performances/[key]/roadsheet/shares/+server';
import { shareExpired, shareLastDay } from '$lib/roadsheet';

// ADR-163: the bolo's contract (PATCH /api/money/bolos/:id { contract }) and
// the public road sheet link's expiry (PATCH …/shares/:id { last_day }).

const env = { PUBLIC_SUPABASE_URL: 'https://db.test', PUBLIC_SUPABASE_ANON_KEY: 'anon' };
const BOLO = '0190a0b0-0000-7000-8000-000000000001';
const SHARE = '0190a0b0-0000-7000-8000-000000000002';
const PERF = '0190a0b0-0000-7000-8000-000000000003';

interface Seen {
  path: string;
  body: Record<string, unknown> | null;
}

function stub(answer: (path: string) => { status?: number; body: unknown }) {
  const seen: Seen[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string, init?: RequestInit) => {
      const url = new URL(input);
      const path = url.pathname.replace('/rest/v1/', '');
      seen.push({ path, body: init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : null });
      const a = answer(path);
      return new Response(JSON.stringify(a.body), { status: a.status ?? 200 });
    }),
  );
  return seen;
}

function event(url: string, method: string, body: unknown, params: Record<string, string>) {
  return {
    request: new Request(url, {
      method,
      headers: { authorization: 'Bearer jwt', 'content-type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }),
    url: new URL(url),
    params,
    platform: { env },
    locals: { requestId: 't' },
  };
}

const callBolo = (body: unknown) =>
  boloPATCH(
    event(`https://hour.test/api/money/bolos/${BOLO}`, 'PATCH', body, { id: BOLO }) as unknown as Parameters<
      typeof boloPATCH
    >[0],
  );
const callShare = (body: unknown) =>
  sharePATCH(
    event(`https://hour.test/api/performances/p/roadsheet/shares/${SHARE}?ws=w`, 'PATCH', body, {
      key: 'p',
      id: SHARE,
    }) as unknown as Parameters<typeof sharePATCH>[0],
  );

afterEach(() => vi.unstubAllGlobals());

describe('PATCH /api/money/bolos/[id] { contract }', () => {
  it('sends both dates to update_bolo_contract and nothing else', async () => {
    const seen = stub(() => ({
      body: [{ id: BOLO, contract_sent_at: '2026-11-01T10:00:00Z', contract_signed_at: null }],
    }));
    const res = await callBolo({ contract: { sent_at: '2026-11-01T10:00:00Z', signed_at: null } });
    expect(res.status).toBe(200);
    expect(seen.map((s) => s.path)).toEqual(['rpc/update_bolo_contract']);
    expect(seen[0]!.body).toEqual({ p_bolo_id: BOLO, p_sent_at: '2026-11-01T10:00:00Z', p_signed_at: null });
    expect(((await res.json()) as { bolo: Record<string, unknown> }).bolo).toMatchObject({
      contract_sent_at: '2026-11-01T10:00:00Z',
    });
  });

  it('refuses a date that is not a timestamp, and a contract missing a field', async () => {
    const seen = stub(() => ({ body: [] }));
    expect((await callBolo({ contract: { sent_at: 'yesterday', signed_at: null } })).status).toBe(400);
    expect((await callBolo({ contract: { sent_at: null } })).status).toBe(400);
    expect(seen).toHaveLength(0);
  });

  it('42501 is 403, 22023 is 400', async () => {
    stub(() => ({ status: 403, body: { code: '42501', message: 'x' } }));
    expect((await callBolo({ contract: { sent_at: null, signed_at: null } })).status).toBe(403);
    stub(() => ({ status: 400, body: { code: '22023', message: 'x' } }));
    expect((await callBolo({ contract: { sent_at: null, signed_at: null } })).status).toBe(400);
  });
});

describe('PATCH …/roadsheet/shares/[id] { last_day }', () => {
  const row = {
    id: SHARE,
    token: 'tok',
    role: 'venue',
    created_at: '2026-10-01T10:00:00Z',
    expires_at: '2026-11-14T23:00:00Z',
    workspace_id: 'w',
    performance_id: PERF,
  };

  it('moves the date through set_roadsheet_share_expiry and answers the share', async () => {
    const seen = stub(() => ({ body: row }));
    const res = await callShare({ last_day: '2026-11-14' });
    expect(res.status).toBe(200);
    expect(seen.map((s) => s.path)).toEqual(['rpc/set_roadsheet_share_expiry']);
    expect(seen[0]!.body).toEqual({ p_share_id: SHARE, p_last_day: '2026-11-14' });
    const body = (await res.json()) as { share: Record<string, unknown> };
    expect(body.share).toEqual({
      id: SHARE,
      token: 'tok',
      role: 'venue',
      created_at: row.created_at,
      expires_at: row.expires_at,
    });
  });

  it('refuses a day that is not a date before the base', async () => {
    const seen = stub(() => ({ body: row }));
    expect((await callShare({ last_day: '14/11/2026' })).status).toBe(400);
    expect((await callShare({})).status).toBe(400);
    expect(seen).toHaveLength(0);
  });

  it('a past day (22023) is 400; not allowed (42501) is 403', async () => {
    stub(() => ({ status: 400, body: { code: '22023', message: 'x' } }));
    expect((await callShare({ last_day: '2020-01-01' })).status).toBe(400);
    stub(() => ({ status: 403, body: { code: '42501', message: 'x' } }));
    expect((await callShare({ last_day: '2030-01-01' })).status).toBe(403);
  });

  it('the list carries expires_at', async () => {
    stub((path) => (path === 'rpc/list_roadsheet_shares' ? { body: [row] } : { body: [{ id: PERF }] }));
    const res = await sharesGET(
      event(`https://hour.test/api/performances/${PERF}/roadsheet/shares?ws=w`, 'GET', undefined, {
        key: PERF,
      }) as unknown as Parameters<typeof sharesGET>[0],
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { items: Array<Record<string, unknown>> };
    expect(body.items[0]).toMatchObject({ id: SHARE, expires_at: row.expires_at });
  });
});

describe('shareLastDay / shareExpired', () => {
  it('the last day is the one before the expiry instant', () => {
    const at = new Date(2026, 2, 14, 0, 0, 0).toISOString(); // local midnight, 14 March
    expect(shareLastDay(at)).toBe('2026-03-13');
  });
  it('expired once the instant has come', () => {
    const at = '2026-03-14T00:00:00Z';
    expect(shareExpired(at, new Date('2026-03-13T23:59:59Z'))).toBe(false);
    expect(shareExpired(at, new Date('2026-03-14T00:00:00Z'))).toBe(true);
  });
});
