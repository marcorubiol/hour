/**
 * RLS regression — the intentionally limited fixture identity.
 *
 * `limited@hour.test` is a plain member of the `playwright` workspace and a
 * `performer` in `zzz-e2e-collab`. The JWT is issued once, before any mutation,
 * so the grant/revoke test also proves that effective project permissions are
 * evaluated from current database state rather than cached in the token.
 */

import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import {
  decodeJwt,
  envReady,
  limitedEnvReady,
  login,
  pgGet,
  pgPatch,
  pgRpc,
  requireEnv,
  requireLimitedEnv,
} from './_helpers';

interface ProjectMembershipRow {
  id: string;
  roles: string[];
  permission_grants: string[];
  permission_revokes: string[];
}

interface PerformanceRow {
  id: string;
  fee_amount: number | null;
  fee_currency: string | null;
}

interface WorkspaceMembershipRow {
  id: string;
  role: 'owner' | 'admin' | 'member' | 'viewer' | 'guest';
}

interface PersonNoteRow {
  id: string;
  body: string;
  visibility: string;
}

describe.skipIf(!envReady() || !limitedEnvReady())('RLS — limited performer fixture', () => {
  let adminJwt: string;
  let limitedJwt: string;
  let workspaceId: string;
  let projectId: string;
  let membership: ProjectMembershipRow;
  let workspaceMembership: WorkspaceMembershipRow;
  let performance: PerformanceRow;
  let personId: string;
  let noteId: string | null = null;

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

  async function restorePerformance() {
    if (!performance) return;
    await pgRpc(
      'update_performance_fee',
      adminJwt,
      {
        p_performance_id: performance.id,
        p_fee_amount: performance.fee_amount,
        p_fee_currency: performance.fee_currency,
      },
    );
  }

  async function restoreWorkspaceMembership() {
    if (!workspaceMembership) return;
    await pgRpc('update_workspace_member_role', adminJwt, {
      p_membership_id: workspaceMembership.id,
      p_role: workspaceMembership.role,
    });
  }

  async function deleteFixtureNote() {
    if (!noteId) return;
    await pgRpc('delete_person_note', adminJwt, { p_note_id: noteId });
    noteId = null;
  }

  beforeAll(async () => {
    const admin = requireEnv();
    const limited = requireLimitedEnv();
    adminJwt = await login(admin.email, admin.password);
    limitedJwt = await login(limited.email, limited.password);
    const limitedUserId = decodeJwt(limitedJwt).sub;
    if (typeof limitedUserId !== 'string') throw new Error('Limited JWT has no subject');

    const workspaces = await pgGet<{ id: string }>(
      'workspace',
      adminJwt,
      new URLSearchParams({ slug: 'eq.playwright', select: 'id' }),
    );
    expect(workspaces.rows).toHaveLength(1);
    workspaceId = workspaces.rows[0].id;

    const workspaceMemberships = await pgGet<WorkspaceMembershipRow>(
      'workspace_membership',
      adminJwt,
      new URLSearchParams({
        workspace_id: `eq.${workspaceId}`,
        user_id: `eq.${limitedUserId}`,
        select: 'id,role',
      }),
    );
    expect(workspaceMemberships.rows).toHaveLength(1);
    workspaceMembership = workspaceMemberships.rows[0];

    const projects = await pgGet<{ id: string }>(
      'project',
      adminJwt,
      new URLSearchParams({
        workspace_id: `eq.${workspaceId}`,
        slug: 'eq.zzz-e2e-collab',
        deleted_at: 'is.null',
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

    const performances = await pgGet<{ id: string }>(
      'performance',
      adminJwt,
      new URLSearchParams({
        project_id: `eq.${projectId}`,
        deleted_at: 'is.null',
        select: 'id',
        limit: '1',
      }),
    );
    expect(performances.rows).toHaveLength(1);
    const money = await pgRpc<PerformanceRow[]>('list_money_performances', adminJwt, {
      p_project_ids: [projectId],
      p_limit: 1,
    });
    expect(money.status).toBe(200);
    expect(money.data).toHaveLength(1);
    performance = money.data![0];

    const people = await pgGet<{ person_id: string }>(
      'workspace_person',
      adminJwt,
      new URLSearchParams({
        workspace_id: `eq.${workspaceId}`,
        select: 'person_id',
        limit: '1',
      }),
    );
    expect(people.rows).toHaveLength(1);
    personId = people.rows[0].person_id;
  });

  afterAll(async () => {
    await deleteFixtureNote();
    await restoreMembership();
    await restoreWorkspaceMembership();
    await restorePerformance();
  });

  test('explicit grants apply immediately and explicit revokes win', async () => {
    try {
      const granted = await pgPatch<ProjectMembershipRow>(
        'project_membership',
        adminJwt,
        { permission_grants: ['read:money'], permission_revokes: [] },
        new URLSearchParams({ id: `eq.${membership.id}` }),
      );
      expect(granted.rows).toHaveLength(1);
      expect(
        await pgRpc<boolean>('has_permission', limitedJwt, {
          p_project_id: projectId,
          p_perm: 'read:money',
        }),
      ).toMatchObject({ status: 200, data: true });

      const revoked = await pgPatch<ProjectMembershipRow>(
        'project_membership',
        adminJwt,
        { permission_revokes: ['read:money'] },
        new URLSearchParams({ id: `eq.${membership.id}` }),
      );
      expect(revoked.rows).toHaveLength(1);
      expect(
        await pgRpc<boolean>('has_permission', limitedJwt, {
          p_project_id: projectId,
          p_perm: 'read:money',
        }),
      ).toMatchObject({ status: 200, data: false });
    } finally {
      await restoreMembership();
    }
  });

  test('performer reads production but cannot select or list fees', async () => {
    try {
      const production = await pgGet<{ id: string }>(
        'performance',
        limitedJwt,
        new URLSearchParams({ id: `eq.${performance.id}`, select: 'id' }),
      );
      expect(production).toMatchObject({ status: 200 });
      expect(production.rows).toHaveLength(1);

      const directFees = await pgGet<PerformanceRow>(
        'performance',
        limitedJwt,
        new URLSearchParams({ id: `eq.${performance.id}`, select: 'id,fee_amount,fee_currency' }),
      );
      expect(directFees.status).toBeGreaterThanOrEqual(400);

      const money = await pgRpc<PerformanceRow[]>('list_money_performances', limitedJwt, {
        p_project_ids: [projectId],
        p_limit: 10,
      });
      expect(money).toMatchObject({ status: 200, data: [] });

      const adminMoney = await pgRpc<PerformanceRow[]>('list_money_performances', adminJwt, {
        p_project_ids: [projectId],
        p_limit: 10,
      });
      expect(adminMoney.status).toBe(200);
      expect(adminMoney.data?.[0]).toMatchObject({
        id: performance.id,
        fee_amount: performance.fee_amount,
      });
    } finally {
      await restoreMembership();
      await restorePerformance();
    }
  });

  test('project visibility is assignment-bound for a non-admin', async () => {
    const { rows } = await pgGet<{ slug: string }>(
      'project',
      limitedJwt,
      new URLSearchParams({
        workspace_id: `eq.${workspaceId}`,
        select: 'slug',
        deleted_at: 'is.null',
      }),
    );
    expect(rows.map((row) => row.slug)).toEqual(['zzz-e2e-collab']);
    expect(rows.map((row) => row.slug)).not.toContain('zzz-rls-foreign-project');
  });

  test('an already-issued JWT loses production access after a live revoke', async () => {
    try {
      const revoked = await pgPatch<ProjectMembershipRow>(
        'project_membership',
        adminJwt,
        { permission_revokes: ['read:performance'] },
        new URLSearchParams({ id: `eq.${membership.id}` }),
      );
      expect(revoked.rows).toHaveLength(1);

      const afterRevoke = await pgGet<{ id: string }>(
        'performance',
        limitedJwt,
        new URLSearchParams({ id: `eq.${performance.id}`, select: 'id' }),
      );
      expect(afterRevoke).toMatchObject({ status: 200, rows: [] });
    } finally {
      await restoreMembership();
    }
  });

  test('guest keeps assigned production but loses workspace directories', async () => {
    try {
      const changed = await pgRpc('update_workspace_member_role', adminJwt, {
        p_membership_id: workspaceMembership.id,
        p_role: 'guest',
      });
      expect(changed).toMatchObject({ status: 204 });

      const production = await pgGet<{ id: string }>(
        'performance',
        limitedJwt,
        new URLSearchParams({ id: `eq.${performance.id}`, select: 'id' }),
      );
      const directory = await pgGet<{ person_id: string }>(
        'workspace_person',
        limitedJwt,
        new URLSearchParams({ workspace_id: `eq.${workspaceId}`, select: 'person_id' }),
      );
      const tasks = await pgGet<{ id: string }>(
        'task',
        limitedJwt,
        new URLSearchParams({ workspace_id: `eq.${workspaceId}`, select: 'id' }),
      );

      expect(production.rows).toHaveLength(1);
      expect(directory.rows).toHaveLength(0);
      expect(tasks.rows).toHaveLength(0);
    } finally {
      await restoreWorkspaceMembership();
    }
  });

  test('another author private note stays invisible', async () => {
    try {
      const created = await pgRpc<PersonNoteRow>('create_person_note', adminJwt, {
        p_workspace_id: workspaceId,
        p_person_id: personId,
        p_body: 'ZZZ limited-role private note',
        p_visibility: 'private',
      });
      expect(created.status).toBe(200);
      expect(created.data).not.toBeNull();
      noteId = created.data?.id ?? null;
      expect(noteId).not.toBeNull();

      const visibleToAuthor = await pgGet<PersonNoteRow>(
        'person_note',
        adminJwt,
        new URLSearchParams({ id: `eq.${noteId}`, select: 'id,body,visibility' }),
      );
      const hiddenFromLimited = await pgGet<PersonNoteRow>(
        'person_note',
        limitedJwt,
        new URLSearchParams({ id: `eq.${noteId}`, select: 'id,body,visibility' }),
      );

      expect(visibleToAuthor.rows).toHaveLength(1);
      expect(hiddenFromLimited.rows).toHaveLength(0);
    } finally {
      await deleteFixtureNote();
    }
  });
});
