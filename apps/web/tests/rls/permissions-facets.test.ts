/**
 * RLS regression: permisos al modelo de facetas, fase expand
 * (20261011100000_permissions_facets_expand, build/permissions-facets-plan.md).
 *
 * El expand no cambia ninguna lectura: crea `membership` + `membership_facet`
 * como espejo de workspace_membership / project_membership / workspace_role.
 * Estos tests prueban tres cosas:
 *   1. Equivalencia: para cada fixture y cada proyecto, el modelo nuevo
 *      (`has_permission_by_facets`) contesta exactamente lo mismo que
 *      `has_permission`, en los ocho permisos vivos.
 *   2. Espejo en vivo: un grant o revoke en project_membership se ve al
 *      instante en las filas de faceta y en la respuesta del modelo nuevo.
 *   3. Facetas: el vocabulario y la tabla de niveles son los decididos, nadie
 *      escribe por la API, y cada uno ve solo lo suyo salvo el admin.
 * Con SUPABASE_SERVICE_ROLE_KEY, además, la paridad global de todo el sistema.
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
  full_de_ruta: ['bolo'],
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

interface MembershipFacetRow {
  membership_id: string;
  facet_key: string;
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

describe.skipIf(!envReady())('RLS: permisos por facetas (expand)', () => {
  let adminJwt: string;
  let adminUserId: string;
  let workspaceId: string;
  let projectIds: string[] = [];

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
  });

  test('owner: el modelo nuevo contesta igual que has_permission en cada proyecto', async () => {
    await assertEquivalent(adminJwt, projectIds);
  });

  test('vocabulario: las seis facetas y la tabla de niveles decidida', async () => {
    const facets = await pgGet<{ key: string }>(
      'facet',
      adminJwt,
      new URLSearchParams({ select: 'key', order: 'sort' }),
    );
    expect(facets.rows.map((row) => row.key)).toEqual([
      'converses',
      'materials',
      'tecnica',
      'logistica',
      'full_de_ruta',
      'diners',
    ]);

    const levels = await pgGet<{ facet_key: string; level: string }>(
      'facet_level',
      adminJwt,
      new URLSearchParams({ select: 'facet_key,level' }),
    );
    const byFacet: Record<string, string[]> = {};
    for (const row of levels.rows) (byFacet[row.facet_key] ??= []).push(row.level);
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
    for (const table of ['facet', 'membership', 'membership_facet']) {
      const res = await pgGet(table, null, new URLSearchParams({ select: '*' }));
      expect(res.rows).toHaveLength(0);
    }
    const rpc = await pgRpc('has_permission_by_facets', null, {
      p_project_id: projectIds[0],
      p_perm: 'read:performance',
    });
    expect(rpc.status).toBeGreaterThanOrEqual(400);
  });

  test('nadie escribe el modelo nuevo por la API, ni el owner', async () => {
    const own = await pgGet<MembershipRow>(
      'membership',
      adminJwt,
      new URLSearchParams({ user_id: `eq.${adminUserId}`, level: 'eq.workspace', select: 'id' }),
    );
    expect(own.rows.length).toBeGreaterThan(0);
    const membershipId = own.rows[0].id;

    const insertFacet = await pgPost('membership_facet', adminJwt, {
      membership_id: membershipId,
      facet_key: 'diners',
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

    const insertFacetRow = await pgPost('facet', adminJwt, { key: 'produccio', sort: 99 });
    expect(insertFacetRow.status).toBeGreaterThanOrEqual(400);
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
          select: 'membership_id,facet_key,verb,source',
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
    });

    afterAll(async () => {
      await restoreMembership();
    });

    test('performer: el modelo nuevo contesta igual en cada proyecto del espacio', async () => {
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

    test('un grant y un revoke se reflejan al instante en Diners', async () => {
      try {
        expect((await ownProjectFacets()).find((row) => row.facet_key === 'diners')).toBeUndefined();

        const granted = await pgPatch<ProjectMembershipRow>(
          'project_membership',
          adminJwt,
          { permission_grants: ['read:money'], permission_revokes: [] },
          new URLSearchParams({ id: `eq.${membership.id}` }),
        );
        expect(granted.rows).toHaveLength(1);
        expect((await ownProjectFacets()).find((row) => row.facet_key === 'diners')).toMatchObject({
          verb: 'view',
          source: 'legacy',
        });
        await assertEquivalent(limitedJwt, [projectId]);

        const revoked = await pgPatch<ProjectMembershipRow>(
          'project_membership',
          adminJwt,
          { permission_revokes: ['read:money'] },
          new URLSearchParams({ id: `eq.${membership.id}` }),
        );
        expect(revoked.rows).toHaveLength(1);
        expect((await ownProjectFacets()).find((row) => row.facet_key === 'diners')).toBeUndefined();
        await assertEquivalent(limitedJwt, [projectId]);
      } finally {
        await restoreMembership();
      }
    });

    test('revocar read:performance deja la membresía sin acceso al contenedor, en los dos modelos', async () => {
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
  });
});
