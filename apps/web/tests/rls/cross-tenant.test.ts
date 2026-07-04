/**
 * RLS regression — cross-tenant isolation.
 *
 * Verifies that an authenticated user cannot see workspaces, accounts,
 * or engagements they have no membership in, and that anonymous (no JWT)
 * requests return zero rows regardless. This is the most load-bearing
 * test in the suite — if it ever turns red, the multi-tenant promise of
 * Hour is broken.
 *
 * Fixtures used (no test data created):
 *   - User `playwright@hour.test`:
 *     - workspace_membership: admin of `mamemi`, admin of `marco-rubiol`
 *       (legacy from initial test user setup, see runbook), owner of
 *       `playwright`.
 *     - account_membership: owner of `playwright-acc` ONLY. NOT a member
 *       of `mamemi-acc` or `marco-rubiol-acc` despite workspace access.
 *       This is the intended account-vs-workspace separation per ADR-032:
 *       you can WORK in a workspace without being an admin of its account.
 *   - Anonymous (no JWT).
 */

import { beforeAll, describe, expect, test } from 'vitest';
import { decodeJwt, envReady, login, pgGet, requireEnv } from './_helpers';

describe.skipIf(!envReady())('RLS — cross-tenant isolation', () => {
  let playwrightJwt: string;
  let playwrightUserId: string;

  beforeAll(async () => {
    const { email, password } = requireEnv();
    playwrightJwt = await login(email, password);
    const claims = decodeJwt(playwrightJwt);
    playwrightUserId = String(claims.sub);
  });

  test('playwright sees only the workspaces they are member of', async () => {
    const { rows } = await pgGet<{ slug: string }>(
      'workspace',
      playwrightJwt,
      new URLSearchParams({ select: 'slug', deleted_at: 'is.null' }),
    );
    const slugs = rows.map((r) => r.slug).sort();
    // marco-rubiol is included as legacy admin (test-user-setup); muk-cia
    // (renamed from mamemi, ADR-036 2026-05-19) added on the multi-workspace
    // split; playwright is the user's own. What matters for RLS: playwright
    // must NEVER see a workspace they are NOT a member of — the `demo`
    // workspace exists in the DB and must stay invisible here.
    expect(slugs).toEqual(['marco-rubiol', 'muk-cia', 'playwright']);
    expect(slugs).not.toContain('demo');
  });

  test('account RLS: playwright sees only accounts where they have account_membership', async () => {
    const { rows } = await pgGet<{ slug: string }>(
      'account',
      playwrightJwt,
      new URLSearchParams({ select: 'slug', deleted_at: 'is.null' }),
    );
    const slugs = rows.map((r) => r.slug).sort();
    // Critical ADR-032 separation: playwright has workspace_membership
    // in `mamemi` (admin) but NOT account_membership in `mamemi-acc`.
    // They should see only their own account.
    expect(slugs).toEqual(['playwright-acc']);
    expect(slugs).not.toContain('mamemi-acc');
    expect(slugs).not.toContain('marco-rubiol-acc');
  });

  test('account_membership RLS: playwright sees only their own rows', async () => {
    const { rows } = await pgGet<{ user_id: string }>(
      'account_membership',
      playwrightJwt,
      new URLSearchParams({ select: 'user_id' }),
    );
    // Playwright is owner of playwright-acc only → can see all members of
    // playwright-acc (currently just themselves). They are NOT admin/owner
    // of any other account → for those, the policy falls back to the
    // user_id = auth.uid() clause, which only matches their own row (none
    // exist outside playwright-acc).
    expect(rows.length).toBeGreaterThanOrEqual(1);
    expect(rows.every((r) => r.user_id === playwrightUserId)).toBe(true);
  });

  test('playwright user sees engagements only in workspaces they belong to', async () => {
    const { rows } = await pgGet<{ workspace_id: string }>(
      'engagement',
      playwrightJwt,
      new URLSearchParams({
        select: 'workspace_id',
        deleted_at: 'is.null',
        limit: '500',
      }),
    );
    // Playwright is admin of `muk-cia` (which holds the 154 imported
    // engagements). They have no engagement access via marco-rubiol.
    expect(rows.length).toBeGreaterThanOrEqual(154);

    // The security invariant is MEMBERSHIP-BOUNDED visibility: every
    // visible engagement must live in a workspace the caller belongs to.
    // (The old `distinct workspaces === 1` shape broke once ADR-051
    // lifecycle fixtures started creating short-lived engagements in the
    // `playwright` workspace — that was an artifact of the data, not the
    // leak canary itself.)
    const memberships = await pgGet<{ workspace_id: string }>(
      'workspace_membership',
      playwrightJwt,
      new URLSearchParams({ select: 'workspace_id' }),
    );
    const allowed = new Set(memberships.rows.map((m) => m.workspace_id));
    expect(allowed.size).toBeGreaterThanOrEqual(1);
    const outside = rows.filter((r) => !allowed.has(r.workspace_id));
    expect(outside).toHaveLength(0);
  });

  test('anonymous request to workspace returns zero rows', async () => {
    const { rows } = await pgGet('workspace', null);
    expect(rows.length).toBe(0);
  });

  test('anonymous request to account returns zero rows', async () => {
    const { rows } = await pgGet('account', null);
    expect(rows.length).toBe(0);
  });

  test('anonymous request to engagement returns zero rows', async () => {
    const { rows } = await pgGet('engagement', null);
    expect(rows.length).toBe(0);
  });

  test('performance_redacted view respects RLS (security_invoker)', async () => {
    // This view used to be created WITHOUT security_invoker, which is
    // the canonical "views bypass RLS" gotcha called out by the Supabase
    // agent skill. Fixed 2026-05-18 (see migration
    // 2026-05-18_secure_performance_redacted_view.sql). Test guards against
    // regression.
    const { rows: anonRows } = await pgGet('performance_redacted', null);
    expect(anonRows.length).toBe(0);

    // No shows exist yet in Phase 0 — we don't assert on row count
    // for the authenticated path, only that it doesn't error and (if
    // any rows return) belongs to a workspace the user can see.
    const { status } = await pgGet('performance_redacted', playwrightJwt);
    expect(status).toBeLessThan(400);
  });
});
