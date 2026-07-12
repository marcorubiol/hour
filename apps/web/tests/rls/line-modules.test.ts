/**
 * RLS regression — ADR-056 line modules: line.modules + engagement.line_id
 * + the create/delete RPC pairs for expense and asset_version, exercised
 * against the live project as the fixture user and as anon.
 *
 * Fixture LINE is STABLE (find-or-create by name in the playwright
 * project): lines have no delete path — no DELETE policy and soft-delete
 * by PATCH is impossible by construction (ADR-048) — so a per-run line
 * would accumulate forever. Engagement/expense/asset fixtures are
 * soft-deleted via their RPCs in `finally` blocks.
 *
 * These tests REQUIRE the 2026-07-12 migrations (engagement.line_id,
 * line.modules, the new RPCs). Red before they apply is expected.
 */

import { beforeAll, describe, expect, test } from 'vitest';
import { envReady, login, pgGet, pgPatch, pgRpc, requireEnv } from './_helpers';

type LineRow = {
  id: string;
  slug: string | null;
  name: string;
  kind: string;
  modules: string[] | null;
  project_id: string;
  workspace_id: string;
};

type EngagementRow = {
  id: string;
  line_id: string | null;
  project_id: string;
};

type ExpenseRow = { id: string; line_id: string | null; amount: number; currency: string };
type AssetRow = { id: string; direction: string; kind: string; url: string };

const RANDOM_UUID = '00000000-0000-4000-8000-000000000000';
const FIXTURE_LINE_NAME = 'ZZZ RLS Modules Fixture';
const FIXTURE_EMAIL = 'zzz-rls-line-modules@hour.test';
const RUN_TAG = `${Date.now().toString(36)}`;

describe.skipIf(!envReady())('RLS — ADR-056 line modules', () => {
  let jwt: string;
  let projectId: string;
  let fixtureLine: LineRow;

  beforeAll(async () => {
    const { email, password } = requireEnv();
    jwt = await login(email, password);

    const projects = await pgGet<{ id: string; workspace: { slug: string } }>(
      'project',
      jwt,
      new URLSearchParams({
        select: 'id,workspace:workspace_id!inner(slug)',
        'workspace.slug': 'eq.playwright',
        deleted_at: 'is.null',
        order: 'id.asc',
        limit: '1',
      }),
    );
    if (projects.rows.length === 0) {
      throw new Error('No live project in the playwright workspace — fixtures missing');
    }
    projectId = projects.rows[0].id;

    // Find-or-create the STABLE fixture line (template shape: booking).
    const existing = await pgGet<LineRow>(
      'line',
      jwt,
      new URLSearchParams({
        select: 'id,slug,name,kind,modules,project_id,workspace_id',
        project_id: `eq.${projectId}`,
        name: `eq.${FIXTURE_LINE_NAME}`,
        deleted_at: 'is.null',
        limit: '1',
      }),
    );
    if (existing.rows.length > 0) {
      fixtureLine = existing.rows[0];
    } else {
      const created = await pgRpc<LineRow>('create_line', jwt, {
        p_project_id: projectId,
        p_name: FIXTURE_LINE_NAME,
        p_kind: 'campaign',
        p_modules: ['contacts', 'calendar', 'materials', 'notes'],
      });
      if (created.status !== 200 || !created.data) {
        throw new Error(`create_line fixture failed: ${created.status}`);
      }
      fixtureLine = created.data as LineRow;
    }

    // Crash recovery: a killed run may have left the fixture line's
    // modules poisoned (lines have no delete path) — reset unconditionally
    // so test 1's template assertion never inherits stale state.
    await pgPatch<LineRow>(
      'line',
      jwt,
      { modules: ['contacts', 'calendar', 'materials', 'notes'] },
      new URLSearchParams({ id: `eq.${fixtureLine.id}`, select: 'id' }),
    );
    fixtureLine.modules = ['contacts', 'calendar', 'materials', 'notes'];

    // Crash recovery: soft-delete a leftover fixture engagement.
    const stale = await pgGet<{ id: string }>(
      'engagement',
      jwt,
      new URLSearchParams({
        select: 'id,person:person_id!inner(email)',
        'person.email': `eq.${FIXTURE_EMAIL}`,
        project_id: `eq.${projectId}`,
        deleted_at: 'is.null',
      }),
    );
    for (const row of stale.rows) {
      await pgRpc('delete_engagement', jwt, { p_engagement_id: row.id });
    }
  });

  // ── create_line template shape ──────────────────────────────────────
  test('create_line returns a slug and the template modules', () => {
    // The fixture line was created (or found) with the booking template.
    expect(fixtureLine.slug).toBeTruthy();
    expect(fixtureLine.kind).toBe('campaign');
    if (fixtureLine.modules !== null) {
      expect(fixtureLine.modules).toEqual(['contacts', 'calendar', 'materials', 'notes']);
    }
  });

  test('line.modules PATCH round-trips for a member and is invisible to anon', async () => {
    const next = ['notes', 'contacts'];
    const patched = await pgPatch<LineRow>(
      'line',
      jwt,
      { modules: next },
      new URLSearchParams({
        id: `eq.${fixtureLine.id}`,
        deleted_at: 'is.null',
        select: 'id,modules',
      }),
    );
    try {
      expect(patched.status).toBeLessThan(300);
      expect(patched.rows[0]?.modules).toEqual(next);

      const anon = await pgPatch<LineRow>(
        'line',
        null,
        { modules: ['notes'] },
        new URLSearchParams({ id: `eq.${fixtureLine.id}`, select: 'id,modules' }),
      );
      expect(anon.rows).toHaveLength(0);
      expect(anon.status).not.toBe(500);
    } finally {
      // Restore the fixture's template shape — lines are permanent, a
      // skipped restore would poison every later run (review 2026-07-12).
      await pgPatch<LineRow>(
        'line',
        jwt,
        { modules: ['contacts', 'calendar', 'materials', 'notes'] },
        new URLSearchParams({ id: `eq.${fixtureLine.id}`, select: 'id' }),
      );
    }
  });

  // ── engagement.line_id via create_engagement ────────────────────────
  test('create_engagement with a cross-project line → 400; with the right line → assigned; resurrect keeps it', async () => {
    // Cross-project: the real difusion line belongs to muk-cia, not here —
    // an unknown-but-valid uuid is enough (guard collapses to 22023).
    const cross = await pgRpc('create_engagement', jwt, {
      p_project_id: projectId,
      p_full_name: 'ZZZ Cross Project',
      p_line_id: RANDOM_UUID,
    });
    expect(cross.status).toBe(400);

    const created = await pgRpc<EngagementRow>('create_engagement', jwt, {
      p_project_id: projectId,
      p_full_name: 'ZZZ Line Modules Fixture',
      p_email: FIXTURE_EMAIL,
      p_line_id: fixtureLine.id,
    });
    expect(created.status).toBe(200);
    const engagement = created.data as EngagementRow;
    expect(engagement.line_id).toBe(fixtureLine.id);

    try {
      // Soft-delete, then resurrect WITH the line — the resurrect UPDATE
      // must set line_id too (a resurrected conversation is not line-less).
      await pgRpc('delete_engagement', jwt, { p_engagement_id: engagement.id });
      const again = await pgRpc<EngagementRow>('create_engagement', jwt, {
        p_project_id: projectId,
        p_full_name: 'ZZZ Line Modules Fixture',
        p_email: FIXTURE_EMAIL,
        p_line_id: fixtureLine.id,
      });
      expect(again.status).toBe(200);
      expect((again.data as EngagementRow).line_id).toBe(fixtureLine.id);
    } finally {
      await pgRpc('delete_engagement', jwt, { p_engagement_id: engagement.id });
    }
  });

  // ── expense RPCs ─────────────────────────────────────────────────────
  test('anon cannot execute the expense/asset RPCs (no grant)', async () => {
    for (const [fn, args] of [
      ['create_expense', { p_line_id: RANDOM_UUID, p_description: 'x', p_amount: 1 }],
      ['delete_expense', { p_expense_id: RANDOM_UUID }],
      ['create_asset_version', { p_line_id: RANDOM_UUID, p_kind: 'rider', p_url: 'https://x.test' }],
      ['delete_asset_version', { p_asset_id: RANDOM_UUID }],
    ] as const) {
      const { status } = await pgRpc(fn, null, args as Record<string, unknown>);
      expect(status, fn).toBeGreaterThanOrEqual(400);
    }
  });

  test('expense lifecycle: XOR guard → create on line → delete → gone', async () => {
    const both = await pgRpc('create_expense', jwt, {
      p_performance_id: RANDOM_UUID,
      p_line_id: fixtureLine.id,
      p_description: 'both parents',
      p_amount: 10,
    });
    expect(both.status).toBe(400);

    const unknown = await pgRpc('create_expense', jwt, {
      p_line_id: RANDOM_UUID,
      p_description: 'ghost line',
      p_amount: 10,
    });
    expect(unknown.status).toBe(403);

    const created = await pgRpc<ExpenseRow>('create_expense', jwt, {
      p_line_id: fixtureLine.id,
      p_category: 'travel',
      p_description: `zzz-rls-expense-${RUN_TAG}`,
      p_amount: 12.345,
      p_currency: 'eur',
    });
    expect(created.status).toBe(200);
    const expense = created.data as ExpenseRow;
    expect(expense.line_id).toBe(fixtureLine.id);
    expect(Number(expense.amount)).toBeCloseTo(12.35, 2);
    expect(expense.currency).toBe('EUR');

    try {
      const del = await pgRpc('delete_expense', jwt, { p_expense_id: expense.id });
      expect(del.status).toBeLessThan(300);
      const after = await pgGet<ExpenseRow>(
        'expense',
        jwt,
        new URLSearchParams({ select: 'id', id: `eq.${expense.id}`, deleted_at: 'is.null' }),
      );
      expect(after.rows).toHaveLength(0);
    } finally {
      await pgRpc('delete_expense', jwt, { p_expense_id: expense.id });
    }
  });

  test('delete_expense against an unknown id → 403 (no existence oracle)', async () => {
    const { status } = await pgRpc('delete_expense', jwt, { p_expense_id: RANDOM_UUID });
    expect(status).toBe(403);
  });

  // ── asset_version RPCs ───────────────────────────────────────────────
  test('material lifecycle: inbound rejected at line scope → create outbound → delete → gone', async () => {
    const inbound = await pgRpc('create_asset_version', jwt, {
      p_line_id: fixtureLine.id,
      p_kind: 'rider',
      p_url: 'https://example.test/rider.pdf',
      p_direction: 'inbound',
    });
    expect(inbound.status).toBe(400);

    const created = await pgRpc<AssetRow>('create_asset_version', jwt, {
      p_line_id: fixtureLine.id,
      p_kind: 'dossier',
      p_url: `https://example.test/zzz-rls-${RUN_TAG}.pdf`,
      p_notes: 'RLS fixture',
    });
    expect(created.status).toBe(200);
    const asset = created.data as AssetRow;
    expect(asset.direction).toBe('outbound');

    try {
      const del = await pgRpc('delete_asset_version', jwt, { p_asset_id: asset.id });
      expect(del.status).toBeLessThan(300);
      const after = await pgGet<AssetRow>(
        'asset_version',
        jwt,
        new URLSearchParams({ select: 'id', id: `eq.${asset.id}`, deleted_at: 'is.null' }),
      );
      expect(after.rows).toHaveLength(0);
    } finally {
      await pgRpc('delete_asset_version', jwt, { p_asset_id: asset.id });
    }
  });

  // ── backfill canary (read-only — never mutates the real campaign) ────
  test('the difusión backfill left engagements carrying line_id', async () => {
    const line = await pgGet<{ id: string }>(
      'line',
      jwt,
      new URLSearchParams({
        select: 'id',
        slug: 'eq.difusion-2026-27',
        deleted_at: 'is.null',
        limit: '1',
      }),
    );
    // The real campaign is visible to the fixture user (admin of muk-cia).
    expect(line.rows).toHaveLength(1);
    const linked = await pgGet<{ id: string }>(
      'engagement',
      jwt,
      new URLSearchParams({
        select: 'id',
        line_id: `eq.${line.rows[0].id}`,
        deleted_at: 'is.null',
        limit: '1',
      }),
    );
    expect(linked.rows.length).toBeGreaterThan(0);
  });
});
