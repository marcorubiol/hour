/**
 * RLS regression — availability_block (ADR-078 §4/§5, calendar v2).
 *
 * Access model under test: workspace-scoped (venue/person_note/task
 * family, NOT has_permission) — any accepted member reads/edits the
 * workspace's blackouts; creation via `create_availability_block` RPC
 * (INSERT policy is claim-bound); soft-delete via `delete_availability_block`
 * only (ADR-048); workspace_id and created_by are trigger-immutable.
 * Deliberately NO `kind` column — nothing here should ever accept one.
 *
 * GRACEFUL ABSENCE: the ADR-078 migration is delivered as a file and NOT
 * applied to the live DB yet. beforeAll probes for the table; while it is
 * missing every test SKIPS cleanly (and the suite goes live by itself the
 * day the migration lands — no edits needed).
 *
 * Fixture discipline (ADR-052): everything test-created lives in the
 * user's OWN `playwright` workspace, carries a `ZZZ RLS` note prefix, and
 * is soft-deleted in cleanup. Real workspaces (muk-cia) are never written.
 */

import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { envReady, login, pgGet, pgPatch, pgRpc, requireEnv } from './_helpers';

const RANDOM_UUID = '00000000-0000-4000-8000-000000000000';
const RUN_TAG = Date.now().toString(36);
const NOTE = `ZZZ RLS availability ${RUN_TAG}`;

interface BlockRow {
  id: string;
  workspace_id: string;
  person_id: string | null;
  starts_on: string;
  ends_on: string;
  certainty: string;
  note: string | null;
  deleted_at: string | null;
}

interface WorkspaceRow {
  id: string;
  slug: string;
}

describe.skipIf(!envReady())('availability_block RLS (ADR-078)', () => {
  let jwt: string;
  let playwrightWsId: string;
  let migrated = false;
  let blockId: string | null = null;

  // Prefix-wide (no run tag): a crashed run never reaches afterAll and every
  // later run carries a different tag — crash recovery must sweep ALL
  // leftovers, not just this run's (line-modules convention).
  async function sweepLeftovers() {
    const { rows } = await pgGet<BlockRow>(
      'availability_block',
      jwt,
      new URLSearchParams({
        select: 'id,note',
        workspace_id: `eq.${playwrightWsId}`,
        note: 'like.ZZZ RLS availability*',
      }),
    );
    for (const row of rows) {
      await pgRpc('delete_availability_block', jwt, { p_availability_block_id: row.id });
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

    // Table-exists probe: 404 (PGRST205, missing from the schema cache)
    // while the ADR-078 migration is unapplied → the whole suite skips.
    const probe = await pgGet(
      'availability_block',
      jwt,
      new URLSearchParams({ select: 'id', limit: '1' }),
    );
    migrated = probe.status < 400;
    if (!migrated) {
      console.warn(
        '[rls] availability_block not in the live schema — ADR-078 migration unapplied; suite skips.',
      );
      return;
    }
    await sweepLeftovers();
  });

  afterAll(async () => {
    if (migrated) await sweepLeftovers();
  });

  // ── anon surface ───────────────────────────────────────────────────────

  test('anon reads zero availability blocks', async (ctx) => {
    if (!migrated) return ctx.skip();
    const { status, rows } = await pgGet<BlockRow>('availability_block', null);
    expect(rows).toHaveLength(0);
    expect(status).not.toBe(500);
  });

  test('anon cannot execute create_availability_block (EXECUTE revoked)', async (ctx) => {
    if (!migrated) return ctx.skip();
    const { status } = await pgRpc('create_availability_block', null, {
      p_workspace_id: playwrightWsId,
      p_starts_on: '2030-02-01',
      p_ends_on: '2030-02-02',
    });
    expect(status).toBeGreaterThanOrEqual(400);
  });

  test('anon cannot execute delete_availability_block (EXECUTE revoked)', async (ctx) => {
    if (!migrated) return ctx.skip();
    const { status } = await pgRpc('delete_availability_block', null, {
      p_availability_block_id: RANDOM_UUID,
    });
    expect(status).toBeGreaterThanOrEqual(400);
  });

  test('anon cannot update any availability block', async (ctx) => {
    if (!migrated) return ctx.skip();
    const { status, rows } = await pgPatch<BlockRow>(
      'availability_block',
      null,
      { note: 'anon was here' },
      new URLSearchParams({ id: `eq.${RANDOM_UUID}` }),
    );
    expect(rows).toHaveLength(0);
    expect(status).not.toBe(500);
  });

  // ── create path (RPC) ──────────────────────────────────────────────────

  test('a member creates a company-wide blackout (person_id null)', async (ctx) => {
    if (!migrated) return ctx.skip();
    const { status, data } = await pgRpc<BlockRow>('create_availability_block', jwt, {
      p_workspace_id: playwrightWsId,
      p_starts_on: '2030-02-10',
      p_ends_on: '2030-02-12',
      p_note: `  ${NOTE}  `,
    });
    expect(status).toBeLessThan(300);
    const row = data as BlockRow;
    expect(row.workspace_id).toBe(playwrightWsId);
    expect(row.person_id).toBeNull();
    expect(row.certainty).toBe('unavailable'); // the default
    expect(row.note).toBe(NOTE); // btrim applied
    blockId = row.id;
  });

  // Exact statuses on purpose (line-modules convention): 400 = the 22023
  // input guard fired, 403 = the 42501 collapse. A bare >=400 would stay
  // green with the guard deleted — the unknown-workspace collapse fires anyway.
  test('create rejects ends_on before starts_on (the 22023 guard)', async (ctx) => {
    if (!migrated) return ctx.skip();
    const { status } = await pgRpc('create_availability_block', jwt, {
      p_workspace_id: playwrightWsId,
      p_starts_on: '2030-02-12',
      p_ends_on: '2030-02-10',
      p_note: 'ZZZ RLS availability never lands',
    });
    expect(status).toBe(400);
  });

  test('create rejects an unknown certainty (no kind axis sneaks in)', async (ctx) => {
    if (!migrated) return ctx.skip();
    const { status } = await pgRpc('create_availability_block', jwt, {
      p_workspace_id: playwrightWsId,
      p_starts_on: '2030-02-10',
      p_ends_on: '2030-02-12',
      p_certainty: 'vacation',
      p_note: 'ZZZ RLS availability never lands',
    });
    expect(status).toBe(400);
  });

  test('create collapses unknown workspace and no-membership (no oracle)', async (ctx) => {
    if (!migrated) return ctx.skip();
    const { status } = await pgRpc('create_availability_block', jwt, {
      p_workspace_id: RANDOM_UUID,
      p_starts_on: '2030-02-10',
      p_ends_on: '2030-02-12',
    });
    expect(status).toBe(403);
  });

  test('create collapses unknown person and not-visible (no oracle)', async (ctx) => {
    if (!migrated) return ctx.skip();
    const { status } = await pgRpc('create_availability_block', jwt, {
      p_workspace_id: playwrightWsId,
      p_person_id: RANDOM_UUID,
      p_starts_on: '2030-02-10',
      p_ends_on: '2030-02-12',
    });
    expect(status).toBe(403);
  });

  // ── read path (member + embed) ─────────────────────────────────────────

  test('a member reads the block back with the person embed', async (ctx) => {
    if (!migrated) return ctx.skip();
    expect(blockId).not.toBeNull();
    const { rows } = await pgGet<BlockRow & { person: unknown }>(
      'availability_block',
      jwt,
      new URLSearchParams({
        select: 'id,person_id,certainty,person:person_id(id,slug,full_name)',
        id: `eq.${blockId}`,
      }),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].person).toBeNull(); // company-wide — no person to embed
  });

  // ── update path (direct PATCH, member-gated) ───────────────────────────

  test('a member edits certainty and dates by direct PATCH', async (ctx) => {
    if (!migrated) return ctx.skip();
    const { rows } = await pgPatch<BlockRow>(
      'availability_block',
      jwt,
      { certainty: 'tentative', ends_on: '2030-02-14' },
      new URLSearchParams({ id: `eq.${blockId}` }),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].certainty).toBe('tentative');
    expect(rows[0].ends_on).toBe('2030-02-14');
  });

  test('a PATCH breaking the range CHECK is rejected (23514)', async (ctx) => {
    if (!migrated) return ctx.skip();
    const { status, rows } = await pgPatch<BlockRow>(
      'availability_block',
      jwt,
      { ends_on: '2030-01-01' }, // before starts_on 2030-02-10
      new URLSearchParams({ id: `eq.${blockId}` }),
    );
    expect(rows).toHaveLength(0);
    expect(status).toBeGreaterThanOrEqual(400);
  });

  test('workspace_id is immutable (guard trigger)', async (ctx) => {
    if (!migrated) return ctx.skip();
    const { status, rows } = await pgPatch<BlockRow>(
      'availability_block',
      jwt,
      { workspace_id: RANDOM_UUID },
      new URLSearchParams({ id: `eq.${blockId}` }),
    );
    expect(rows).toHaveLength(0);
    expect(status).toBeGreaterThanOrEqual(400);
  });

  test('created_by is immutable (guard trigger)', async (ctx) => {
    if (!migrated) return ctx.skip();
    const { status, rows } = await pgPatch<BlockRow>(
      'availability_block',
      jwt,
      { created_by: RANDOM_UUID },
      new URLSearchParams({ id: `eq.${blockId}` }),
    );
    expect(rows).toHaveLength(0);
    expect(status).toBeGreaterThanOrEqual(400);
  });

  test('soft-delete by direct PATCH is impossible by construction (ADR-048)', async (ctx) => {
    if (!migrated) return ctx.skip();
    const { rows } = await pgPatch<BlockRow>(
      'availability_block',
      jwt,
      { deleted_at: new Date().toISOString() },
      new URLSearchParams({ id: `eq.${blockId}` }),
    );
    expect(rows).toHaveLength(0);
    // The row must still be live and readable.
    const after = await pgGet<BlockRow>(
      'availability_block',
      jwt,
      new URLSearchParams({ id: `eq.${blockId}`, select: 'id,deleted_at' }),
    );
    expect(after.rows).toHaveLength(1);
    expect(after.rows[0].deleted_at).toBeNull();
  });

  // ── delete path (RPC) + invisibility ───────────────────────────────────

  test('delete_availability_block soft-deletes and the row disappears', async (ctx) => {
    if (!migrated) return ctx.skip();
    const del = await pgRpc('delete_availability_block', jwt, {
      p_availability_block_id: blockId,
    });
    expect(del.status).toBeLessThan(300);

    const after = await pgGet<BlockRow>(
      'availability_block',
      jwt,
      new URLSearchParams({ id: `eq.${blockId}` }),
    );
    // PostgREST reveals nothing about hidden rows — soft-deleted and
    // nonexistent are indistinguishable.
    expect(after.rows).toHaveLength(0);
    blockId = null;
  });

  test('delete collapses unknown id and no-membership (no oracle)', async (ctx) => {
    if (!migrated) return ctx.skip();
    const { status } = await pgRpc('delete_availability_block', jwt, {
      p_availability_block_id: RANDOM_UUID,
    });
    expect(status).toBe(403);
  });
});
