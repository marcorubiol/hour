import { afterEach, describe, expect, it, vi } from 'vitest';
import { PATCH } from '../../routes/api/organizations/[id]/+server';

// PATCH /api/organizations/:id (§ 64): the file's name, kind, city and email
// through `update_workspace_organization`. The RPC gates; the route shapes.

const env = { PUBLIC_SUPABASE_URL: 'https://db.test', PUBLIC_SUPABASE_ANON_KEY: 'anon' };
const ORG = '0190a0b0-0000-7000-8000-000000000001';

const row = {
  id: ORG,
  workspace_id: '0190a0b0-0000-7000-8000-0000000000ff',
  slug: 'teatre-x',
  name: 'Teatre X',
  kind: 'theatre',
  city: 'Girona',
  country: 'ES',
  email: 'prog@teatrex.cat',
  phone: null,
  website: null,
  address: null,
  notes: 'privado',
  custom_fields: { secret: 1 },
  fiscal_identity_id: null,
};

interface Seen {
  path: string;
  body: Record<string, unknown> | null;
}

function stub(status: number, answer: unknown) {
  const seen: Seen[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string, init?: RequestInit) => {
      const url = new URL(input);
      seen.push({
        path: url.pathname.replace('/rest/v1/', ''),
        body: init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : null,
      });
      return new Response(JSON.stringify(answer), { status });
    }),
  );
  return seen;
}

function call(body: unknown, { id = ORG, auth = true }: { id?: string; auth?: boolean } = {}) {
  return PATCH({
    request: new Request(`https://hour.test/api/organizations/${id}`, {
      method: 'PATCH',
      headers: auth ? { authorization: 'Bearer jwt', 'content-type': 'application/json' } : {},
      body: JSON.stringify(body),
    }),
    params: { id },
    platform: { env },
    locals: { requestId: 't' },
  } as unknown as Parameters<typeof PATCH>[0]);
}

afterEach(() => vi.unstubAllGlobals());

describe('PATCH /api/organizations/[id]', () => {
  it('sends every field to the RPC, empty as null, and answers only what the file reads', async () => {
    const seen = stub(200, row);
    const res = await call({ name: '  Teatre X ', kind: 'theatre', city: '', email: '' });
    expect(res.status).toBe(200);
    expect(seen).toHaveLength(1);
    expect(seen[0]!.path).toBe('rpc/update_workspace_organization');
    expect(seen[0]!.body).toEqual({
      p_organization_id: ORG,
      p_name: 'Teatre X',
      p_kind: 'theatre',
      p_city: null,
      p_email: null,
    });
    const body = (await res.json()) as { organization: Record<string, unknown> };
    expect(body.organization).toMatchObject({ id: ORG, name: 'Teatre X', kind: 'theatre', city: 'Girona' });
    expect(body.organization).not.toHaveProperty('notes');
    expect(body.organization).not.toHaveProperty('custom_fields');
  });

  it('an empty kind travels as null (the RPC makes it «other»)', async () => {
    const seen = stub(200, row);
    await call({ name: 'Teatre X', kind: '' });
    expect(seen[0]!.body).toMatchObject({ p_kind: null, p_city: null, p_email: null });
  });

  it.each([
    ['no name', { name: '   ' }],
    ['an unknown kind', { name: 'X', kind: 'venue' }],
    ['a bad email', { name: 'X', email: 'not-an-email' }],
    ['a city too long', { name: 'X', city: 'a'.repeat(121) }],
    ['no body', null],
  ])('refuses %s with 400 before the base', async (_label, body) => {
    const seen = stub(200, row);
    const res = await call(body);
    expect(res.status).toBe(400);
    expect(seen).toHaveLength(0);
  });

  it('refuses an id that is not a uuid, and a call without a token', async () => {
    const seen = stub(200, row);
    expect((await call({ name: 'X' }, { id: 'teatre-x' })).status).toBe(400);
    expect((await call({ name: 'X' }, { auth: false })).status).toBe(401);
    expect(seen).toHaveLength(0);
  });

  it.each([
    ['42501', 403, 404, 'not_found'],
    ['23505', 409, 409, 'name_taken'],
    ['22023', 400, 400, 'invalid_input'],
  ])('maps %s to %i → %i', async (code, upstream, status, error) => {
    stub(upstream, { code, message: 'x' });
    const res = await call({ name: 'Teatre X' });
    expect(res.status).toBe(status);
    expect(((await res.json()) as { error: string }).error).toBe(error);
  });
});
