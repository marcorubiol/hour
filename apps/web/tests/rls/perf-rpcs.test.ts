import { beforeAll, describe, expect, test } from 'vitest';
import { envReady, limitedEnvReady, login, pgGet, pgRpc, requireEnv, requireLimitedEnv } from './_helpers';

/**
 * Migration 20261120230000_perf_rpcs_and_rls:
 *   - `money_access_any()` agrees with per-project `has_permission(p, 'read:money')`;
 *   - `list_roadsheet_share_counts(uuid[])` agrees with per-performance `list_roadsheet_shares`;
 *   - `accessible_project_ids(text)` scoped to `caller_member_workspaces()` agrees with `has_permission`.
 */
describe.skipIf(!envReady() || !limitedEnvReady())('perf RPCs and RLS parity (20261120230000)', () => {
  let adminJwt: string;
  let limitedJwt: string;

  beforeAll(async () => {
    const admin = requireEnv();
    const limited = requireLimitedEnv();
    adminJwt = await login(admin.email, admin.password);
    limitedJwt = await login(limited.email, limited.password);
  });

  test('money_access_any() matches has_permission(read:money) across all visible projects', async () => {
    for (const jwt of [adminJwt, limitedJwt]) {
      const projects = await pgGet<{ id: string }>(
        'project',
        jwt,
        new URLSearchParams({ select: 'id', deleted_at: 'is.null', limit: '500' }),
      );
      const perms = await Promise.all(
        projects.rows.map((p) => pgRpc<boolean>('has_permission', jwt, { p_project_id: p.id, p_perm: 'read:money' })),
      );
      const expected = perms.some((r) => r.data === true);
      const got = await pgRpc<boolean>('money_access_any', jwt, {});
      expect(got.status).toBe(200);
      expect(got.data).toBe(expected);
    }
  });

  test('accessible_project_ids(read:conversation) matches per-project has_permission', async () => {
    for (const jwt of [adminJwt, limitedJwt]) {
      const projects = await pgGet<{ id: string }>(
        'project',
        jwt,
        new URLSearchParams({ select: 'id', deleted_at: 'is.null', limit: '500' }),
      );
      const expected: string[] = [];
      for (const p of projects.rows) {
        const res = await pgRpc<boolean>('has_permission', jwt, { p_project_id: p.id, p_perm: 'read:conversation' });
        if (res.data === true) expected.push(p.id);
      }
      const got = await pgRpc<string[]>('accessible_project_ids', jwt, { p_perm: 'read:conversation' });
      expect(got.status).toBe(200);
      expect([...(got.data ?? [])].sort()).toEqual(expected.sort());
    }
  });

  test('list_roadsheet_share_counts returns only caller-editable performances and matches active shares', async () => {
    const perfs = await pgGet<{ id: string }>(
      'performance',
      adminJwt,
      new URLSearchParams({ select: 'id', deleted_at: 'is.null', limit: '5' }),
    );
    const ids = perfs.rows.map((p) => p.id);
    if (ids.length === 0) return;

    const got = await pgRpc<{ performance_id: string; live_count: number }[]>(
      'list_roadsheet_share_counts',
      adminJwt,
      { p_performance_ids: ids },
    );
    expect(got.status).toBe(200);
    const byId = new Map((got.data ?? []).map((r) => [r.performance_id, r.live_count]));
    const now = Date.now();
    for (const id of ids) {
      const shares = await pgRpc<{ expires_at: string | null }[]>('list_roadsheet_shares', adminJwt, {
        p_performance_id: id,
      });
      if (shares.status === 200) {
        const expected = (shares.data ?? []).filter((s) => !s.expires_at || Date.parse(s.expires_at) > now).length;
        expect(byId.get(id)).toBe(expected);
      } else {
        expect(byId.has(id)).toBe(false);
      }
    }
  });
});
