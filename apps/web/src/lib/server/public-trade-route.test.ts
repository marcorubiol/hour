import { afterEach, describe, expect, it, vi } from 'vitest';
import { GET as roadsheetGET } from '../../routes/api/public/roadsheet/[token]/+server';
import { POST as invitationPOST } from '../../routes/api/invitations/+server';

// 143 (20261113110000): the public road sheet and the invitation pass on the
// space's trade; a base that does not send it yet leaves them in stage.

const env = { PUBLIC_SUPABASE_URL: 'https://db.test', PUBLIC_SUPABASE_ANON_KEY: 'anon' };
const TOKEN = 'a'.repeat(64);

function stub(body: unknown) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(JSON.stringify(body), { status: 200 })),
  );
}

afterEach(() => vi.unstubAllGlobals());

const bundle = (extra: Record<string, unknown> = {}) => ({
  role: 'performer',
  performance: {
    id: 'p',
    slug: 'p',
    performed_at: '2031-08-13',
    status: 'confirmed',
    venue_name: 'Sala',
    city: null,
    country: null,
    logistics: {},
    hospitality: {},
    technical: {},
    schedule: [],
  },
  project: null,
  venue: null,
  cast: [],
  cast_overrides: [],
  crew: [],
  assets: [],
  ...extra,
});

const sheet = async () => {
  const res = await roadsheetGET({
    params: { token: TOKEN },
    platform: { env },
    locals: { requestId: 't' },
  } as unknown as Parameters<typeof roadsheetGET>[0]);
  expect(res.status).toBe(200);
  return (await res.json()) as { trade: string | null };
};

const preview = async () => {
  const res = await invitationPOST({
    request: new Request('https://hour.test/api/invitations', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer jwt' },
      body: JSON.stringify({ token: TOKEN }),
    }),
    platform: { env },
    locals: { requestId: 't' },
  } as unknown as Parameters<typeof invitationPOST>[0]);
  expect(res.status).toBe(200);
  return ((await res.json()) as { invitation: { workspace_trade?: string | null } }).invitation;
};

describe('GET /api/public/roadsheet/:token and the trade (143)', () => {
  it("passes on the space's trade", async () => {
    stub(bundle({ trade: 'music' }));
    expect((await sheet()).trade).toBe('music');
  });

  it('says null when the base does not send it (before the migration)', async () => {
    stub(bundle());
    expect((await sheet()).trade).toBeNull();
  });
});

describe('POST /api/invitations and the trade (143)', () => {
  it("passes on the space's trade with the row", async () => {
    stub([{ workspace_id: 'w', workspace_slug: 'w', workspace_trade: 'music' }]);
    expect((await preview()).workspace_trade).toBe('music');
  });

  it('a row without it stays without it', async () => {
    stub([{ workspace_id: 'w', workspace_slug: 'w' }]);
    expect((await preview()).workspace_trade).toBeUndefined();
  });
});
