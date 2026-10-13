/**
 * RLS regression: permisos al modelo de facetas (expand 20261011100000, fase 2
 * 20261011300000, fase 3 20261013200000 y contract 20261013300000;
 * build/permissions-facets-plan.md, ADR-099 §8, ADR-100, ADR-104).
 *
 * Desde el contract `membership` + `membership_facet` son lo único que hay:
 * las tablas viejas, la proyección y la paridad no existen. Estos tests prueban:
 *   1. Lo borrado no existe: project_membership, workspace_membership,
 *      workspace_role.permissions, can_manage_members, las RPC de paridad, y
 *      las cadenas de permiso muertas son un error.
 *   2. El acceso de cada fixture, permiso a permiso: el owner todo; la fixture
 *      limitada ve la producción y nada más, y en todo proyecto estar es ver
 *      (ADR-100 §2).
 *   3. Overrides y paquetes en el proyecto: se ven al instante en el acceso.
 *   4. Techo del delegante: con Mínim no se da ni se toma más; en el espacio,
 *      Direcció es admin y las facetas de espacio esperan decisión.
 *   5. Facetas: vocabulario estándar y tabla de niveles decididos (ADR-100),
 *      configuración por espacio solo del admin, nadie escribe membresías por
 *      la API, cada uno ve solo lo suyo salvo el admin.
 *   6. Paquetes en un bolo: Equip se expande, el techo se respeta y el acceso
 *      de proyecto no cambia.
 */

import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import {
  decodeJwt,
  envReady,
  grantPreset,
  limitedEnvReady,
  login,
  pgGet,
  pgPatch,
  pgPost,
  pgRpc,
  projectAccess,
  requireEnv,
  requireLimitedEnv,
  restoreProjectAccess,
  setFacets,
  type ProjectAccess,
} from './_helpers';

const LIVE_PERMS = [
  'read:performance',
  'edit:performance',
  'read:money',
  'edit:money',
  'read:conversation',
  'edit:conversation',
  'edit:project_meta',
] as const;

type Perms = Record<(typeof LIVE_PERMS)[number], boolean | null>;

const ONLY_SEES: Perms = {
  'read:performance': true,
  'edit:performance': false,
  'read:money': false,
  'edit:money': false,
  'read:conversation': false,
  'edit:conversation': false,
  'edit:project_meta': false,
};

const DECIDED_LEVELS: Record<string, string[]> = {
  converses: ['workspace', 'project', 'line'],
  materials: ['project', 'line', 'bolo'],
  tecnica: ['project', 'line', 'bolo'],
  logistica: ['line', 'bolo'],
  full_de_ruta: ['bolo', 'performance'],
  comidas: ['bolo', 'performance'],
  diners: ['workspace', 'project', 'line', 'bolo'],
};

interface MembershipRow {
  id: string;
  user_id: string;
  level: string;
  project_id: string | null;
  workspace_role: string | null;
  container_verb: string | null;
}

interface FacetRow {
  id: string;
  key: string;
  workspace_id: string | null;
}

interface MembershipFacetRow {
  membership_id: string;
  facet_id: string;
  verb: string;
  source: string;
}

/** Los siete permisos vivos de quien llama en un proyecto, por has_permission. */
async function perms(jwt: string, projectId: string): Promise<Perms> {
  const entries = await Promise.all(
    LIVE_PERMS.map(async (perm) => {
      const res = await pgRpc<boolean>('has_permission', jwt, { p_project_id: projectId, p_perm: perm });
      expect(res.status, perm).toBe(200);
      return [perm, res.data] as const;
    }),
  );
  return Object.fromEntries(entries) as Perms;
}

describe.skipIf(!envReady())('RLS: permisos por facetas', () => {
  let adminJwt: string;
  let adminUserId: string;
  let workspaceId: string;
  let projectIds: string[] = [];
  let standard: Record<string, string> = {};

  beforeAll(async () => {
    const admin = requireEnv();
    adminJwt = await login(admin.email, admin.password);
    adminUserId = String(decodeJwt(adminJwt).sub);

    const workspaces = await pgGet<{ id: string }>(
      'workspace',
      adminJwt,
      new URLSearchParams({ slug: 'eq.playwright', select: 'id' }),
    );
    expect(workspaces.rows).toHaveLength(1);
    workspaceId = workspaces.rows[0].id;

    const projects = await pgGet<{ id: string }>(
      'project',
      adminJwt,
      new URLSearchParams({ workspace_id: `eq.${workspaceId}`, select: 'id' }),
    );
    projectIds = projects.rows.map((row) => row.id);
    expect(projectIds.length).toBeGreaterThan(0);

    const facets = await pgGet<FacetRow>(
      'facet',
      adminJwt,
      new URLSearchParams({ workspace_id: 'is.null', select: 'id,key,workspace_id' }),
    );
    standard = Object.fromEntries(facets.rows.map((row) => [row.key, row.id]));
  });

  test('owner: los siete permisos en cada proyecto de su espacio', async () => {
    for (const projectId of projectIds) {
      expect(Object.values(await perms(adminJwt, projectId)).every(Boolean), projectId).toBe(true);
    }
  });

  test('contract: las tablas viejas, la paridad y can_manage_members no existen', async () => {
    for (const table of ['project_membership', 'workspace_membership']) {
      const res = await pgGet(table, adminJwt, new URLSearchParams({ select: '*', limit: '1' }));
      expect(res.status, table).toBeGreaterThanOrEqual(400);
    }
    for (const rpc of ['has_permission_by_facets', 'access_parity_report']) {
      const res = await pgRpc(rpc, adminJwt, { p_project_id: projectIds[0], p_perm: 'read:performance' });
      expect(res.status, rpc).toBeGreaterThanOrEqual(400);
    }
    const columns: [string, string][] = [
      ['workspace_role', 'permissions'],
      ['workspace_role', 'access_level'],
      ['membership', 'can_manage_members'],
      ['access_preset', 'can_manage_members'],
      ['project', 'owner_id'],
    ];
    for (const [table, column] of columns) {
      const res = await pgGet(table, adminJwt, new URLSearchParams({ select: column, limit: '1' }));
      expect(res.status, `${table}.${column}`).toBeGreaterThanOrEqual(400);
    }
    const dead = await pgRpc('has_permission', adminJwt, { p_project_id: projectIds[0], p_perm: 'edit:membership' });
    expect(dead.status, 'una cadena muerta es un error, no un false').toBe(400);

    const sources = await pgGet<{ source: string }>(
      'membership_facet',
      adminJwt,
      new URLSearchParams({ select: 'source', source: 'not.in.(preset,override)' }),
    );
    expect(sources).toMatchObject({ status: 200, rows: [] });
  });

  test('vocabulario: las siete facetas estándar y la tabla de niveles decidida', async () => {
    const facets = await pgGet<FacetRow>(
      'facet',
      adminJwt,
      new URLSearchParams({ workspace_id: 'is.null', select: 'id,key,workspace_id', order: 'sort' }),
    );
    expect(facets.rows.map((row) => row.key)).toEqual([
      'converses',
      'materials',
      'tecnica',
      'logistica',
      'full_de_ruta',
      'comidas',
      'diners',
    ]);

    const levels = await pgGet<{ facet_id: string; level: string }>(
      'facet_level',
      adminJwt,
      new URLSearchParams({ select: 'facet_id,level' }),
    );
    const keyOf = Object.fromEntries(facets.rows.map((row) => [row.id, row.key]));
    const byFacet: Record<string, string[]> = {};
    for (const row of levels.rows) {
      const key = keyOf[row.facet_id];
      if (key) (byFacet[key] ??= []).push(row.level);
    }
    for (const key of Object.keys(byFacet)) byFacet[key].sort();
    const expected = Object.fromEntries(
      Object.entries(DECIDED_LEVELS).map(([key, value]) => [key, [...value].sort()]),
    );
    expect(byFacet).toEqual(expected);

    const presets = await pgGet<{ key: string }>(
      'access_preset',
      adminJwt,
      new URLSearchParams({ select: 'key', order: 'sort' }),
    );
    expect(presets.rows.map((row) => row.key)).toEqual(['minim', 'equip', 'coordinacio', 'direccio']);
  });

  test('anon no lee nada del modelo nuevo', async () => {
    for (const table of ['facet', 'membership', 'membership_facet', 'workspace_facet_setting']) {
      const res = await pgGet(table, null, new URLSearchParams({ select: '*' }));
      expect(res.rows).toHaveLength(0);
    }
  });

  test('nadie escribe membresías ni facetas estándar por la API, ni el owner', async () => {
    const own = await pgGet<MembershipRow>(
      'membership',
      adminJwt,
      new URLSearchParams({ user_id: `eq.${adminUserId}`, level: 'eq.workspace', select: 'id' }),
    );
    expect(own.rows.length).toBeGreaterThan(0);
    const membershipId = own.rows[0].id;

    const insertFacet = await pgPost('membership_facet', adminJwt, {
      membership_id: membershipId,
      facet_id: standard.diners,
      verb: 'view',
      source: 'override',
    });
    expect(insertFacet.status).toBeGreaterThanOrEqual(400);

    const patch = await pgPatch(
      'membership',
      adminJwt,
      { workspace_role: 'viewer' },
      new URLSearchParams({ id: `eq.${membershipId}` }),
    );
    expect(patch.status === 200 ? patch.rows.length : 0).toBe(0);

    const insertStandard = await pgPost('facet', adminJwt, { key: 'produccio', sort: 99 });
    expect(insertStandard.status).toBeGreaterThanOrEqual(400);

    const renameStandard = await pgPatch(
      'facet',
      adminJwt,
      { sort: 1 },
      new URLSearchParams({ id: `eq.${standard.diners}` }),
    );
    expect(renameStandard.status === 200 ? renameStandard.rows.length : 0).toBe(0);
  });

  test('el admin configura las facetas de su espacio: propia, nivel y ajuste', async () => {
    const key = 'zzz_rls_facet';
    const existing = await pgGet<FacetRow>(
      'facet',
      adminJwt,
      new URLSearchParams({ workspace_id: `eq.${workspaceId}`, key: `eq.${key}`, select: 'id,key,workspace_id' }),
    );
    let facetId = existing.rows[0]?.id;
    if (!facetId) {
      const created = await pgPost<FacetRow>('facet', adminJwt, {
        workspace_id: workspaceId,
        key,
        label: 'Prova RLS',
        labels: { ca: 'Prova RLS' },
        created_by: adminUserId,
      });
      expect(created.status).toBe(201);
      facetId = created.rows[0].id;
      const level = await pgPost('facet_level', adminJwt, { facet_id: facetId, level: 'bolo' });
      expect(level.status).toBe(201);
    }

    const setting = await pgPatch(
      'workspace_facet_setting',
      adminJwt,
      { label: 'Àpats', active: true },
      new URLSearchParams({ workspace_id: `eq.${workspaceId}`, facet_id: `eq.${standard.comidas}` }),
    );
    if (setting.rows.length === 0) {
      const inserted = await pgPost('workspace_facet_setting', adminJwt, {
        workspace_id: workspaceId,
        facet_id: standard.comidas,
        label: 'Àpats',
      });
      expect(inserted.status).toBe(201);
    }
  });

  describe.skipIf(!limitedEnvReady())('fixture limitada', () => {
    let limitedJwt: string;
    let limitedUserId: string;
    let projectId: string;
    let boloId: string | null = null;
    let membership: ProjectAccess;
    let workspaceMembership: { id: string; workspace_role: string };

    async function restoreMembership() {
      if (!membership) return;
      await restoreProjectAccess(adminJwt, projectId, limitedUserId, membership);
    }

    async function ownProjectFacets(): Promise<MembershipFacetRow[]> {
      const rows = await pgGet<MembershipRow>(
        'membership',
        limitedJwt,
        new URLSearchParams({ project_id: `eq.${projectId}`, select: 'id' }),
      );
      expect(rows.rows).toHaveLength(1);
      const facets = await pgGet<MembershipFacetRow>(
        'membership_facet',
        limitedJwt,
        new URLSearchParams({
          membership_id: `eq.${rows.rows[0].id}`,
          select: 'membership_id,facet_id,verb,source',
        }),
      );
      return facets.rows;
    }

    beforeAll(async () => {
      const limited = requireLimitedEnv();
      limitedJwt = await login(limited.email, limited.password);
      limitedUserId = String(decodeJwt(limitedJwt).sub);

      const projects = await pgGet<{ id: string }>(
        'project',
        adminJwt,
        new URLSearchParams({
          workspace_id: `eq.${workspaceId}`,
          slug: 'eq.zzz-e2e-collab',
          select: 'id',
        }),
      );
      expect(projects.rows).toHaveLength(1);
      projectId = projects.rows[0].id;

      membership = await projectAccess(adminJwt, projectId, limitedUserId);

      const ws = await pgGet<{ id: string; workspace_role: string }>(
        'membership',
        adminJwt,
        new URLSearchParams({
          level: 'eq.workspace',
          workspace_id: `eq.${workspaceId}`,
          user_id: `eq.${limitedUserId}`,
          select: 'id,workspace_role',
        }),
      );
      expect(ws.rows).toHaveLength(1);
      workspaceMembership = ws.rows[0];

      const bolos = await pgGet<{ id: string }>(
        'bolo',
        adminJwt,
        new URLSearchParams({ project_id: `eq.${projectId}`, deleted_at: 'is.null', select: 'id', limit: '1' }),
      );
      boloId = bolos.rows[0]?.id ?? null;
    });

    afterAll(async () => {
      await restoreMembership();
      if (workspaceMembership) {
        await pgRpc('update_workspace_member_role', adminJwt, {
          p_membership_id: workspaceMembership.id,
          p_role: workspaceMembership.workspace_role,
        });
      }
    });

    test('ve la producción de su proyecto y nada más; en todo proyecto, estar es ver', async () => {
      expect(await perms(limitedJwt, projectId)).toEqual(ONLY_SEES);
      for (const id of projectIds) {
        const p = await perms(limitedJwt, id);
        const visible = await pgGet('project', limitedJwt, new URLSearchParams({ id: `eq.${id}`, select: 'id' }));
        expect(p['read:performance'], `${id}: estar es ver (ADR-100 §2)`).toBe(visible.rows.length === 1);
        for (const noun of ['performance', 'money', 'conversation'] as const) {
          if (p[`edit:${noun}`]) expect(p[`read:${noun}`], `${id}: edit:${noun} implica leer`).toBe(true);
        }
      }
    });

    test('ve solo sus membresías; el admin ve las del espacio', async () => {
      const own = await pgGet<MembershipRow>(
        'membership',
        limitedJwt,
        new URLSearchParams({ select: 'id,user_id,level,project_id,container_verb' }),
      );
      expect(own.rows.length).toBeGreaterThan(0);
      expect(own.rows.every((row) => row.user_id === limitedUserId)).toBe(true);
      const projectRow = own.rows.find((row) => row.project_id === projectId);
      expect(projectRow).toMatchObject({ level: 'project', container_verb: 'view' });

      const seenByAdmin = await pgGet<MembershipRow>(
        'membership',
        adminJwt,
        new URLSearchParams({ user_id: `eq.${limitedUserId}`, select: 'id' }),
      );
      expect(seenByAdmin.rows.length).toBe(own.rows.length);

      const others = await pgGet<MembershipRow>(
        'membership',
        limitedJwt,
        new URLSearchParams({ user_id: `eq.${adminUserId}`, select: 'id' }),
      );
      expect(others.rows).toHaveLength(0);
    });

    test('un miembro no configura facetas del espacio', async () => {
      const created = await pgPost('facet', limitedJwt, {
        workspace_id: workspaceId,
        key: 'zzz_rls_limited',
        label: 'No',
        created_by: limitedUserId,
      });
      expect(created.status).toBeGreaterThanOrEqual(400);
      const setting = await pgPost('workspace_facet_setting', limitedJwt, {
        workspace_id: workspaceId,
        facet_id: standard.diners,
        active: false,
      });
      expect(setting.status).toBeGreaterThanOrEqual(400);
    });

    test('un override de Diners se refleja al instante en el acceso y en el bolo', async () => {
      const diners = () => ownProjectFacets().then((rows) => rows.find((row) => row.facet_id === standard.diners));
      try {
        expect(await diners()).toBeUndefined();

        await setFacets(adminJwt, membership.membershipId, { diners: 'view' });
        expect(await diners()).toMatchObject({ verb: 'view', source: 'override' });
        expect(await perms(limitedJwt, projectId)).toEqual({ ...ONLY_SEES, 'read:money': true });
        if (boloId) {
          const bolo = await pgGet('bolo', limitedJwt, new URLSearchParams({ id: `eq.${boloId}`, select: 'id' }));
          expect(bolo.rows).toHaveLength(1);
        }

        await setFacets(adminJwt, membership.membershipId, { diners: null });
        expect(await diners()).toBeUndefined();
        expect(await perms(limitedJwt, projectId)).toEqual(ONLY_SEES);
        if (boloId) {
          const bolo = await pgGet('bolo', limitedJwt, new URLSearchParams({ id: `eq.${boloId}`, select: 'id' }));
          expect(bolo.rows).toHaveLength(0);
        }
      } finally {
        await restoreMembership();
      }
    });

    test('paquete en el proyecto: Coordinació da editar y Diners en lectura', async () => {
      try {
        await grantPreset(adminJwt, 'project', projectId, limitedUserId, 'coordinacio');
        const keyOf = Object.fromEntries(Object.entries(standard).map(([key, id]) => [id, key]));
        expect((await ownProjectFacets()).map((row) => `${keyOf[row.facet_id]}:${row.verb}`).sort()).toEqual([
          'converses:edit',
          'diners:view',
          'materials:edit',
          'tecnica:edit',
        ]);
        expect(await perms(limitedJwt, projectId)).toEqual({
          'read:performance': true,
          'edit:performance': true,
          'read:money': true,
          'edit:money': false,
          'read:conversation': true,
          'edit:conversation': true,
          'edit:project_meta': true,
        });
      } finally {
        await restoreMembership();
      }
    });

    test('techo: con Mínim no se da ni se toma más de lo que se tiene', async () => {
      const self = await pgRpc('grant_container_preset', limitedJwt, {
        p_level: 'project',
        p_container_id: projectId,
        p_user_id: limitedUserId,
        p_preset: 'equip',
      });
      expect(self.status).toBe(403);
      const facet = await pgRpc('set_membership_facet', limitedJwt, {
        p_membership_id: membership.membershipId,
        p_facet_id: standard.diners,
        p_verb: 'view',
      });
      expect(facet.status).toBe(403);
      const workspace = await pgRpc('grant_container_preset', limitedJwt, {
        p_level: 'workspace',
        p_container_id: workspaceId,
        p_user_id: limitedUserId,
        p_preset: 'direccio',
      });
      expect(workspace.status).toBe(403);
      expect(await projectAccess(adminJwt, projectId, limitedUserId)).toMatchObject({
        containerVerb: 'view',
        facets: membership.facets,
      });
    });

    test('paquete en el espacio: Direcció es admin, y otro paquete lo quita', async () => {
      const role = async () => {
        const rows = await pgGet<{ workspace_role: string }>(
          'membership',
          adminJwt,
          new URLSearchParams({ id: `eq.${workspaceMembership.id}`, select: 'workspace_role' }),
        );
        return rows.rows[0]?.workspace_role;
      };
      try {
        await grantPreset(adminJwt, 'workspace', workspaceId, limitedUserId, 'direccio');
        expect(await role()).toBe('admin');
        await grantPreset(adminJwt, 'workspace', workspaceId, limitedUserId, 'minim');
        expect(await role()).toBe('member');

        const facet = await pgRpc('set_membership_facet', adminJwt, {
          p_membership_id: workspaceMembership.id,
          p_facet_id: standard.diners,
          p_verb: 'view',
        });
        expect(facet.status, 'las facetas de espacio esperan decisión').toBeGreaterThanOrEqual(400);
        const revoke = await pgRpc('revoke_membership', adminJwt, { p_membership_id: workspaceMembership.id });
        expect(revoke.status, 'la baja del espacio es revoke_workspace_member').toBe(400);
      } finally {
        await pgRpc('update_workspace_member_role', adminJwt, {
          p_membership_id: workspaceMembership.id,
          p_role: workspaceMembership.workspace_role,
        });
      }
    });

    test('paquetes: Equip en un bolo y techo del delegante', async () => {
      if (!boloId) return;
      const before = await perms(limitedJwt, projectId);
      const granted = await pgRpc<string>('grant_container_preset', adminJwt, {
        p_level: 'bolo',
        p_container_id: boloId,
        p_user_id: limitedUserId,
        p_preset: 'equip',
      });
      expect(granted.status).toBe(200);

      try {
        const rows = await pgGet<MembershipFacetRow>(
          'membership_facet',
          limitedJwt,
          new URLSearchParams({ membership_id: `eq.${granted.data}`, select: 'membership_id,facet_id,verb,source' }),
        );
        const keyOf = Object.fromEntries(Object.entries(standard).map(([key, id]) => [id, key]));
        expect(rows.rows.map((row) => `${keyOf[row.facet_id]}:${row.verb}:${row.source}`).sort()).toEqual([
          'comidas:view:preset',
          'full_de_ruta:view:preset',
          'logistica:view:preset',
          'materials:view:preset',
          'tecnica:view:preset',
        ]);

        const ceiling = await pgRpc('grant_container_preset', limitedJwt, {
          p_level: 'bolo',
          p_container_id: boloId,
          p_user_id: adminUserId,
          p_preset: 'coordinacio',
        });
        expect(ceiling.status).toBeGreaterThanOrEqual(400);

        // Un paquete en el bolo no cambia el acceso de proyecto.
        expect(await perms(limitedJwt, projectId)).toEqual(before);
      } finally {
        // La fixture no tenía esta membresía de bolo: fuera, para no dejar estado.
        await pgRpc('revoke_membership', adminJwt, { p_membership_id: granted.data });
      }
    });
  });
});
