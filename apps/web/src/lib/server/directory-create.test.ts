import { afterEach, describe, expect, it, vi } from 'vitest';
import { POST as postOrganization } from '../../routes/api/organizations/+server';
import { POST as postPerson } from '../../routes/api/persons/+server';
import { GET as canCreate } from '../../routes/api/organizations/can-create/+server';

// 136: POST /api/organizations (`create_workspace_organization`) and the
// organization of POST /api/persons (`set_workspace_person_organization`).
// The RPCs gate; the routes shape.

const env = { PUBLIC_SUPABASE_URL: 'https://db.test', PUBLIC_SUPABASE_ANON_KEY: 'anon' };
const WS = '0190a0b0-0000-7000-8000-0000000000ff';
const ORG = '0190a0b0-0000-7000-8000-000000000001';
const PERSON = '0190a0b0-0000-7000-8000-000000000002';

interface Seen {
  path: string;
  search: string;
  body: Record<string, unknown> | null;
}

type Answer = { status: number; body: unknown };

function stub(answers: (path: string) => Answer) {
  const seen: Seen[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string, init?: RequestInit) => {
      const url = new URL(input);
      const path = url.pathname.replace('/rest/v1/', '');
      seen.push({ path, search: url.search, body: init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : null });
      const a = answers(path);
      return new Response(JSON.stringify(a.body), { status: a.status });
    }),
  );
  return seen;
}

function event(url: string, body: unknown, auth = true) {
  return {
    request: new Request(url, {
      method: 'POST',
      headers: auth ? { authorization: 'Bearer jwt', 'content-type': 'application/json' } : {},
      body: JSON.stringify(body),
    }),
    platform: { env },
    locals: { requestId: 't' },
  };
}

const org = (b: unknown, auth = true) =>
  postOrganization(event('https://hour.test/api/organizations', b, auth) as unknown as Parameters<typeof postOrganization>[0]);
const person = (b: unknown) =>
  postPerson(event('https://hour.test/api/persons', b) as unknown as Parameters<typeof postPerson>[0]);

const orgRow = { id: ORG, workspace_id: WS, slug: 'mercat-de-les-flors', name: 'Mercat de les Flors', notes: 'x' };
const personRow = { workspace_id: WS, person_id: PERSON, slug: 'anna-puig', full_name: 'Anna Puig', email: null, phone: null, title: null, organization_id: null };

afterEach(() => vi.unstubAllGlobals());

describe('POST /api/organizations', () => {
  it('sends the fields to the RPC, empty as null, and answers what opens its file', async () => {
    const seen = stub(() => ({ status: 200, body: orgRow }));
    const res = await org({ workspace_id: WS, name: ' Mercat de les Flors ', kind: 'theatre', city: '', email: '' });
    expect(res.status).toBe(201);
    expect(seen[0]!.path).toBe('rpc/create_workspace_organization');
    expect(seen[0]!.body).toEqual({
      p_workspace_id: WS,
      p_name: 'Mercat de les Flors',
      p_kind: 'theatre',
      p_city: null,
      p_email: null,
    });
    expect(((await res.json()) as { organization: unknown }).organization).toEqual({
      id: ORG,
      workspace_id: WS,
      slug: 'mercat-de-les-flors',
      name: 'Mercat de les Flors',
    });
  });

  it('a name the space has is 409 with that organization, looked up whole', async () => {
    const seen = stub((path) =>
      path === 'rpc/create_workspace_organization'
        ? { status: 409, body: { code: '23505', message: 'another organization in this workspace has that name' } }
        : { status: 200, body: [orgRow] },
    );
    const res = await org({ workspace_id: WS, name: 'mercat de les flors' });
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: string; organization: { slug: string } };
    expect(body.error).toBe('name_taken');
    expect(body.organization.slug).toBe('mercat-de-les-flors');
    expect(new URLSearchParams(seen[1]!.search).get('name')).toBe('ilike.mercat de les flors');
  });

  it.each([
    ['no name', { workspace_id: WS, name: '  ' }],
    ['no space', { name: 'X' }],
    ['an unknown type', { workspace_id: WS, name: 'X', kind: 'bar' }],
  ])('refuses %s without asking the database', async (_label, body) => {
    const seen = stub(() => ({ status: 200, body: orgRow }));
    expect((await org(body)).status).toBe(400);
    expect(seen).toHaveLength(0);
  });

  it('without a session, 401; a role that cannot, 403', async () => {
    stub(() => ({ status: 403, body: { code: '42501', message: 'workspace not found' } }));
    expect((await org({ workspace_id: WS, name: 'X' }, false)).status).toBe(401);
    expect((await org({ workspace_id: WS, name: 'X' })).status).toBe(403);
  });
});

describe('POST /api/persons with an organization', () => {
  it('sets the organization of a new dossier', async () => {
    const seen = stub(() => ({ status: 200, body: personRow }));
    const res = await person({ workspace_id: WS, full_name: 'Anna Puig', organization_id: ORG });
    expect(res.status).toBe(201);
    expect(seen.map((s) => s.path)).toEqual(['rpc/create_workspace_person', 'rpc/set_workspace_person_organization']);
    expect(seen[1]!.body).toEqual({ p_workspace_id: WS, p_person_id: PERSON, p_organization_id: ORG });
    expect(((await res.json()) as { organized: boolean }).organized).toBe(true);
  });

  it('a deduplicated dossier keeps its own organization', async () => {
    const seen = stub(() => ({ status: 200, body: { ...personRow, organization_id: 'other' } }));
    await person({ workspace_id: WS, full_name: 'Anna Puig', email: 'anna@x.cat', organization_id: ORG });
    expect(seen.map((s) => s.path)).toEqual(['rpc/create_workspace_person']);
  });

  it('the person exists when the organization step fails, and the answer says so', async () => {
    stub((path) =>
      path === 'rpc/set_workspace_person_organization'
        ? { status: 403, body: { code: '42501', message: 'organization not found' } }
        : { status: 200, body: personRow },
    );
    const res = await person({ workspace_id: WS, full_name: 'Anna Puig', organization_id: ORG });
    expect(res.status).toBe(201);
    expect(((await res.json()) as { organized: boolean }).organized).toBe(false);
  });

  it('without an organization, one call and no «organized»', async () => {
    const seen = stub(() => ({ status: 200, body: personRow }));
    const res = await person({ workspace_id: WS, full_name: 'Anna Puig' });
    expect(seen).toHaveLength(1);
    expect(await res.json()).not.toHaveProperty('organized');
  });
});

describe('GET /api/organizations/can-create', () => {
  const probe = () =>
    canCreate({
      request: new Request('https://hour.test/api/organizations/can-create', { headers: { authorization: 'Bearer jwt' } }),
      platform: { env },
    } as unknown as Parameters<typeof canCreate>[0]);

  it('the function refusing the nil space means it exists, and nothing was written', async () => {
    const seen = stub(() => ({ status: 403, body: { code: '42501', message: 'workspace not found' } }));
    expect(await (await probe()).json()).toEqual({ available: true });
    expect(seen[0]!.path).toBe('rpc/create_workspace_organization');
    expect(seen[0]!.body).toEqual({ p_workspace_id: '00000000-0000-0000-0000-000000000000', p_name: '' });
  });

  it('before the migration PostgREST does not know it: not available', async () => {
    stub(() => ({ status: 404, body: { code: 'PGRST202', message: 'Could not find the function' } }));
    expect(await (await probe()).json()).toEqual({ available: false });
  });
});
