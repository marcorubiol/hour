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
    await pgPatch(
      'performance',
      adminJwt,
      { fee_amount: performance.fee_amount, fee_currency: performance.fee_currency },
      new URLSearchParams({ id: `eq.${performance.id}` }),
    );
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

    const performances = await pgGet<PerformanceRow>(
      'performance',
      adminJwt,
      new URLSearchParams({
        project_id: `eq.${projectId}`,
        deleted_at: 'is.null',
        select: 'id,fee_amount,fee_currency',
        limit: '1',
      }),
    );
    expect(performances.rows).toHaveLength(1);
    performance = performances.rows[0];

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

  test('performance_redacted masks fees for an editor without read:money', async () => {
    try {
      // The current closed vocabulary has no read-only performance capability:
      // base-row visibility is tied to edit:performance. Grant that capability
      // temporarily so this test isolates the independent money boundary.
      const access = await pgPatch<ProjectMembershipRow>(
        'project_membership',
        adminJwt,
        { permission_grants: ['edit:performance'], permission_revokes: [] },
        new URLSearchParams({ id: `eq.${membership.id}` }),
      );
      expect(access.rows).toHaveLength(1);

      const seeded = await pgPatch<PerformanceRow>(
        'performance',
        adminJwt,
        { fee_amount: 12345.67, fee_currency: 'EUR' },
        new URLSearchParams({ id: `eq.${performance.id}` }),
      );
      expect(seeded.rows).toHaveLength(1);

      const adminView = await pgGet<PerformanceRow>(
        'performance_redacted',
        adminJwt,
        new URLSearchParams({ id: `eq.${performance.id}`, select: 'id,fee_amount,fee_currency' }),
      );
      const limitedView = await pgGet<PerformanceRow>(
        'performance_redacted',
        limitedJwt,
        new URLSearchParams({ id: `eq.${performance.id}`, select: 'id,fee_amount,fee_currency' }),
      );

      expect(adminView.rows).toHaveLength(1);
      expect(adminView.rows[0].fee_amount).toBe(12345.67);
      expect(limitedView.rows).toHaveLength(1);
      expect(limitedView.rows[0]).toMatchObject({ fee_amount: null, fee_currency: null });
    } finally {
      await restoreMembership();
      await restorePerformance();
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
