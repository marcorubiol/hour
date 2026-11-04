/**
 * RLS — tarea 78: `workspace.season_start_month`, the month the space's
 * season starts (September by default). A new write path: a direct PATCH
 * (`PUT /api/workspaces/[id]/season`), gated by the `workspace_update` policy
 * (owner/admin) and the column grant on UPDATE. Also that the two readers
 * that count the season from it still answer (`conversation_feed` with
 * `p_season`, through `private.workspace_season_start`).
 *
 * Fixture: the test user's OWN `playwright` workspace, never muk-cia (real
 * data). The month is restored to September in `finally`.
 */

import { beforeAll, describe, expect, test } from 'vitest';
import { envReady, limitedEnvReady, login, pgGet, pgPatch, pgRpc, requireEnv, requireLimitedEnv } from './_helpers';

const NOT_A_MEMBER_UUID = '00000000-0000-4000-8000-000000000000';

describe.skipIf(!envReady())('RLS — workspace.season_start_month (tarea 78)', () => {
  let jwt: string;
  let limitedJwt: string;
  let wsId: string;

  const read = async () => {
    const res = await pgGet<{ season_start_month: number }>(
      'workspace',
      jwt,
      new URLSearchParams({ id: `eq.${wsId}`, select: 'season_start_month' }),
    );
    expect(res.status).toBe(200);
    return res.rows[0].season_start_month;
  };
  const patch = (token: string | null, month: unknown, id = wsId) =>
    pgPatch<{ season_start_month: number }>(
      'workspace',
      token,
      { season_start_month: month },
      new URLSearchParams({ id: `eq.${id}`, select: 'season_start_month' }),
    );

  beforeAll(async () => {
    const { email, password } = requireEnv();
    jwt = await login(email, password);
    const res = await pgGet<{ id: string; season_start_month: number }>(
      'workspace',
      jwt,
      new URLSearchParams({ slug: 'eq.playwright', select: 'id,season_start_month' }),
    );
    expect(res.status).toBe(200);
    expect(res.rows).toHaveLength(1);
    wsId = res.rows[0].id;
    // September is the baseline, not «as found»: a killed run must not leave January behind.
    if (res.rows[0].season_start_month !== 9) await patch(jwt, 9);
    if (limitedEnvReady()) {
      const limited = requireLimitedEnv();
      limitedJwt = await login(limited.email, limited.password);
    }
  });

  test('a new space starts in September', async () => {
    expect(await read()).toBe(9);
  });

  test('owner/admin moves it, and the feed counts the season with it', async () => {
    try {
      const res = await patch(jwt, 1);
      expect(res.status).toBeLessThan(300);
      expect(res.rows).toEqual([{ season_start_month: 1 }]);
      expect(await read()).toBe(1);

      const feed = await pgRpc<{ items: unknown[]; total: number }>('conversation_feed', jwt, {
        p_workspace_ids: [wsId],
        p_list: true,
        p_season: true,
      });
      expect(feed.status).toBe(200);
    } finally {
      await patch(jwt, 9);
    }
    expect(await read()).toBe(9);
  });

  test('a month out of 1..12 is refused by the CHECK', async () => {
    for (const bad of [0, 13]) {
      const res = await patch(jwt, bad);
      expect(res.status).toBeGreaterThanOrEqual(400); // 23514
    }
    expect(await read()).toBe(9);
  });

  test('a stranger space is filtered out: nothing touched, nothing leaked', async () => {
    const res = await patch(jwt, 1, NOT_A_MEMBER_UUID);
    expect(res.rows).toHaveLength(0);
  });

  test('anon writes nothing', async () => {
    const res = await patch(null, 1);
    // anon has no UPDATE grant: refused outright, or at most zero rows.
    expect(res.status >= 400 || (Array.isArray(res.rows) && res.rows.length === 0)).toBe(true);
    expect(await read()).toBe(9);
  });

  test.runIf(limitedEnvReady())('a plain member reads the month but cannot change it', async () => {
    const visible = await pgGet<{ season_start_month: number }>(
      'workspace',
      limitedJwt,
      new URLSearchParams({ id: `eq.${wsId}`, select: 'season_start_month' }),
    );
    expect(visible.rows).toEqual([{ season_start_month: 9 }]);
    const direct = await patch(limitedJwt, 1);
    expect(direct.rows).toHaveLength(0);
    expect(await read()).toBe(9);
  });
});
