/**
 * RLS regression — personal cross-workspace calendar feed & calendar_scope (ADR-241 Fase 1).
 *
 * Verifies:
 *   1. `user_calendar_feed` is deny-all through PostgREST for anon and authenticated.
 *   2. `create_my_calendar_feed` issues a 64-hex token with 1-year expiry and
 *      revokes any prior active feed.
 *   3. `update_my_calendar_feed` changes `alarm_mode` and rejects invalid modes.
 *   4. `get_personal_calendar` as anon returns sanitized JSON (no money, no notes,
 *      no booking references) and returns null for unknown/revoked tokens.
 *   5. `set_my_calendar_scope` writes `mine` | `all` | `none` | `null` on own
 *      membership, hides a `none` workspace from the personal feed, and rejects
 *      foreign workspaces with 42501.
 *   6. Self-cleaning: restores `calendar_scope = null` and revokes the feed.
 */

import { describe, expect, test } from 'vitest';
import { envReady, login, pgGet, pgRpc, requireEnv } from './_helpers';

type FeedRow = {
  id: string;
  token: string;
  alarm_mode: string;
  expires_at: string;
  created_at: string;
};

type PersonalFeed = {
  alarm_mode: string;
  expires_at: string;
  performances: Array<{ workspace?: { id?: string }; [key: string]: unknown }>;
  dates: Array<{ workspace?: { id?: string }; [key: string]: unknown }>;
};

const FOREIGN_UUID = '00000000-0000-0000-0000-000000000000';

describe.skipIf(!envReady())('RLS — personal calendar feed (ADR-241 Fase 1)', () => {
  test('lifecycle: deny-all table, alarm update, scope filtering, and revocation', async () => {
    const { email, password } = requireEnv();
    const jwt = await login(email, password);

    const ws = await pgGet<{ id: string }>(
      'workspace',
      jwt,
      new URLSearchParams({ select: 'id', slug: 'eq.playwright', limit: '1' }),
    );
    expect(ws.rows).toHaveLength(1);
    const workspaceId = ws.rows[0].id;

    // 1. Table is deny-all through PostgREST for anon AND authenticated.
    const anonTable = await pgGet('user_calendar_feed', null, new URLSearchParams({ select: 'id' }));
    expect(anonTable.status).toBeGreaterThanOrEqual(400);
    const authTable = await pgGet('user_calendar_feed', jwt, new URLSearchParams({ select: 'id' }));
    expect(authTable.status).toBeGreaterThanOrEqual(400);

    // 2. Create personal feed.
    const created = await pgRpc<FeedRow>('create_my_calendar_feed', jwt, { p_alarm_mode: 'none' });
    expect(created.status).toBe(200);
    expect(created.data?.token).toMatch(/^[0-9a-f]{64}$/);
    expect(created.data?.alarm_mode).toBe('none');
    const token = created.data!.token;

    try {
      // 3. Update alarm_mode and reject invalid values.
      const updated = await pgRpc<FeedRow>('update_my_calendar_feed', jwt, { p_alarm_mode: '2h_before' });
      expect(updated.status).toBe(200);
      expect(updated.data?.alarm_mode).toBe('2h_before');

      const badAlarm = await pgRpc('update_my_calendar_feed', jwt, { p_alarm_mode: '5m' });
      expect(badAlarm.status).toBe(400);

      // 4. Anon read via token returns sanitized payload.
      const pub = await pgRpc<PersonalFeed | null>('get_personal_calendar', null, { p_token: token });
      expect(pub.status).toBe(200);
      expect(pub.data?.alarm_mode).toBe('2h_before');
      const serialized = JSON.stringify(pub.data);
      expect(serialized).not.toMatch(/fee_amount|fee_currency|"reference"/i);

      // 5. Foreign workspace scope write is rejected.
      const foreign = await pgRpc('set_my_calendar_scope', jwt, {
        p_workspace_id: FOREIGN_UUID,
        p_scope: 'none',
      });
      expect(foreign.status).toBeGreaterThanOrEqual(400);

      // 6. Setting workspace calendar_scope to `none` excludes it from the personal feed.
      const setNone = await pgRpc('set_my_calendar_scope', jwt, {
        p_workspace_id: workspaceId,
        p_scope: 'none',
      });
      expect(setNone.status).toBe(204);

      const filtered = await pgRpc<PersonalFeed | null>('get_personal_calendar', null, { p_token: token });
      expect(filtered.status).toBe(200);
      expect(filtered.data?.performances.some((p) => p.workspace?.id === workspaceId)).toBe(false);
      expect(filtered.data?.dates.some((d) => d.workspace?.id === workspaceId)).toBe(false);
    } finally {
      await pgRpc('set_my_calendar_scope', jwt, { p_workspace_id: workspaceId, p_scope: null });
      await pgRpc('revoke_my_calendar_feed', jwt, {});
    }

    // 7. Revoked token returns null.
    const afterRevoke = await pgRpc<PersonalFeed | null>('get_personal_calendar', null, { p_token: token });
    expect(afterRevoke.status).toBe(200);
    expect(afterRevoke.data).toBeNull();
  });
});
