/**
 * RLS — the public road sheet carries the shared note to every role and the
 * company contact to the venue alone
 * (`20261119150000_roadsheet_contact_shared_note`, ADR-226).
 *
 * `get_public_roadsheet` runs as anon with the token, straight against
 * PostgREST: what it returns is what any link holder reads. Here:
 *   - `performance.shared_note` reaches EVERY role; `performance.notes` (the
 *     internal ones) reaches none (the RPC never carried them).
 *   - `company_contact` exists only on the venue link: the workspace's public
 *     contact by default, or the one person an editor chose for the function
 *     (their name and phone, honoring the crew row's `contact_override`) while
 *     they are still in its team. Nobody else's phone ever rides along.
 *   - the performer and tech_manager links never carry the key.
 *
 * In `zzz-e2e-collab` (`playwright`), on a 2031 performance it creates. The
 * workspace is only READ (its phone may be empty: then the venue gets null
 * and the test says so; other files edit that phone, so this one never
 * does). The chosen-person cases need the login's own person; they are
 * skipped when the login has none. Revokes and deletes what it creates.
 */

import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { decodeJwt, envReady, login, pgGet, pgPatch, pgPost, pgRpc, requireEnv } from './_helpers';

const RUN = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const one = <T>(data: T | T[] | null): T | undefined => (Array.isArray(data) ? data[0] : (data ?? undefined));

const SHARED_NOTE = `zzz-shared-note-${RUN}`;
const INTERNAL_NOTE = `zzz-internal-note-${RUN}`;
const CREW_PHONE = `+34 600 ${RUN.replace(/\D/g, '').slice(-6)}`;

type Contact = { kind: 'company' | 'person'; name: string; phone: string };
type Bundle = {
  role: string;
  performance: { shared_note: string | null; notes?: unknown };
  company_contact?: Contact | null;
  cast: Array<{ person: { phone: string | null; email: string | null } }>;
  crew: Array<{ person: { phone: string | null; email: string | null } }>;
};

describe.skipIf(!envReady())('RLS — public road sheet: shared note and company contact (ADR-226)', () => {
  let jwt: string;
  let perfId: string;
  let workspaceId: string;
  let personId: string | null = null;
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
    const { id: projectId, workspace_id } = p.rows[0]!;
    workspaceId = workspace_id;

    const perf = await pgRpc<{ id: string }>('create_performance', jwt, {
      p_project_id: projectId,
      p_performed_at: '2031-09-09',
      p_status: 'hold_1',
      p_venue_name: `ZZZ Contact ${RUN}`,
    });
    expect(perf.status, perf.error).toBe(200);
    perfId = one(perf.data)!.id;

    const patched = await pgPatch(
      'performance',
      jwt,
      { shared_note: SHARED_NOTE, notes: INTERNAL_NOTE },
      // Only `id` back: `performance` is read by columns (see 20260829120000).
      new URLSearchParams({ id: `eq.${perfId}`, select: 'id' }),
    );
    expect(patched.status).toBeLessThan(300);

    const up = await pgGet<{ person_id: string | null }>(
      'user_profile',
      jwt,
      new URLSearchParams({ select: 'person_id', user_id: `eq.${me}` }),
    );
    personId = up.rows[0]?.person_id ?? null;
    if (personId) {
      const crew = await pgPost<{ id: string }>('crew_assignment', jwt, {
        workspace_id: workspaceId,
        performance_id: perfId,
        person_id: personId,
        role: 'sound',
        contact_override: { phone: CREW_PHONE },
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

  const choose = async (id: string | null) => {
    const r = await pgPatch(
      'performance',
      jwt,
      { venue_contact_person_id: id },
      new URLSearchParams({ id: `eq.${perfId}`, select: 'id' }),
    );
    expect(r.status).toBeLessThan(300);
  };

  const workspace = async () => {
    const w = await pgGet<{ name: string; phone: string | null }>(
      'workspace',
      jwt,
      new URLSearchParams({ select: 'name,phone', id: `eq.${workspaceId}` }),
    );
    const row = w.rows[0]!;
    return { name: row.name, phone: row.phone?.trim() || null };
  };

  test('every role gets the shared note; nobody gets the internal notes', async () => {
    for (const role of ['venue', 'performer', 'tech_manager']) {
      const b = await read(role);
      expect(b.performance.shared_note, role).toBe(SHARED_NOTE);
      expect(JSON.stringify(b), role).not.toContain(INTERNAL_NOTE);
      expect(b.performance, role).not.toHaveProperty('notes');
    }
  });

  test('the performer and tech_manager links never carry company_contact', async () => {
    for (const role of ['performer', 'tech_manager']) {
      const b = await read(role);
      expect(b, role).not.toHaveProperty('company_contact');
    }
  });

  test('venue, nobody chosen: the workspace’s public contact (or null without a phone)', async () => {
    await choose(null);
    const ws = await workspace();
    const b = await read('venue');
    expect(b).toHaveProperty('company_contact');
    if (ws.phone) {
      expect(b.company_contact).toEqual({ kind: 'company', name: ws.name, phone: ws.phone });
    } else {
      expect(b.company_contact).toBeNull();
    }
    // The one number the venue gets is not anyone else's: the team stays names only.
    for (const person of [...b.cast, ...b.crew].map((e) => e.person)) {
      expect(person.phone).toBeNull();
      expect(person.email).toBeNull();
    }
  });

  test('venue, a person chosen: their name and phone, and only theirs', async () => {
    if (!personId || !crewId) return; // the login has no person: nothing to choose
    await choose(personId);
    const b = await read('venue');
    expect(b.company_contact?.kind).toBe('person');
    expect(b.company_contact?.phone).toBe(CREW_PHONE);
    expect(b.company_contact?.name.trim().length).toBeGreaterThan(0);
    // Their phone is in `company_contact` and nowhere else on the venue's sheet.
    expect(JSON.stringify(b).split(CREW_PHONE).length - 1).toBe(1);
    for (const person of [...b.cast, ...b.crew].map((e) => e.person)) expect(person.phone).toBeNull();
    // The other links still do not carry the key.
    expect(await read('performer')).not.toHaveProperty('company_contact');
    expect(await read('tech_manager')).not.toHaveProperty('company_contact');
  });

  test('venue, the chosen person left the team: back to the company, never a stale person', async () => {
    if (!personId || !crewId) return;
    await choose(personId);
    const gone = await pgPatch(
      'crew_assignment',
      jwt,
      { deleted_at: new Date().toISOString() },
      new URLSearchParams({ id: `eq.${crewId}`, select: 'id' }),
    );
    expect(gone.status).toBeLessThan(300);
    const ws = await workspace();
    const b = await read('venue');
    expect(JSON.stringify(b)).not.toContain(CREW_PHONE);
    if (ws.phone) expect(b.company_contact).toEqual({ kind: 'company', name: ws.name, phone: ws.phone });
    else expect(b.company_contact).toBeNull();
  });
});
