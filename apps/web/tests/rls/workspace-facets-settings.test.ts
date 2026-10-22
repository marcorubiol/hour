import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import {
  decodeJwt,
  envReady,
  limitedEnvReady,
  login,
  pgGet,
  pgPatch,
  pgPost,
  pgRpc,
  projectAccess,
  requireEnv,
  requireLimitedEnv,
  type ProjectAccess,
} from './_helpers';

/**
 * Comms carril 2, fase 4: las facetas del espacio en Ajustes. Sin migración:
 * fija lo que ya daba 20261011100000_permissions_facets_expand a la pantalla
 * nueva (`/api/workspaces/[id]/facets`, que escribe directo con la RLS).
 *
 * - el admin crea una propia, la renombra, marca y desmarca dónde existe, y
 *   renombra, apaga y ordena una estándar en su espacio;
 * - apagar una faceta no cambia ninguna lectura de datos (structure-model
 *   § Facet): el admin y un miembro leen lo mismo con Diners apagada;
 * - un ajuste por persona con una propia, por `set_membership_facet`, queda
 *   como `override` y se quita;
 * - quien no es admin no crea, no renombra, no toca niveles ni ajustes.
 *
 * Fixture: `playwright`, proyecto `zzz-e2e-collab`. Nunca toca `muk-cia`. La
 * propia `zzz_rls_facets` se reutiliza entre pasadas (no hay DELETE en
 * `facet`); los ajustes estándar vuelven a como estaban.
 */
const KEY = 'zzz_rls_facets';
const RUN = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

interface Facet {
  id: string;
  key: string;
  workspace_id: string | null;
  label: string | null;
}
interface Setting {
  workspace_id: string;
  facet_id: string;
  label: string | null;
  active: boolean;
  sort: number | null;
}

describe.skipIf(!envReady() || !limitedEnvReady())('workspace facets in settings (comms 2, phase 4)', () => {
  let admin: string;
  let adminSub: string;
  let limited: string;
  let limitedSub: string;
  let workspaceId: string;
  let projectId: string;
  let own: Facet;
  let diners: string;
  let tecnica: string;
  let before: Map<string, Setting | undefined>;
  let limitedAccess: ProjectAccess | null = null;

  async function settingOf(jwt: string, facetId: string): Promise<Setting | undefined> {
    const r = await pgGet<Setting>(
      'workspace_facet_setting',
      jwt,
      new URLSearchParams({ workspace_id: `eq.${workspaceId}`, facet_id: `eq.${facetId}`, select: 'workspace_id,facet_id,label,active,sort' }),
    );
    return r.rows[0];
  }

  /** The way the endpoint writes it: patch the setting if it exists, insert it if not. */
  async function writeSetting(jwt: string, facetId: string, patch: Partial<Omit<Setting, 'workspace_id' | 'facet_id'>>) {
    if (await settingOf(admin, facetId)) {
      return pgPatch<Setting>(
        'workspace_facet_setting',
        jwt,
        patch,
        new URLSearchParams({ workspace_id: `eq.${workspaceId}`, facet_id: `eq.${facetId}` }),
      );
    }
    return pgPost<Setting>('workspace_facet_setting', jwt, { workspace_id: workspaceId, facet_id: facetId, ...patch });
  }

  async function levelsOf(facetId: string): Promise<string[]> {
    const r = await pgGet<{ level: string }>('facet_level', admin, new URLSearchParams({ facet_id: `eq.${facetId}`, select: 'level' }));
    return r.rows.map((x) => x.level).sort();
  }

  const del = (jwt: string, query: string) =>
    fetch(`${requireEnv().url}/rest/v1/${query}`, {
      method: 'DELETE',
      headers: { apikey: requireEnv().anon, Authorization: `Bearer ${jwt}`, Prefer: 'return=representation' },
    });

  beforeAll(async () => {
    const env = requireEnv();
    admin = await login(env.email, env.password);
    adminSub = String(decodeJwt(admin).sub);
    const lim = requireLimitedEnv();
    limited = await login(lim.email, lim.password);
    limitedSub = String(decodeJwt(limited).sub);

    const p = await pgGet<{ id: string; workspace_id: string }>(
      'project',
      admin,
      new URLSearchParams({
        select: 'id,workspace_id,workspace:workspace_id!inner(slug)',
        'workspace.slug': 'eq.playwright',
        slug: 'eq.zzz-e2e-collab',
        deleted_at: 'is.null',
        limit: '1',
      }),
    );
    if (p.rows.length === 0) throw new Error('zzz-e2e-collab missing in playwright');
    projectId = p.rows[0]!.id;
    workspaceId = p.rows[0]!.workspace_id;

    const std = await pgGet<Facet>('facet', admin, new URLSearchParams({ workspace_id: 'is.null', select: 'id,key' }));
    diners = std.rows.find((x) => x.key === 'diners')!.id;
    tecnica = std.rows.find((x) => x.key === 'tecnica')!.id;
    before = new Map([
      [diners, await settingOf(admin, diners)],
      [tecnica, await settingOf(admin, tecnica)],
    ]);

    own = (
      await pgGet<Facet>(
        'facet',
        admin,
        new URLSearchParams({ workspace_id: `eq.${workspaceId}`, key: `eq.${KEY}`, select: 'id,key,workspace_id,label' }),
      )
    ).rows[0]!;
    if (!own) {
      const made = await pgPost<Facet>('facet', admin, {
        workspace_id: workspaceId,
        key: KEY,
        label: 'ZZZ RLS facets',
        created_by: adminSub,
        sort: 900,
      });
      expect(made.status).toBe(201);
      own = made.rows[0]!;
    }
    if (!(await levelsOf(own.id)).includes('project')) {
      expect((await pgPost('facet_level', admin, { facet_id: own.id, level: 'project' })).status).toBe(201);
    }

    limitedAccess = await projectAccess(admin, projectId, limitedSub).catch(() => null);
  });

  afterAll(async () => {
    if (own) {
      await pgPatch('facet', admin, { label: 'ZZZ RLS facets' }, new URLSearchParams({ id: `eq.${own.id}` }));
      await del(admin, `facet_level?facet_id=eq.${own.id}&level=eq.bolo`).catch(() => undefined);
      if (limitedAccess) {
        await pgRpc('set_membership_facet', admin, {
          p_membership_id: limitedAccess.membershipId,
          p_facet_id: own.id,
          p_verb: null,
        }).catch(() => undefined);
      }
    }
    for (const [id, s] of before ?? []) {
      const back = s ? { label: s.label, active: s.active, sort: s.sort } : { label: null, active: true, sort: null };
      await writeSetting(admin, id, back).catch(() => undefined);
    }
  });

  test('the admin renames an own facet and ticks and unticks where it exists', async () => {
    expect(own.workspace_id).toBe(workspaceId);
    const r = await pgPatch<Facet>('facet', admin, { label: `ZZZ RLS ${RUN}` }, new URLSearchParams({ id: `eq.${own.id}` }));
    expect(r.rows.map((x) => x.label)).toEqual([`ZZZ RLS ${RUN}`]);
    // The key never changes: the presets and the translations use it.
    const k = await pgPatch('facet', admin, { key: 'zzz_other' }, new URLSearchParams({ id: `eq.${own.id}` }));
    expect(k.status).toBeGreaterThanOrEqual(400);

    expect((await pgPost('facet_level', admin, { facet_id: own.id, level: 'bolo' })).status).toBe(201);
    expect(await levelsOf(own.id)).toEqual(['bolo', 'project']);
    const gone = await del(admin, `facet_level?facet_id=eq.${own.id}&level=eq.bolo`);
    expect(gone.status).toBeLessThan(300);
    expect(await levelsOf(own.id)).toEqual(['project']);
  });

  test('a standard facet is renamed, ordered and turned off in the space, never in its own row', async () => {
    expect((await writeSetting(admin, tecnica, { label: 'Tècnica de sala', sort: 5 })).status).toBeLessThan(300);
    expect(await settingOf(admin, tecnica)).toMatchObject({ label: 'Tècnica de sala', sort: 5 });
    // A member reads it (the threads name it).
    expect((await settingOf(limited, tecnica))?.label).toBe('Tècnica de sala');
    const std = await pgPatch<Facet>('facet', admin, { label: 'Nope' }, new URLSearchParams({ id: `eq.${tecnica}` }));
    expect(std.rows).toEqual([]);
    // Where a standard facet exists is Hour's table: nobody moves it.
    const lvl = await pgPost('facet_level', admin, { facet_id: tecnica, level: 'performance' });
    expect(lvl.status).toBeGreaterThanOrEqual(400);
  });

  test('turning Diners off changes no read of data', async () => {
    const read = async (jwt: string) => {
      const r = await pgGet<{ id: string }>(
        'bolo',
        jwt,
        new URLSearchParams({ workspace_id: `eq.${workspaceId}`, select: 'id', order: 'id' }),
      );
      return r.rows.map((x) => x.id);
    };
    const adminBefore = await read(admin);
    const limitedBefore = await read(limited);
    expect((await writeSetting(admin, diners, { active: false })).status).toBeLessThan(300);
    expect(await read(admin)).toEqual(adminBefore);
    expect(await read(limited)).toEqual(limitedBefore);
    expect((await writeSetting(admin, diners, { active: true })).status).toBeLessThan(300);
  });

  test('a per-person adjustment with an own facet is an override, and it comes off', async () => {
    if (!limitedAccess) return;
    const set = (verb: 'view' | 'edit' | null) =>
      pgRpc('set_membership_facet', admin, { p_membership_id: limitedAccess!.membershipId, p_facet_id: own.id, p_verb: verb });
    expect((await set('view')).status).toBeLessThan(300);
    const row = await pgGet<{ verb: string; source: string; granted_by: string }>(
      'membership_facet',
      admin,
      new URLSearchParams({ membership_id: `eq.${limitedAccess.membershipId}`, facet_id: `eq.${own.id}`, select: 'verb,source,granted_by' }),
    );
    expect(row.rows).toEqual([{ verb: 'view', source: 'override', granted_by: adminSub }]);
    // The person reads their own grant; nobody else's.
    const mine = await pgGet('membership_facet', limited, new URLSearchParams({ membership_id: `eq.${limitedAccess.membershipId}`, facet_id: `eq.${own.id}`, select: 'verb' }));
    expect(mine.rows).toHaveLength(1);
    // They cannot raise it themselves.
    const raised = await pgRpc('set_membership_facet', limited, {
      p_membership_id: limitedAccess.membershipId,
      p_facet_id: own.id,
      p_verb: 'edit',
    });
    expect(raised.status).toBeGreaterThanOrEqual(400);
    expect((await set(null)).status).toBeLessThan(300);
  });

  test('a member that is not admin creates, renames and configures nothing', async () => {
    const made = await pgPost('facet', limited, {
      workspace_id: workspaceId,
      key: `zzz_${RUN}`.slice(0, 32),
      label: 'nope',
      created_by: limitedSub,
    });
    expect(made.status).toBeGreaterThanOrEqual(400);
    const renamed = await pgPatch<Facet>('facet', limited, { label: 'nope' }, new URLSearchParams({ id: `eq.${own.id}` }));
    expect(renamed.rows).toEqual([]);

    const level = await pgPost('facet_level', limited, { facet_id: own.id, level: 'line' });
    expect(level.status).toBeGreaterThanOrEqual(400);
    await del(limited, `facet_level?facet_id=eq.${own.id}&level=eq.project`);
    expect(await levelsOf(own.id)).toContain('project');

    const settingBefore = await settingOf(admin, tecnica);
    if (settingBefore) {
      const off = await pgPatch<Setting>(
        'workspace_facet_setting',
        limited,
        { active: false, label: 'nope' },
        new URLSearchParams({ workspace_id: `eq.${workspaceId}`, facet_id: `eq.${tecnica}` }),
      );
      expect(off.rows).toEqual([]);
    }
    const inserted = await pgPost('workspace_facet_setting', limited, { workspace_id: workspaceId, facet_id: own.id, active: false });
    expect(inserted.status).toBeGreaterThanOrEqual(400);
    expect(await settingOf(admin, tecnica)).toEqual(settingBefore);

    // Nobody deletes a facet: turning it off is the way.
    const gone = await del(admin, `facet?id=eq.${own.id}`);
    expect(gone.status).toBeGreaterThanOrEqual(400);
  });
});
