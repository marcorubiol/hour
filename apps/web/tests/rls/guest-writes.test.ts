/**
 * RLS regression: un guest no escribe tareas ni bloques de disponibilidad del
 * espacio (migración 20261022150000_guest_no_task_availability_writes; comms
 * carril 2, fase 2, paso 0).
 *
 * Desde la invitación de bolo (20261022100000) un no admin deja a alguien como
 * `guest`. Un guest no lee `task` ni `availability_block`; antes podía crearlas
 * por RPC y por PostgREST, borrarlas por RPC y reescribirlas con un PATCH
 * ciego. Probado también en local, en una transacción con ROLLBACK, contra el
 * texto de antes (el PATCH ciego tocaba todas las filas del espacio).
 *
 * Como `limited-role`, la fixture limitada pasa a guest en `playwright` y
 * vuelve a su rol en `finally`. Las filas que crea el admin llevan `ZZZ` y se
 * borran al final.
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

const RUN = Date.now().toString(36);
const TITLE = `ZZZ RLS guest task ${RUN}`;
const NOTE = `ZZZ RLS guest block ${RUN}`;

interface WorkspaceMembershipRow {
  id: string;
  workspace_role: 'owner' | 'admin' | 'member' | 'viewer' | 'guest';
}

describe.skipIf(!envReady() || !limitedEnvReady())('RLS: un guest no escribe tareas ni disponibilidad', () => {
  let adminJwt: string;
  let limitedJwt: string;
  let limitedUserId: string;
  let workspaceId: string;
  let workspaceMembership: WorkspaceMembershipRow;
  let taskId: string | null = null;
  let blockId: string | null = null;

  async function asGuest<T>(run: () => Promise<T>): Promise<T> {
    const changed = await pgRpc('update_workspace_member_role', adminJwt, {
      p_membership_id: workspaceMembership.id,
      p_role: 'guest',
    });
    expect(changed.status, changed.error).toBe(204);
    try {
      return await run();
    } finally {
      await pgRpc('update_workspace_member_role', adminJwt, {
        p_membership_id: workspaceMembership.id,
        p_role: workspaceMembership.workspace_role,
      });
    }
  }

  beforeAll(async () => {
    const admin = requireEnv();
    const limited = requireLimitedEnv();
    adminJwt = await login(admin.email, admin.password);
    limitedJwt = await login(limited.email, limited.password);
    limitedUserId = String(decodeJwt(limitedJwt).sub);

    const ws = await pgGet<{ id: string }>('workspace', adminJwt, new URLSearchParams({ slug: 'eq.playwright', select: 'id' }));
    workspaceId = ws.rows[0]!.id;
    const memberships = await pgGet<WorkspaceMembershipRow>(
      'membership',
      adminJwt,
      new URLSearchParams({
        level: 'eq.workspace',
        workspace_id: `eq.${workspaceId}`,
        user_id: `eq.${limitedUserId}`,
        select: 'id,workspace_role',
      }),
    );
    expect(memberships.rows).toHaveLength(1);
    workspaceMembership = memberships.rows[0]!;
    // Si una pasada anterior cayó a mitad, la fixture podría haberse quedado en guest.
    expect(workspaceMembership.workspace_role).not.toBe('guest');

    const task = await pgRpc<{ id: string }>('create_task', adminJwt, { p_title: TITLE, p_workspace_id: workspaceId });
    expect(task.status, task.error).toBe(200);
    taskId = task.data!.id;
    const block = await pgRpc<{ id: string }>('create_availability_block', adminJwt, {
      p_workspace_id: workspaceId,
      p_starts_on: '2031-03-01',
      p_ends_on: '2031-03-02',
      p_note: NOTE,
    });
    expect(block.status, block.error).toBe(200);
    blockId = block.data!.id;
  });

  afterAll(async () => {
    if (taskId) await pgRpc('delete_task', adminJwt, { p_task_id: taskId });
    if (blockId) await pgRpc('delete_availability_block', adminJwt, { p_availability_block_id: blockId });
  });

  test('como guest: no crea, no borra y un PATCH ciego no toca nada', async () => {
    await asGuest(async () => {
      expect((await pgRpc('create_task', limitedJwt, { p_title: TITLE, p_workspace_id: workspaceId })).status).toBe(403);
      expect(
        (
          await pgRpc('create_availability_block', limitedJwt, {
            p_workspace_id: workspaceId,
            p_starts_on: '2031-03-05',
            p_ends_on: '2031-03-06',
          })
        ).status,
      ).toBe(403);
      expect((await pgRpc('delete_task', limitedJwt, { p_task_id: taskId })).status).toBe(403);
      expect((await pgRpc('delete_availability_block', limitedJwt, { p_availability_block_id: blockId })).status).toBe(403);

      const insertTask = await pgPost('task', limitedJwt, {
        workspace_id: workspaceId,
        title: TITLE,
        created_by: limitedUserId,
      });
      expect(insertTask.status).toBeGreaterThanOrEqual(400);
      const insertBlock = await pgPost('availability_block', limitedJwt, {
        workspace_id: workspaceId,
        starts_on: '2031-03-05',
        ends_on: '2031-03-06',
        created_by: limitedUserId,
      });
      expect(insertBlock.status).toBeGreaterThanOrEqual(400);

      // PATCH filtrado por id: el filtro lee una columna, así que también lo
      // corta el SELECT; lo que cuenta es lo que lee el admin después.
      await pgPatch('task', limitedJwt, { title: `${TITLE} pwned` }, new URLSearchParams({ id: `eq.${taskId}` }));
      await pgPatch('availability_block', limitedJwt, { note: `${NOTE} pwned` }, new URLSearchParams({ id: `eq.${blockId}` }));
    });

    const task = await pgGet<{ title: string; deleted_at: string | null }>(
      'task',
      adminJwt,
      new URLSearchParams({ id: `eq.${taskId}`, select: 'title,deleted_at' }),
    );
    expect(task.rows[0]).toMatchObject({ title: TITLE, deleted_at: null });
    const block = await pgGet<{ note: string | null }>(
      'availability_block',
      adminJwt,
      new URLSearchParams({ id: `eq.${blockId}`, select: 'note' }),
    );
    expect(block.rows[0]).toMatchObject({ note: NOTE });
  });

  test('de vuelta a su rol, la fixture crea y borra como siempre', async () => {
    const task = await pgRpc<{ id: string }>('create_task', limitedJwt, {
      p_title: `${TITLE} member`,
      p_workspace_id: workspaceId,
    });
    expect(task.status, task.error).toBe(200);
    expect((await pgRpc('delete_task', limitedJwt, { p_task_id: task.data!.id })).status).toBeLessThan(300);

    const block = await pgRpc<{ id: string }>('create_availability_block', limitedJwt, {
      p_workspace_id: workspaceId,
      p_starts_on: '2031-03-08',
      p_ends_on: '2031-03-09',
    });
    expect(block.status, block.error).toBe(200);
    expect((await pgRpc('delete_availability_block', limitedJwt, { p_availability_block_id: block.data!.id })).status).toBeLessThan(300);
  });

  test('anon no llama a ninguna de las cuatro', async () => {
    const calls: [string, Record<string, unknown>][] = [
      ['create_task', { p_title: TITLE, p_workspace_id: workspaceId }],
      ['delete_task', { p_task_id: taskId }],
      ['create_availability_block', { p_workspace_id: workspaceId, p_starts_on: '2031-03-01', p_ends_on: '2031-03-02' }],
      ['delete_availability_block', { p_availability_block_id: blockId }],
    ];
    for (const [fn, args] of calls) {
      expect((await pgRpc(fn, null, args)).status, fn).toBeGreaterThanOrEqual(400);
    }
  });
});
