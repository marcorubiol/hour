/**
 * RLS regression: permisos al modelo de facetas (expand 20261011100000 y fase 2
 * 20261011300000; build/permissions-facets-plan.md, ADR-099 §8, ADR-100).
 *
 * El expand crea `membership` + `membership_facet` como espejo de
 * workspace_membership / project_membership / workspace_role; la fase 2 hace
 * que los lectores de hoy (has_permission, is_workspace_*, ...) lean el modelo
 * nuevo. Estos tests prueban:
 *   1. Paridad global (con SUPABASE_SERVICE_ROLE_KEY): las copias congeladas de
 *      los lectores viejos y el modelo nuevo contestan igual para todo el
 *      sistema. Es la prueba fuerte de equivalencia.
 *   2. Equivalencia por fixture: has_permission y el modelo nuevo contestan
 *      igual en cada proyecto, en los ocho permisos vivos.
 *   3. Espejo en vivo: un grant o revoke en project_membership se ve al
 *      instante en las filas de faceta y en el acceso real.
 *   4. Facetas: vocabulario estándar y tabla de niveles decididos (ADR-100),
 *      configuración por espacio solo del admin, nadie escribe membresías por
 *      la API, cada uno ve solo lo suyo salvo el admin.
 *   5. Paquetes: grant_container_preset expande Equip en un bolo, respeta el
 *      techo del delegante y no acepta proyecto ni espacio en la fase 2.
 */

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
  requireEnv,
  requireLimitedEnv,
} from './_helpers';

const LIVE_PERMS = [
  'read:performance',
  'edit:performance',
  'read:money',
  'edit:money',
  'read:conversation',
  'edit:conversation',
  'edit:project_meta',
  'edit:membership',
] as const;

const DECIDED_LEVELS: Record<string, string[]> = {
  converses: ['workspace', 'project', 'line'],
  materials: ['project', 'line', 'bolo'],
  tecnica: ['project', 'line', 'bolo'],
  logistica: ['line', 'bolo'],
  full_de_ruta: ['bolo', 'performance'],
  comidas: ['bolo'],
  diners: ['workspace', 'project', 'line', 'bolo'],
};

interface ProjectMembershipRow {
  id: string;
  roles: string[];
  permission_grants: string[];
  permission_revokes: string[];
}

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

async function assertEquivalent(jwt: string, projectIds: string[]): Promise<void> {
  const diffs: string[] = [];
  for (const projectId of projectIds) {
    for (const perm of LIVE_PERMS) {
      const args = { p_project_id: projectId, p_perm: perm };
      const [legacy, model] = await Promise.all([
        pgRpc<boolean>('has_permission', jwt, args),
        pgRpc<boolean>('has_permission_by_facets', jwt, args),
      ]);
      expect(legacy.status).toBe(200);
      expect(model.status).toBe(200);
      if (legacy.data !== model.data) {
        diffs.push(`${projectId} ${perm} legacy=${legacy.data} model=${model.data}`);
      }
    }
  }
  expect(diffs).toEqual([]);
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

  test('owner: has_permission y el modelo nuevo contestan igual en cada proyecto', async () => {
    await assertEquivalent(adminJwt, projectIds);
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
    const rpc = await pgRpc('has_permission_by_facets', null, {
      p_project_id: projectIds[0],
      p_perm: 'read:performance',
    });
    expect(rpc.status).toBeGreaterThanOrEqual(400);
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

  test('la paridad global no está abierta a un usuario autenticado', async () => {
    const res = await pgRpc('access_parity_report', adminJwt);
    expect(res.status).toBeGreaterThanOrEqual(400);
  });

  test.skipIf(!process.env.SUPABASE_SERVICE_ROLE_KEY)(
    'paridad global: ninguna diferencia en todo el sistema',
    async () => {
      const { url, anon } = requireEnv();
      const key = process.env.SUPABASE_SERVICE_ROLE_KEY as string;
      const res = await fetch(new URL('/rest/v1/rpc/access_parity_report', url), {
        method: 'POST',
        headers: {
          apikey: anon,
          Authorization: `Bearer ${key}`,
          'content-type': 'application/json',
        },
        body: '{}',
      });
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual([]);
    },
  );

  describe.skipIf(!limitedEnvReady())('fixture limitada', () => {
    let limitedJwt: string;
    let limitedUserId: string;
    let projectId: string;
    let boloId: string | null = null;
    let membership: ProjectMembershipRow;

    async function restoreMembership() {
      if (!membership) return;
      await pgPatch(
        'project_membership',
        adminJwt,
        {
          roles: membership.roles,
          permission_grants: membership.permission_grants,
          permission_revokes: membership.permission_revokes,
        },
        new URLSearchParams({ id: `eq.${membership.id}` }),
      );
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

      const memberships = await pgGet<ProjectMembershipRow>(
        'project_membership',
        adminJwt,
        new URLSearchParams({
          project_id: `eq.${projectId}`,
          user_id: `eq.${limitedUserId}`,
          select: 'id,roles,permission_grants,permission_revokes',
        }),
      );
      expect(memberships.rows).toHaveLength(1);
      membership = memberships.rows[0];

      const bolos = await pgGet<{ id: string }>(
        'bolo',
        adminJwt,
        new URLSearchParams({ project_id: `eq.${projectId}`, deleted_at: 'is.null', select: 'id', limit: '1' }),
      );
      boloId = bolos.rows[0]?.id ?? null;
    });

    afterAll(async () => {
      await restoreMembership();
    });

    test('performer: has_permission y el modelo nuevo contestan igual en cada proyecto', async () => {
      await assertEquivalent(limitedJwt, projectIds);
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

    test('un grant y un revoke se reflejan al instante en Diners y en el bolo', async () => {
      const diners = () => ownProjectFacets().then((rows) => rows.find((row) => row.facet_id === standard.diners));
      try {
        expect(await diners()).toBeUndefined();

        const granted = await pgPatch<ProjectMembershipRow>(
          'project_membership',
          adminJwt,
          { permission_grants: ['read:money'], permission_revokes: [] },
          new URLSearchParams({ id: `eq.${membership.id}` }),
        );
        expect(granted.rows).toHaveLength(1);
        expect(await diners()).toMatchObject({ verb: 'view', source: 'legacy' });
        await assertEquivalent(limitedJwt, [projectId]);
        if (boloId) {
          const bolo = await pgGet('bolo', limitedJwt, new URLSearchParams({ id: `eq.${boloId}`, select: 'id' }));
          expect(bolo.rows).toHaveLength(1);
        }

        const revoked = await pgPatch<ProjectMembershipRow>(
          'project_membership',
          adminJwt,
          { permission_revokes: ['read:money'] },
          new URLSearchParams({ id: `eq.${membership.id}` }),
        );
        expect(revoked.rows).toHaveLength(1);
        expect(await diners()).toBeUndefined();
        await assertEquivalent(limitedJwt, [projectId]);
        if (boloId) {
          const bolo = await pgGet('bolo', limitedJwt, new URLSearchParams({ id: `eq.${boloId}`, select: 'id' }));
          expect(bolo.rows).toHaveLength(0);
        }
      } finally {
        await restoreMembership();
      }
    });

    test('revocar read:performance deja la membresía sin acceso al contenedor', async () => {
      try {
        const revoked = await pgPatch<ProjectMembershipRow>(
          'project_membership',
          adminJwt,
          { permission_revokes: ['read:performance'] },
          new URLSearchParams({ id: `eq.${membership.id}` }),
        );
        expect(revoked.rows).toHaveLength(1);
        const own = await pgGet<MembershipRow>(
          'membership',
          limitedJwt,
          new URLSearchParams({ project_id: `eq.${projectId}`, select: 'id,container_verb' }),
        );
        expect(own.rows).toEqual([expect.objectContaining({ container_verb: null })]);
        await assertEquivalent(limitedJwt, [projectId]);
      } finally {
        await restoreMembership();
      }
    });

    test('paquetes: Equip en un bolo, techo del delegante y nada en proyecto', async () => {
      if (!boloId) return;
      const granted = await pgRpc<string>('grant_container_preset', adminJwt, {
        p_level: 'bolo',
        p_container_id: boloId,
        p_user_id: limitedUserId,
        p_preset: 'equip',
      });
      expect(granted.status).toBe(200);

      const rows = await pgGet<MembershipFacetRow>(
        'membership_facet',
        limitedJwt,
        new URLSearchParams({ membership_id: `eq.${granted.data}`, select: 'membership_id,facet_id,verb,source' }),
      );
      const keyOf = Object.fromEntries(Object.entries(standard).map(([key, id]) => [id, key]));
      expect(rows.rows.map((row) => `${keyOf[row.facet_id]}:${row.verb}:${row.source}`).sort()).toEqual([
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

      const projectLevel = await pgRpc('grant_container_preset', adminJwt, {
        p_level: 'project',
        p_container_id: projectId,
        p_user_id: limitedUserId,
        p_preset: 'equip',
      });
      expect(projectLevel.status).toBeGreaterThanOrEqual(400);

      // Un paquete en el bolo no cambia el acceso de proyecto (fase 2).
      await assertEquivalent(limitedJwt, [projectId]);
    });
  });
});
