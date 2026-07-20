/** Full external-identity lifecycle: zero access → invite → accept → revoke. */

import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import {
  decodeJwt,
  envReady,
  externalEnvReady,
  login,
  pgGet,
  pgPatch,
  pgRpc,
  requireEnv,
  requireExternalEnv,
} from './_helpers';

interface InvitationRow {
  id: string;
  token: string;
}

describe.skipIf(!envReady() || !externalEnvReady())(
  'RLS — external workspace invitation lifecycle',
  () => {
    let adminJwt: string;
    let externalJwt: string;
    let externalUserId: string;
    let workspaceId: string;
    let projectId: string;
    let performanceId: string;
    let invitationId: string | null = null;

    async function removeExternalMembership() {
      const rows = await pgGet<{ id: string }>(
        'workspace_membership',
        adminJwt,
        new URLSearchParams({
          workspace_id: `eq.${workspaceId}`,
          user_id: `eq.${externalUserId}`,
          select: 'id',
        }),
      );
      for (const row of rows.rows) {
        await pgRpc('revoke_workspace_member', adminJwt, { p_membership_id: row.id });
      }
    }

    async function revokePendingInvitation() {
      if (!invitationId) return;
      await pgRpc('revoke_workspace_invitation', adminJwt, {
        p_invitation_id: invitationId,
      });
      invitationId = null;
    }

    beforeAll(async () => {
      const admin = requireEnv();
      const external = requireExternalEnv();
      adminJwt = await login(admin.email, admin.password);
      externalJwt = await login(external.email, external.password);
      externalUserId = String(decodeJwt(externalJwt).sub);

      const workspaces = await pgGet<{ id: string }>(
        'workspace',
        adminJwt,
        new URLSearchParams({ slug: 'eq.playwright', select: 'id' }),
      );
      workspaceId = workspaces.rows[0].id;
      const projects = await pgGet<{ id: string }>(
        'project',
        adminJwt,
        new URLSearchParams({ slug: 'eq.zzz-e2e-collab', select: 'id' }),
      );
      projectId = projects.rows[0].id;
      const performances = await pgGet<{ id: string }>(
        'performance',
        adminJwt,
        new URLSearchParams({ project_id: `eq.${projectId}`, select: 'id', limit: '1' }),
      );
      performanceId = performances.rows[0].id;
      await removeExternalMembership();
    });

    afterAll(async () => {
      await removeExternalMembership();
      await revokePendingInvitation();
    });

    test('external user gains only invited access and loses it with the same live JWT', async () => {
      const before = await pgGet<{ id: string }>(
        'workspace',
        externalJwt,
        new URLSearchParams({ id: `eq.${workspaceId}`, select: 'id' }),
      );
      expect(before).toMatchObject({ status: 200, rows: [] });

      const created = await pgRpc<InvitationRow[]>('create_workspace_invitation', adminJwt, {
        p_workspace_id: workspaceId,
        p_email: requireExternalEnv().email,
        p_role: 'guest',
        p_project_id: projectId,
        p_project_role_code: 'performer',
        p_expires_days: 7,
      });
      expect(created.status).toBe(200);
      expect(created.data).toHaveLength(1);
      invitationId = created.data![0].id;

      const preview = await pgRpc<unknown[]>('preview_workspace_invitation', externalJwt, {
        p_token: created.data![0].token,
      });
      expect(preview.status).toBe(200);
      expect(preview.data).toHaveLength(1);

      const accepted = await pgRpc<unknown[]>('accept_workspace_invitation', externalJwt, {
        p_token: created.data![0].token,
      });
      expect(accepted.status, accepted.error).toBe(200);
      expect(accepted.data).toHaveLength(1);
      invitationId = null;

      const workspace = await pgGet<{ id: string }>(
        'workspace',
        externalJwt,
        new URLSearchParams({ id: `eq.${workspaceId}`, select: 'id' }),
      );
      const project = await pgGet<{ id: string }>(
        'project',
        externalJwt,
        new URLSearchParams({ id: `eq.${projectId}`, select: 'id' }),
      );
      const performance = await pgGet<{ id: string }>(
        'performance',
        externalJwt,
        new URLSearchParams({ id: `eq.${performanceId}`, select: 'id' }),
      );
      const directory = await pgGet<{ person_id: string }>(
        'workspace_person',
        externalJwt,
        new URLSearchParams({ workspace_id: `eq.${workspaceId}`, select: 'person_id' }),
      );
      expect(workspace.rows).toHaveLength(1);
      expect(project.rows).toHaveLength(1);
      expect(performance.rows).toHaveLength(1);
      expect(directory.rows).toHaveLength(0);

      const ownMembership = await pgGet<{ id: string }>(
        'workspace_membership',
        externalJwt,
        new URLSearchParams({ workspace_id: `eq.${workspaceId}`, select: 'id' }),
      );
      expect(ownMembership.rows).toHaveLength(1);
      const selfPromotion = await pgPatch(
        'workspace_membership',
        externalJwt,
        { role: 'admin' },
        new URLSearchParams({ id: `eq.${ownMembership.rows[0].id}` }),
      );
      expect(selfPromotion.status).toBeGreaterThanOrEqual(400);

      await removeExternalMembership();

      const afterRevoke = await pgGet<{ id: string }>(
        'performance',
        externalJwt,
        new URLSearchParams({ id: `eq.${performanceId}`, select: 'id' }),
      );
      expect(afterRevoke).toMatchObject({ status: 200, rows: [] });
    });
  },
);
