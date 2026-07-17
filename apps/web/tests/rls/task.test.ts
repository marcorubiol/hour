/**
 * RLS regression — task (ADR-068, D3).
 *
 * Access model under test: workspace-scoped (venue/person_note family) —
 * any accepted member reads/edits; creation via `create_task` RPC (INSERT
 * is claim-bound); soft-delete via `delete_task` RPC only (ADR-048); the
 * scope columns (workspace_id, parent FKs) and created_by are trigger-
 * immutable.
 *
 * Fixture discipline (ADR-052): everything test-created lives in the
 * user's OWN `playwright` workspace, is `ZZZ`-prefixed, and is soft-
 * deleted in cleanup. Real workspaces (muk-cia) are never written.
 */

import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { envReady, login, pgGet, pgPatch, pgRpc, requireEnv } from './_helpers';

const RANDOM_UUID = '00000000-0000-4000-8000-000000000000';
const RUN_TAG = Date.now().toString(36);
const TITLE = `ZZZ RLS Task ${RUN_TAG}`;

interface TaskRow {
  id: string;
  workspace_id: string;
  project_id: string | null;
  line_id: string | null;
  title: string;
  note: string | null;
  status: string;
  origin: string;
  due_at: string | null;
  from_at: string | null;
  lead_days: number | null;
  deleted_at: string | null;
}

interface WorkspaceRow {
  id: string;
  slug: string;
}

describe.skipIf(!envReady())('task RLS (ADR-068)', () => {
  let jwt: string;
  let playwrightWsId: string;
  let fixtureLineId: string | null = null;
  let taskId: string | null = null;

  // Prefix-wide (no run tag): a crashed run never reaches afterAll and every
  // later run carries a different tag — crash recovery must sweep ALL
  // leftovers, not just this run's (line-modules convention).
  async function sweepLeftovers() {
    const { rows } = await pgGet<TaskRow>(
      'task',
      jwt,
      new URLSearchParams({
        select: 'id,title',
        workspace_id: `eq.${playwrightWsId}`,
        title: 'like.ZZZ RLS Task*',
      }),
    );
    for (const row of rows) {
      await pgRpc('delete_task', jwt, { p_task_id: row.id });
    }
  }

  beforeAll(async () => {
    const { email, password } = requireEnv();
    jwt = await login(email, password);
    const { rows } = await pgGet<WorkspaceRow>(
      'workspace',
      jwt,
      new URLSearchParams({ select: 'id,slug', slug: 'eq.playwright' }),
    );
    if (rows.length !== 1) throw new Error('playwright workspace fixture not found');
    playwrightWsId = rows[0].id;
    // Any live line in the playwright workspace hosts the parent-attached
    // lifecycle test (lines are permanent — the e2e fixtures leave some).
    const lines = await pgGet<{ id: string }>(
      'line',
      jwt,
      new URLSearchParams({
        select: 'id',
        workspace_id: `eq.${playwrightWsId}`,
        deleted_at: 'is.null',
        limit: '1',
      }),
    );
    fixtureLineId = lines.rows[0]?.id ?? null;
    await sweepLeftovers();
  });

  afterAll(async () => {
    await sweepLeftovers();
  });

  // ── anon surface ───────────────────────────────────────────────────────

  test('anon reads zero tasks', async () => {
    const { status, rows } = await pgGet<TaskRow>('task', null);
    expect(rows).toHaveLength(0);
    expect(status).not.toBe(500);
  });

  test('anon cannot execute create_task (EXECUTE revoked)', async () => {
    const { status } = await pgRpc('create_task', null, {
      p_title: 'anon was here',
      p_workspace_id: playwrightWsId,
    });
    expect(status).toBeGreaterThanOrEqual(400);
  });

  test('anon cannot execute delete_task (EXECUTE revoked)', async () => {
    const { status } = await pgRpc('delete_task', null, { p_task_id: RANDOM_UUID });
    expect(status).toBeGreaterThanOrEqual(400);
  });

  test('anon cannot update any task', async () => {
    const { status, rows } = await pgPatch<TaskRow>(
      'task',
      null,
      { title: 'anon was here' },
      new URLSearchParams({ id: `eq.${RANDOM_UUID}` }),
    );
    expect(rows).toHaveLength(0);
    expect(status).not.toBe(500);
  });

  // ── create path (RPC) ──────────────────────────────────────────────────

  test('a member creates a free task in their workspace', async () => {
    const { status, data } = await pgRpc<TaskRow>('create_task', jwt, {
      p_title: `  ${TITLE}  `,
      p_note: 'created by the RLS suite',
      p_due_at: '2030-01-15',
      p_workspace_id: playwrightWsId,
    });
    expect(status).toBeLessThan(300);
    expect(data).not.toBeNull();
    const row = data as TaskRow;
    expect(row.workspace_id).toBe(playwrightWsId);
    expect(row.title).toBe(TITLE); // btrim applied
    expect(row.status).toBe('open');
    expect(row.origin).toBe('manual');
    taskId = row.id;
  });

  // Exact statuses on purpose (line-modules convention): 400 = the 22023
  // input guard fired, 403 = the 42501 collapse. A bare >=400 would stay
  // green with the guard deleted — the unknown-parent collapse fires anyway.
  test('create_task rejects two parents (the XOR guard, not the collapse)', async () => {
    const { status } = await pgRpc('create_task', jwt, {
      p_title: 'ZZZ never lands',
      p_line_id: RANDOM_UUID,
      p_engagement_id: RANDOM_UUID,
    });
    expect(status).toBe(400);
  });

  test('create_task rejects workspace_id alongside a parent', async () => {
    const { status } = await pgRpc('create_task', jwt, {
      p_title: 'ZZZ never lands',
      p_line_id: RANDOM_UUID,
      p_workspace_id: playwrightWsId,
    });
    expect(status).toBe(400);
  });

  test('create_task rejects no parent + no workspace', async () => {
    const { status } = await pgRpc('create_task', jwt, { p_title: 'ZZZ never lands' });
    expect(status).toBe(400);
  });

  test('create_task rejects an empty title', async () => {
    const { status } = await pgRpc('create_task', jwt, {
      p_title: '   ',
      p_workspace_id: playwrightWsId,
    });
    expect(status).toBe(400);
  });

  test('create_task collapses unknown parent and no-membership (no oracle)', async () => {
    const { status } = await pgRpc('create_task', jwt, {
      p_title: 'ZZZ never lands',
      p_line_id: RANDOM_UUID,
    });
    expect(status).toBe(403);
  });

  // ── ADR-070: from_at + lead_days ───────────────────────────────────────

  test('create_task round-trips from_at and lead_days', async () => {
    const { status, data } = await pgRpc<TaskRow>('create_task', jwt, {
      p_title: `ZZZ RLS Task dated ${RUN_TAG}`,
      p_due_at: '2030-01-20',
      p_from_at: '2030-01-10',
      p_lead_days: 5,
      p_workspace_id: playwrightWsId,
    });
    expect(status).toBeLessThan(300);
    const row = data as TaskRow;
    expect(row.from_at?.slice(0, 10)).toBe('2030-01-10');
    expect(row.lead_days).toBe(5);
    const del = await pgRpc('delete_task', jwt, { p_task_id: row.id });
    expect(del.status).toBeLessThan(300);
  });

  test('create_task rejects lead_days out of range (the 22023 guard)', async () => {
    const { status } = await pgRpc('create_task', jwt, {
      p_title: 'ZZZ never lands',
      p_due_at: '2030-01-20',
      p_lead_days: 9999,
      p_workspace_id: playwrightWsId,
    });
    expect(status).toBe(400);
  });

  test('create_task rejects from after due (the 22023 guard)', async () => {
    const { status } = await pgRpc('create_task', jwt, {
      p_title: 'ZZZ never lands',
      p_due_at: '2030-01-01',
      p_from_at: '2030-02-01',
      p_workspace_id: playwrightWsId,
    });
    expect(status).toBe(400);
  });

  test('a parent-attached task derives its workspace from the live parent', async (ctx) => {
    if (!fixtureLineId) return ctx.skip();
    const { status, data } = await pgRpc<TaskRow>('create_task', jwt, {
      p_title: `ZZZ RLS Task parented ${RUN_TAG}`,
      p_line_id: fixtureLineId,
    });
    expect(status).toBeLessThan(300);
    const row = data as TaskRow;
    expect(row.line_id).toBe(fixtureLineId);
    expect(row.project_id).toBeNull();
    expect(row.workspace_id).toBe(playwrightWsId);
    const del = await pgRpc('delete_task', jwt, { p_task_id: row.id });
    expect(del.status).toBeLessThan(300);
  });

  // ── update path (direct PATCH, member-gated) ───────────────────────────

  test('a member toggles status open → done → open', async () => {
    expect(taskId).not.toBeNull();
    const done = await pgPatch<TaskRow>(
      'task',
      jwt,
      { status: 'done' },
      new URLSearchParams({ id: `eq.${taskId}` }),
    );
    expect(done.rows).toHaveLength(1);
    expect(done.rows[0].status).toBe('done');

    const reopened = await pgPatch<TaskRow>(
      'task',
      jwt,
      { status: 'open' },
      new URLSearchParams({ id: `eq.${taskId}` }),
    );
    expect(reopened.rows).toHaveLength(1);
    expect(reopened.rows[0].status).toBe('open');
  });

  test('workspace_id is immutable (guard trigger)', async () => {
    const { status, rows } = await pgPatch<TaskRow>(
      'task',
      jwt,
      { workspace_id: RANDOM_UUID },
      new URLSearchParams({ id: `eq.${taskId}` }),
    );
    expect(rows).toHaveLength(0);
    expect(status).toBeGreaterThanOrEqual(400);
  });

  test('the parent FKs are immutable (guard trigger)', async () => {
    const { status, rows } = await pgPatch<TaskRow>(
      'task',
      jwt,
      { line_id: RANDOM_UUID },
      new URLSearchParams({ id: `eq.${taskId}` }),
    );
    expect(rows).toHaveLength(0);
    expect(status).toBeGreaterThanOrEqual(400);
  });

  test('soft-delete by direct PATCH is impossible by construction (ADR-048)', async () => {
    const { rows } = await pgPatch<TaskRow>(
      'task',
      jwt,
      { deleted_at: new Date().toISOString() },
      new URLSearchParams({ id: `eq.${taskId}` }),
    );
    expect(rows).toHaveLength(0);
    // The row must still be live and readable.
    const after = await pgGet<TaskRow>(
      'task',
      jwt,
      new URLSearchParams({ id: `eq.${taskId}`, select: 'id,deleted_at' }),
    );
    expect(after.rows).toHaveLength(1);
    expect(after.rows[0].deleted_at).toBeNull();
  });

  // ── delete path (RPC) + invisibility ───────────────────────────────────

  test('delete_task soft-deletes and the row disappears', async () => {
    const del = await pgRpc('delete_task', jwt, { p_task_id: taskId });
    expect(del.status).toBeLessThan(300);

    const after = await pgGet<TaskRow>(
      'task',
      jwt,
      new URLSearchParams({ id: `eq.${taskId}` }),
    );
    // PostgREST reveals nothing about hidden rows — soft-deleted and
    // nonexistent are indistinguishable.
    expect(after.rows).toHaveLength(0);
    taskId = null;
  });

  test('delete_task collapses unknown id and no-membership (no oracle)', async () => {
    const { status } = await pgRpc('delete_task', jwt, { p_task_id: RANDOM_UUID });
    expect(status).toBe(403);
  });
});
