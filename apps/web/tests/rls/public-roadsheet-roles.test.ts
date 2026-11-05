/**
 * RLS — the public road sheet applies the role matrix INSIDE the base
 * (`20261105120000_public_roadsheet_role_matrix`, 120).
 *
 * `get_public_roadsheet` runs as anon with the token and the public anon key,
 * straight against PostgREST: what it returns is what any link holder can
 * read, Worker or not. So the matrix of ADR-041 (`ROLE_SECTIONS`,
 * `PERSONAL_CONTACTS` in `$lib/roadsheet`) holds here too:
 *   - logistics: performer and tech_manager; hospitality: performer;
 *     technical: venue and tech_manager; otherwise `{}`.
 *   - email and phone of cast and crew, crew notes and contact override:
 *     tech_manager only.
 *   - assets: tech_manager only, never with notes. Never any money.
 *
 * In `zzz-e2e-collab` (`playwright`), on a 2031 performance it creates, with
 * a crew row of the test user's own person when the login has one. Revokes
 * and deletes what it creates.
 */

import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { decodeJwt, envReady, login, pgGet, pgPatch, pgPost, pgRpc, requireEnv } from './_helpers';

const RUN = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const one = <T>(data: T | T[] | null): T | undefined => (Array.isArray(data) ? data[0] : (data ?? undefined));

type Person = { full_name: string; email: string | null; phone: string | null };
type Bundle = {
  role: string;
  performance: { logistics: unknown; hospitality: unknown; technical: unknown };
  cast: Array<{ person: Person }>;
  cast_overrides: Array<{ person: Person }>;
  crew: Array<{ notes: string | null; contact_override: unknown; person: Person }>;
  assets: Array<{ notes: string | null }>;
};

describe.skipIf(!envReady())('RLS — public road sheet role matrix (120)', () => {
  let jwt: string;
  let perfId: string;
  let crewId: string | null = null;
  const shares: string[] = [];

  beforeAll(async () => {
    const env = requireEnv();
    jwt = await login(env.email, env.password);
    const me = String(decodeJwt(jwt).sub);
    const p = await pgGet<{ id: string; workspace_id: string }>(
      'project',
      jwt,
      new URLSearchParams({
        select: 'id,workspace_id,workspace:workspace_id!inner(slug)',
        'workspace.slug': 'eq.playwright',
        slug: 'eq.zzz-e2e-collab',
        deleted_at: 'is.null',
        limit: '1',
      }),
    );
    if (p.rows.length === 0) throw new Error('zzz-e2e-collab missing in playwright');
    const { id: projectId, workspace_id: workspaceId } = p.rows[0]!;

    const perf = await pgRpc<{ id: string }>('create_performance', jwt, {
      p_project_id: projectId,
      p_performed_at: '2031-08-12',
      p_status: 'hold_1',
      p_venue_name: `ZZZ Roles ${RUN}`,
    });
    expect(perf.status, perf.error).toBe(200);
    perfId = one(perf.data)!.id;

    const patched = await pgPatch(
      'performance',
      jwt,
      {
        logistics: { hotel: `zzz-logistics-${RUN}` },
        hospitality: { dietas: `zzz-hospitality-${RUN}` },
        technical: { varas: `zzz-technical-${RUN}` },
      },
      new URLSearchParams({ id: `eq.${perfId}` }),
    );
    expect(patched.status).toBeLessThan(300);

    const up = await pgGet<{ person_id: string | null }>(
      'user_profile',
      jwt,
      new URLSearchParams({ select: 'person_id', user_id: `eq.${me}` }),
    );
    const personId = up.rows[0]?.person_id ?? null;
    if (personId) {
      const crew = await pgPost<{ id: string }>('crew_assignment', jwt, {
        workspace_id: workspaceId,
        performance_id: perfId,
        person_id: personId,
        role: 'sound',
        notes: `zzz-crew-note-${RUN}`,
      });
      crewId = crew.rows[0]?.id ?? null;
    }
  });

  afterAll(async () => {
    if (!jwt) return;
    for (const id of shares) await pgRpc('revoke_roadsheet_share', jwt, { p_share_id: id });
    if (crewId) {
      await pgPatch('crew_assignment', jwt, { deleted_at: new Date().toISOString() }, new URLSearchParams({ id: `eq.${crewId}` }));
    }
    if (perfId) await pgRpc('delete_performance', jwt, { p_performance_id: perfId });
  });

  const read = async (role: string): Promise<Bundle> => {
    const s = await pgRpc<{ id: string; token: string }>('create_roadsheet_share', jwt, {
      p_performance_id: perfId,
      p_role: role,
    });
    expect(s.status, s.error).toBe(200);
    const share = one(s.data)!;
    shares.push(share.id);
    const pub = await pgRpc<Bundle>('get_public_roadsheet', null, { p_token: share.token });
    expect(pub.status, pub.error).toBe(200);
    return one(pub.data)!;
  };

  const people = (b: Bundle) => [...b.cast, ...b.cast_overrides, ...b.crew].map((e) => e.person);

  test('venue: technical only; no company logistics or hospitality, no phones or notes', async () => {
    const b = await read('venue');
    const raw = JSON.stringify(b);
    expect(raw).toContain(`zzz-technical-${RUN}`);
    expect(raw).not.toContain(`zzz-logistics-${RUN}`);
    expect(raw).not.toContain(`zzz-hospitality-${RUN}`);
    expect(raw).not.toContain(`zzz-crew-note-${RUN}`);
    for (const p of people(b)) {
      expect(p.email).toBeNull();
      expect(p.phone).toBeNull();
    }
    expect(b.assets).toEqual([]);
    expect(raw).not.toMatch(/fee_amount|fee_currency/);
  });

  test('performer: logistics and hospitality; no technical, no phones or notes', async () => {
    const b = await read('performer');
    const raw = JSON.stringify(b);
    expect(raw).toContain(`zzz-logistics-${RUN}`);
    expect(raw).toContain(`zzz-hospitality-${RUN}`);
    expect(raw).not.toContain(`zzz-technical-${RUN}`);
    expect(raw).not.toContain(`zzz-crew-note-${RUN}`);
    for (const p of people(b)) {
      expect(p.email).toBeNull();
      expect(p.phone).toBeNull();
    }
    expect(b.assets).toEqual([]);
  });

  test('tech_manager: logistics, technical and the crew’s contacts; no hospitality, no asset notes', async () => {
    const b = await read('tech_manager');
    const raw = JSON.stringify(b);
    expect(raw).toContain(`zzz-logistics-${RUN}`);
    expect(raw).toContain(`zzz-technical-${RUN}`);
    expect(raw).not.toContain(`zzz-hospitality-${RUN}`);
    if (crewId) expect(raw).toContain(`zzz-crew-note-${RUN}`);
    for (const a of b.assets) expect(a.notes).toBeNull();
    expect(raw).not.toMatch(/fee_amount|fee_currency/);
  });
});
