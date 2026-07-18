/**
 * RLS regression — `date` calendar-v2 columns + write RPCs (ADR-078).
 *
 * Under test: the cascade middle level (`line_id`), the travel axis
 * (`travel_direction` + its CHECK), the `day_off` kind, the label→
 * custom_fields whitelist, and the `create_date` / `delete_date` RPCs
 * (claim-independent, has_permission(project, 'edit:performance')-gated;
 * every cross-field contract rule re-enforced inside the RPC — strict
 * AI=UI parity, ADR-078 §7).
 *
 * NOT under test: cross-project relink by direct PATCH of line_id /
 * performance_id — the model deliberately guards that at the endpoint
 * (ADR-043 pattern, same as performance.line_id), not in the DB.
 *
 * GRACEFUL ABSENCE: the ADR-078 migrations are files, not applied yet.
 * beforeAll probes for the new columns AND the RPC; while either is
 * missing every test SKIPS cleanly and the suite arms itself the day the
 * migrations land.
 *
 * Fixture discipline (ADR-052): everything test-created lives in the
 * user's OWN `playwright` workspace, is `ZZZ`-prefixed, and is soft-
 * deleted in cleanup.
 */

import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { envReady, login, pgGet, pgPatch, pgRpc, requireEnv } from './_helpers';

const RANDOM_UUID = '00000000-0000-4000-8000-000000000000';
const RUN_TAG = Date.now().toString(36);
const TITLE = `ZZZ RLS Date ${RUN_TAG}`;

interface DateRow {
  id: string;
  workspace_id: string;
  project_id: string;
  line_id: string | null;
  performance_id: string | null;
  kind: string;
  status: string;
  title: string | null;
  starts_at: string;
  travel_direction: string | null;
  custom_fields: Record<string, unknown>;
  deleted_at: string | null;
}

interface WorkspaceRow {
  id: string;
  slug: string;
}

interface LineRow {
  id: string;
  project_id: string;
}

describe.skipIf(!envReady())('date calendar-v2 RLS (ADR-078)', () => {
  let jwt: string;
  let playwrightWsId: string;
  let migrated = false;
  let projectId: string | null = null; // host project for created dates
  let ownLineId: string | null = null; // a line of that project
  let foreignLineId: string | null = null; // a line of ANOTHER project
  let dateId: string | null = null;

  // Prefix-wide sweep (no run tag) — crash recovery must catch every
  // leftover, not just this run's (line-modules convention).
  async function sweepLeftovers() {
    const { rows } = await pgGet<DateRow>(
      'date',
      jwt,
      new URLSearchParams({
        select: 'id,title',
        workspace_id: `eq.${playwrightWsId}`,
        title: 'like.ZZZ RLS Date*',
      }),
    );
    for (const row of rows) {
      await pgRpc('delete_date', jwt, { p_date_id: row.id });
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

    // Column-exists probe: selecting the ADR-078 columns 400s (undefined
    // column) while date_cascade_travel is unapplied.
    const columnProbe = await pgGet(
      'date',
      jwt,
      new URLSearchParams({ select: 'id,line_id,travel_direction', limit: '1' }),
    );
    // RPC-exists probe: PostgREST answers 404 (PGRST202) for a function it
    // does not know; an applied create_date answers 403 here (unknown
    // project collapses — no writes either way).
    const rpcProbe = await pgRpc('create_date', jwt, {
      p_project_id: RANDOM_UUID,
      p_kind: 'rehearsal',
      p_starts_at: '2030-03-01T10:00:00Z',
    });
    migrated = columnProbe.status < 400 && rpcProbe.status !== 404;
    if (!migrated) {
      console.warn(
        '[rls] date calendar-v2 columns/RPCs not in the live schema — ADR-078 migrations unapplied; suite skips.',
      );
      return;
    }

    // Any live line in the playwright workspace supplies the host project
    // (lines are permanent — the e2e fixtures leave some); a line of a
    // different project, when one exists, hosts the cross-project guard.
    const lines = await pgGet<LineRow>(
      'line',
      jwt,
      new URLSearchParams({
        select: 'id,project_id',
        workspace_id: `eq.${playwrightWsId}`,
        deleted_at: 'is.null',
      }),
    );
    const first = lines.rows[0];
    if (first) {
      ownLineId = first.id;
      projectId = first.project_id;
      foreignLineId = lines.rows.find((l) => l.project_id !== first.project_id)?.id ?? null;
    }
    await sweepLeftovers();
  });

  afterAll(async () => {
    if (migrated) await sweepLeftovers();
  });

  // ── anon surface ───────────────────────────────────────────────────────

  test('anon cannot execute create_date (EXECUTE revoked)', async (ctx) => {
    if (!migrated) return ctx.skip();
    const { status } = await pgRpc('create_date', null, {
      p_project_id: RANDOM_UUID,
      p_kind: 'rehearsal',
      p_starts_at: '2030-03-01T10:00:00Z',
    });
    expect(status).toBeGreaterThanOrEqual(400);
  });

  test('anon cannot execute delete_date (EXECUTE revoked)', async (ctx) => {
    if (!migrated) return ctx.skip();
    const { status } = await pgRpc('delete_date', null, { p_date_id: RANDOM_UUID });
    expect(status).toBeGreaterThanOrEqual(400);
  });

  // ── create path (RPC) ──────────────────────────────────────────────────

  test('a member with edit:performance creates a rehearsal date', async (ctx) => {
    if (!migrated || !projectId) return ctx.skip();
    const { status, data } = await pgRpc<DateRow>('create_date', jwt, {
      p_project_id: projectId,
      p_kind: 'rehearsal',
      p_starts_at: '2030-03-01T10:00:00Z',
      p_title: `  ${TITLE}  `,
    });
    expect(status).toBeLessThan(300);
    const row = data as DateRow;
    expect(row.workspace_id).toBe(playwrightWsId); // derived from the project
    expect(row.project_id).toBe(projectId);
    expect(row.status).toBe('tentative'); // the create default
    expect(row.title).toBe(TITLE); // btrim applied
    expect(row.travel_direction).toBeNull();
    dateId = row.id;
  });

  // Exact statuses on purpose: 400 = the 22023 contract guard fired,
  // 403 = the 42501 collapse (line-modules convention).
  test('create_date rejects a lifecycle status on create (§9 whitelist)', async (ctx) => {
    if (!migrated || !projectId) return ctx.skip();
    const { status } = await pgRpc('create_date', jwt, {
      p_project_id: projectId,
      p_kind: 'rehearsal',
      p_starts_at: '2030-03-01T10:00:00Z',
      p_status: 'cancelled',
      p_title: 'ZZZ RLS Date never lands',
    });
    expect(status).toBe(400);
  });

  test('create_date rejects travel_direction on a non-travel kind', async (ctx) => {
    if (!migrated || !projectId) return ctx.skip();
    const { status } = await pgRpc('create_date', jwt, {
      p_project_id: projectId,
      p_kind: 'rehearsal',
      p_starts_at: '2030-03-01T10:00:00Z',
      p_travel_direction: 'outbound',
      p_title: 'ZZZ RLS Date never lands',
    });
    expect(status).toBe(400);
  });

  test('create_date rejects an unknown travel_direction on a travel day', async (ctx) => {
    if (!migrated || !projectId) return ctx.skip();
    const { status } = await pgRpc('create_date', jwt, {
      p_project_id: projectId,
      p_kind: 'travel_day',
      p_starts_at: '2030-03-01T10:00:00Z',
      p_travel_direction: 'sideways',
      p_title: 'ZZZ RLS Date never lands',
    });
    expect(status).toBe(400);
  });

  test('create_date round-trips a directed travel day (feeds awayBands)', async (ctx) => {
    if (!migrated || !projectId) return ctx.skip();
    const { status, data } = await pgRpc<DateRow>('create_date', jwt, {
      p_project_id: projectId,
      p_kind: 'travel_day',
      p_starts_at: '2030-03-02T08:00:00Z',
      p_travel_direction: 'outbound',
      p_title: `ZZZ RLS Date travel ${RUN_TAG}`,
    });
    expect(status).toBeLessThan(300);
    const row = data as DateRow;
    expect(row.kind).toBe('travel_day');
    expect(row.travel_direction).toBe('outbound');
    const del = await pgRpc('delete_date', jwt, { p_date_id: row.id });
    expect(del.status).toBeLessThan(300);
  });

  test('create_date accepts the new day_off kind (ADR-078 §3)', async (ctx) => {
    if (!migrated || !projectId) return ctx.skip();
    const { status, data } = await pgRpc<DateRow>('create_date', jwt, {
      p_project_id: projectId,
      p_kind: 'day_off',
      p_starts_at: '2030-03-03T00:00:00Z',
      p_all_day: true,
      p_title: `ZZZ RLS Date dayoff ${RUN_TAG}`,
    });
    expect(status).toBeLessThan(300);
    const row = data as DateRow;
    expect(row.kind).toBe('day_off');
    const del = await pgRpc('delete_date', jwt, { p_date_id: row.id });
    expect(del.status).toBeLessThan(300);
  });

  test('create_date rejects a label on kind != other (§8 whitelist)', async (ctx) => {
    if (!migrated || !projectId) return ctx.skip();
    const { status } = await pgRpc('create_date', jwt, {
      p_project_id: projectId,
      p_kind: 'rehearsal',
      p_starts_at: '2030-03-01T10:00:00Z',
      p_label: 'gala',
      p_title: 'ZZZ RLS Date never lands',
    });
    expect(status).toBe(400);
  });

  test('create_date stores the label at custom_fields.label for kind=other', async (ctx) => {
    if (!migrated || !projectId) return ctx.skip();
    const { status, data } = await pgRpc<DateRow>('create_date', jwt, {
      p_project_id: projectId,
      p_kind: 'other',
      p_starts_at: '2030-03-04T10:00:00Z',
      p_label: `  gala ${RUN_TAG}  `,
      p_title: `ZZZ RLS Date label ${RUN_TAG}`,
    });
    expect(status).toBeLessThan(300);
    const row = data as DateRow;
    expect(row.custom_fields).toEqual({ label: `gala ${RUN_TAG}` }); // btrim, sole writer
    const del = await pgRpc('delete_date', jwt, { p_date_id: row.id });
    expect(del.status).toBeLessThan(300);
  });

  test('create_date links a line of the same project (cascade level)', async (ctx) => {
    if (!migrated || !projectId || !ownLineId) return ctx.skip();
    const { status, data } = await pgRpc<DateRow>('create_date', jwt, {
      p_project_id: projectId,
      p_kind: 'rehearsal',
      p_starts_at: '2030-03-05T10:00:00Z',
      p_line_id: ownLineId,
      p_title: `ZZZ RLS Date lined ${RUN_TAG}`,
    });
    expect(status).toBeLessThan(300);
    const row = data as DateRow;
    expect(row.line_id).toBe(ownLineId);
    const del = await pgRpc('delete_date', jwt, { p_date_id: row.id });
    expect(del.status).toBeLessThan(300);
  });

  test('create_date rejects a line of ANOTHER project (the 22023 guard)', async (ctx) => {
    if (!migrated || !projectId || !foreignLineId) return ctx.skip();
    const { status } = await pgRpc('create_date', jwt, {
      p_project_id: projectId,
      p_kind: 'rehearsal',
      p_starts_at: '2030-03-01T10:00:00Z',
      p_line_id: foreignLineId,
      p_title: 'ZZZ RLS Date never lands',
    });
    expect(status).toBe(400);
  });

  test('create_date collapses an unknown line into the same 400 (no oracle)', async (ctx) => {
    if (!migrated || !projectId) return ctx.skip();
    const { status } = await pgRpc('create_date', jwt, {
      p_project_id: projectId,
      p_kind: 'rehearsal',
      p_starts_at: '2030-03-01T10:00:00Z',
      p_line_id: RANDOM_UUID,
      p_title: 'ZZZ RLS Date never lands',
    });
    expect(status).toBe(400);
  });

  test('create_date rejects an unknown performance the same way', async (ctx) => {
    if (!migrated || !projectId) return ctx.skip();
    const { status } = await pgRpc('create_date', jwt, {
      p_project_id: projectId,
      p_kind: 'rehearsal',
      p_starts_at: '2030-03-01T10:00:00Z',
      p_performance_id: RANDOM_UUID,
      p_title: 'ZZZ RLS Date never lands',
    });
    expect(status).toBe(400);
  });

  test('create_date collapses unknown project and no-permission (no oracle)', async (ctx) => {
    if (!migrated) return ctx.skip();
    const { status } = await pgRpc('create_date', jwt, {
      p_project_id: RANDOM_UUID,
      p_kind: 'rehearsal',
      p_starts_at: '2030-03-01T10:00:00Z',
      p_title: 'ZZZ RLS Date never lands',
    });
    expect(status).toBe(403);
  });

  // ── the DB-level CHECK on the new column ───────────────────────────────

  test('a direct PATCH cannot put a travel_direction on a rehearsal (23514)', async (ctx) => {
    if (!migrated) return ctx.skip();
    expect(dateId).not.toBeNull();
    const { status, rows } = await pgPatch<DateRow>(
      'date',
      jwt,
      { travel_direction: 'outbound' }, // dateId is kind='rehearsal'
      new URLSearchParams({ id: `eq.${dateId}` }),
    );
    expect(rows).toHaveLength(0);
    expect(status).toBeGreaterThanOrEqual(400);
  });

  // ── delete path (RPC) + invisibility ───────────────────────────────────

  test('delete_date soft-deletes and the row disappears', async (ctx) => {
    if (!migrated) return ctx.skip();
    const del = await pgRpc('delete_date', jwt, { p_date_id: dateId });
    expect(del.status).toBeLessThan(300);

    const after = await pgGet<DateRow>(
      'date',
      jwt,
      new URLSearchParams({ id: `eq.${dateId}` }),
    );
    // Soft-deleted and nonexistent are indistinguishable by design.
    expect(after.rows).toHaveLength(0);
    dateId = null;
  });

  test('delete_date collapses unknown id and no-permission (no oracle)', async (ctx) => {
    if (!migrated) return ctx.skip();
    const { status } = await pgRpc('delete_date', jwt, { p_date_id: RANDOM_UUID });
    expect(status).toBe(403);
  });
});
