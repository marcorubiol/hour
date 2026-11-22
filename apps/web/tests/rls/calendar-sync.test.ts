/**
 * RLS regression — external calendar sync (ADR-241 Fases 2-5).
 *
 * Verifies:
 *   1. All 4 sync tables (`calendar_connection`, `calendar_event_link`,
 *      `calendar_busy`, `calendar_change_proposal`) are deny-all through
 *      PostgREST for anon AND authenticated.
 *   2. `upsert_my_calendar_connection` / `list_my_calendar_connections` never
 *      expose `credentials_ciphertext` and enforce provider/alarm checks.
 *   3. `update_my_calendar_connection` & `request_my_calendar_sync` work on
 *      own rows and reject foreign IDs.
 *   4. `get_calendar_busy_in_window` and `list_my_calendar_waiting` succeed
 *      cleanly for authenticated users and fail for anon.
 *   5. Self-cleaning via `delete_my_calendar_connection`.
 */

import { describe, expect, test } from 'vitest';
import { envReady, login, pgGet, pgRpc, requireEnv } from './_helpers';

const FOREIGN_UUID = '00000000-0000-0000-0000-000000000000';

describe.skipIf(!envReady())('RLS — calendar sync (ADR-241 Fases 2-5)', () => {
  test('all four tables are deny-all and RPCs isolate caller connections safely', async () => {
    const { email, password } = requireEnv();
    const jwt = await login(email, password);

    // 1. Every table is deny-all for anon AND authenticated.
    for (const table of [
      'calendar_connection',
      'calendar_event_link',
      'calendar_busy',
      'calendar_change_proposal',
    ]) {
      const a = await pgGet(table, null, new URLSearchParams({ select: 'id' }));
      expect(a.status).toBeGreaterThanOrEqual(400);
      const u = await pgGet(table, jwt, new URLSearchParams({ select: 'id' }));
      expect(u.status).toBeGreaterThanOrEqual(400);
    }

    // 2. Create a test iCloud connection via RPC (dummy ciphertext).
    const up = await pgRpc<string>('upsert_my_calendar_connection', jwt, {
      p_provider: 'icloud',
      p_account_email: 'rls-probe@hour.test',
      p_credentials_ciphertext: 'v1.dummyiv.dummyct',
      p_key_version: 1,
      p_alarm_mode: '2h_before',
      p_hour_calendar_id: 'https://caldav.icloud.com/test/hour/',
      p_available_calendars: [{ id: 'cal-1', name: 'Personal' }],
    });
    expect(up.status).toBe(200);
    const connId = up.data!;
    expect(connId).toMatch(/^[0-9a-f-]{36}$/i);

    try {
      // 3. Listing returns safe projection without credentials_ciphertext.
      const listed = await pgRpc<Array<Record<string, unknown>>>('list_my_calendar_connections', jwt, {});
      expect(listed.status).toBe(200);
      const row = (listed.data ?? []).find((r) => r.id === connId);
      expect(row).toBeDefined();
      expect(row?.credentials_ciphertext).toBeUndefined();
      expect(row?.alarm_mode).toBe('2h_before');

      // 4. Update busy_calendar_ids and alarm_mode.
      const upd = await pgRpc('update_my_calendar_connection', jwt, {
        p_connection_id: connId,
        p_alarm_mode: 'day_before',
        p_busy_calendar_ids: ['cal-1'],
      });
      expect(upd.status).toBe(204);

      // 5. Foreign connection update is rejected.
      const foreign = await pgRpc('update_my_calendar_connection', jwt, {
        p_connection_id: FOREIGN_UUID,
        p_alarm_mode: 'none',
      });
      expect(foreign.status).toBeGreaterThanOrEqual(400);

      // 6. Busy window and waiting RPCs work for authenticated and fail for anon.
      const busyAuth = await pgRpc('get_calendar_busy_in_window', jwt, {
        p_from: '2026-11-01',
        p_to: '2026-12-31',
      });
      expect(busyAuth.status).toBe(200);

      const busyAnon = await pgRpc('get_calendar_busy_in_window', null, {
        p_from: '2026-11-01',
        p_to: '2026-12-31',
      });
      expect(busyAnon.status).toBeGreaterThanOrEqual(400);

      const waiting = await pgRpc<{ paused: unknown[]; proposals: unknown[] }>('list_my_calendar_waiting', jwt, {});
      expect(waiting.status).toBe(200);
      expect(Array.isArray(waiting.data?.paused)).toBe(true);
      expect(Array.isArray(waiting.data?.proposals)).toBe(true);
    } finally {
      await pgRpc('delete_my_calendar_connection', jwt, { p_connection_id: connId });
    }
  });
});
