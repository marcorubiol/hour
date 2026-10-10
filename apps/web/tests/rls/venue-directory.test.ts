import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { envReady, login, pgGet, pgPatch, pgPost, pgRpc, requireEnv } from './_helpers';

/**
 * Directorio global de salas, fase 1 (20261010200000_venue_directory).
 *
 * Fixes:
 * - any authenticated user reads the directory and its sources; anon reads
 *   nothing;
 * - nobody writes the directory through the API: insert, update and delete
 *   are refused for authenticated and anon (only the import, service role);
 * - `adopt_directory_venue` copies an entry into a venue of the space with
 *   `directory_id`, is idempotent, links a same-name+city venue of the space
 *   WITHOUT overwriting it, refuses a space the caller is not a member of,
 *   refuses anon, and an entry that does not exist is 22023.
 *
 * The adopt cases need at least one entry, so they skip on a base where the
 * import has not run (the read and write-refusal cases do not). Everything
 * the test creates lives in the `playwright` space and is deleted at the
 * end. Never `muk-cia`.
 */
interface Entry {
  id: string;
  name: string;
  city: string | null;
  country: string;
  capacity: number | null;
  timezone: string | null;
  address: string | null;
}
interface VenueRow {
  id: string;
  name: string;
  city: string | null;
  capacity: number | null;
  timezone: string | null;
  directory_id: string | null;
}

const one = <T>(data: T | T[] | null): T | undefined => (Array.isArray(data) ? data[0] : (data ?? undefined));

describe.skipIf(!envReady())('venue directory: global, read-only, adoptable', () => {
  let jwt: string;
  let wsId: string;
  let entry: Entry | undefined;
  const created: string[] = [];

  async function deleteVenue(id: string) {
    const { url, anon } = requireEnv();
    await fetch(`${url}/rest/v1/venue?id=eq.${id}`, {
      method: 'DELETE',
      headers: { apikey: anon, Authorization: `Bearer ${jwt}` },
    });
  }

  beforeAll(async () => {
    const env = requireEnv();
    jwt = await login(env.email, env.password);
    const ws = await pgGet<{ id: string }>('workspace?slug=eq.playwright&select=id', jwt);
    expect(ws.status).toBe(200);
    wsId = ws.rows[0]!.id;
    // An entry with a city, so the name+city link case has something to match.
    const e = await pgGet<Entry>(
      'venue_directory?select=id,name,city,country,capacity,timezone,address&status=eq.active&city=not.is.null&capacity=not.is.null&order=id&limit=1',
      jwt,
    );
    expect(e.status).toBe(200);
    entry = e.rows[0];
  });

  afterAll(async () => {
    for (const id of created) await deleteVenue(id);
  });

  it('an authenticated user reads the directory and its sources', async () => {
    const d = await pgGet('venue_directory?select=id,source,source_id,name,kind,status&limit=5', jwt);
    expect(d.status).toBe(200);
    const s = await pgGet<{ key: string; license: string }>('venue_directory_source?select=key,license', jwt);
    expect(s.status).toBe(200);
  });

  it('anon reads nothing', async () => {
    const d = await pgGet('venue_directory?select=id&limit=1', null);
    expect(d.rows).toHaveLength(0);
    expect([401, 403]).toContain(d.status);
    const s = await pgGet('venue_directory_source?select=key&limit=1', null);
    expect(s.rows).toHaveLength(0);
    expect([401, 403]).toContain(s.status);
  });

  it('nobody writes the directory through the API', async () => {
    const ins = await pgPost('venue_directory', jwt, {
      source: 'wikidata',
      source_id: 'Q999999999',
      name: 'ZZZ RLS forged',
      kind: 'theatre',
      country: 'ES',
      search_key: 'zzz',
    });
    expect([401, 403]).toContain(ins.status);
    const insAnon = await pgPost('venue_directory', null, {
      source: 'wikidata',
      source_id: 'Q999999998',
      name: 'ZZZ RLS forged',
      kind: 'theatre',
      country: 'ES',
      search_key: 'zzz',
    });
    expect([401, 403]).toContain(insAnon.status);
    const src = await pgPost('venue_directory_source', jwt, {
      key: 'zzz_forged',
      name: 'x',
      publisher: 'x',
      license: 'x',
      license_url: 'x',
      source_url: 'x',
      attribution: 'x',
    });
    expect([401, 403]).toContain(src.status);
  });

  it('an entry cannot be edited nor deleted by a user', async (ctx) => {
    if (!entry) ctx.skip();
    const up = await pgPatch('venue_directory', jwt, { name: 'ZZZ hijacked' }, new URLSearchParams({ id: `eq.${entry!.id}` }));
    expect([401, 403]).toContain(up.status);
    const { url, anon } = requireEnv();
    const del = await fetch(`${url}/rest/v1/venue_directory?id=eq.${entry!.id}`, {
      method: 'DELETE',
      headers: { apikey: anon, Authorization: `Bearer ${jwt}` },
    });
    expect([401, 403]).toContain(del.status);
    const after = await pgGet<Entry>(`venue_directory?select=id,name&id=eq.${entry!.id}`, jwt);
    expect(after.rows[0]?.name).toBe(entry!.name);
  });

  it('a venue of the space with the same name and city is linked, not overwritten', async (ctx) => {
    if (!entry) ctx.skip();
    const mine = await pgRpc<VenueRow>('create_venue', jwt, {
      p_workspace_id: wsId,
      p_name: entry!.name,
      p_city: entry!.city,
      p_capacity: 7,
    });
    expect(mine.status, mine.error).toBe(200);
    const v = one(mine.data)!;
    created.push(v.id);
    const r = await pgRpc<VenueRow>('adopt_directory_venue', jwt, { p_workspace_id: wsId, p_directory_id: entry!.id });
    expect(r.status, r.error).toBe(200);
    expect(one(r.data)).toMatchObject({ id: v.id, capacity: 7, directory_id: entry!.id });
    await deleteVenue(v.id);
    created.splice(created.indexOf(v.id), 1);
  });

  it('adopt copies the entry into the space, once', async (ctx) => {
    if (!entry) ctx.skip();
    const r = await pgRpc<VenueRow>('adopt_directory_venue', jwt, { p_workspace_id: wsId, p_directory_id: entry!.id });
    expect(r.status, r.error).toBe(200);
    const v = one(r.data)!;
    created.push(v.id);
    expect(v).toMatchObject({
      name: entry!.name.trim(),
      city: entry!.city,
      capacity: entry!.capacity,
      timezone: entry!.timezone,
      directory_id: entry!.id,
    });
    const again = await pgRpc<VenueRow>('adopt_directory_venue', jwt, { p_workspace_id: wsId, p_directory_id: entry!.id });
    expect(again.status, again.error).toBe(200);
    expect(one(again.data)?.id).toBe(v.id);
    // The copy is the space's: it edits freely, the entry does not move.
    const edit = await pgPatch<VenueRow>('venue', jwt, { capacity: 3 }, new URLSearchParams({ id: `eq.${v.id}`, select: 'id,capacity' }));
    expect(edit.status).toBe(200);
    const still = await pgGet<Entry>(`venue_directory?select=capacity&id=eq.${entry!.id}`, jwt);
    expect(still.rows[0]?.capacity).toBe(entry!.capacity);
  });

  it('adopt refuses a space the caller is not a member of, and anon', async (ctx) => {
    if (!entry) ctx.skip();
    const foreign = await pgRpc('adopt_directory_venue', jwt, {
      p_workspace_id: '00000000-0000-7000-8000-000000000000',
      p_directory_id: entry!.id,
    });
    expect(foreign.status).toBe(403);
    const anon = await pgRpc('adopt_directory_venue', null, { p_workspace_id: wsId, p_directory_id: entry!.id });
    expect([401, 403]).toContain(anon.status);
  });

  it('an entry that does not exist is 22023', async () => {
    const r = await pgRpc('adopt_directory_venue', jwt, {
      p_workspace_id: wsId,
      p_directory_id: '00000000-0000-7000-8000-000000000000',
    });
    expect(r.status).toBe(400);
    expect(r.error).toContain('22023');
  });
});
