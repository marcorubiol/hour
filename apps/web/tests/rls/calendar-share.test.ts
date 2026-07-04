/**
 * RLS regression — public calendar feed shares (ADR-054).
 *
 * Same capability-token contract as the road sheet share (ADR-047):
 *   1. `calendar_share` is deny-all through PostgREST for EVERY role —
 *      tokens are never readable by table access. Management is RPC-only,
 *      gated on accepted workspace membership.
 *   2. `get_public_calendar` as anon returns the feed for a live token,
 *      with NO fee and NO notes anywhere in it.
 *   3. Revocation kills the token on the next request.
 *
 * Full lifecycle against production, self-cleaning: the share created
 * here is revoked at the end (revocation IS the assertion).
 */

import { describe, expect, test } from 'vitest';
import { envReady, login, pgGet, pgRpc, requireEnv } from './_helpers';

type Share = { id: string; token: string; workspace_id: string };

const RANDOM_UUID = '00000000-0000-0000-0000-000000000000';

describe.skipIf(!envReady())('RLS — calendar_share (ADR-054)', () => {
  test('feed lifecycle: deny-all table, sanitized anon feed, revoke kills token', async () => {
    const { email, password } = requireEnv();
    const jwt = await login(email, password);

    // The test user's own `playwright` workspace.
    const ws = await pgGet<{ id: string }>(
      'workspace',
      jwt,
      new URLSearchParams({ select: 'id', slug: 'eq.playwright', limit: '1' }),
    );
    expect(ws.rows).toHaveLength(1);
    const workspaceId = ws.rows[0].id;

    const created = await pgRpc<Share>('create_calendar_share', jwt, {
      p_workspace_id: workspaceId,
    });
    expect(created.status).toBe(200);
    expect(created.data?.token).toMatch(/^[0-9a-f]{64}$/);
    const share = created.data!;

    try {
      // 1. Table is deny-all through PostgREST — anon AND authenticated.
      for (const who of [null, jwt]) {
        const direct = await pgGet('calendar_share', who, new URLSearchParams({
          select: 'token',
          limit: '1',
        }));
        expect(direct.status).toBeGreaterThanOrEqual(400);
        expect(direct.rows).toHaveLength(0);
      }

      // 2. Anon resolves the token to a sanitized feed.
      const pub = await pgRpc<Record<string, unknown>>('get_public_calendar', null, {
        p_token: share.token,
      });
      expect(pub.status).toBe(200);
      expect(pub.data).not.toBeNull();
      expect(pub.data).toHaveProperty('performances');
      expect(pub.data).toHaveProperty('dates');
      const raw = JSON.stringify(pub.data);
      expect(raw).not.toContain('fee_amount');
      expect(raw).not.toContain('fee_currency');
      expect(raw).not.toContain('"notes"');
      // No person data of any kind rides the feed.
      expect(raw).not.toContain('email');
      expect(raw).not.toContain('phone');

      // Bogus token → null, not an error (no oracle).
      const bogus = await pgRpc('get_public_calendar', null, { p_token: 'deadbeef' });
      expect(bogus.status).toBe(200);
      expect(bogus.data).toBeNull();
    } finally {
      // 3. Revoke (self-cleaning) — token dies on the next request.
      const revoked = await pgRpc('revoke_calendar_share', jwt, { p_share_id: share.id });
      expect(revoked.status).toBeLessThan(300);
      const dead = await pgRpc('get_public_calendar', null, { p_token: share.token });
      expect(dead.data).toBeNull();
    }
  });

  test('anon cannot create, list or revoke feed shares', async () => {
    const create = await pgRpc('create_calendar_share', null, {
      p_workspace_id: RANDOM_UUID,
    });
    expect(create.status).toBeGreaterThanOrEqual(400);

    const list = await pgRpc('list_calendar_shares', null, {
      p_workspace_id: RANDOM_UUID,
    });
    expect(list.status).toBeGreaterThanOrEqual(400);

    const revoke = await pgRpc('revoke_calendar_share', null, {
      p_share_id: RANDOM_UUID,
    });
    expect(revoke.status).toBeGreaterThanOrEqual(400);
  });

  test('authenticated non-member cannot create a feed for a foreign workspace', async () => {
    const { email, password } = requireEnv();
    const jwt = await login(email, password);
    // RANDOM_UUID is not a workspace the caller belongs to → 42501 → 403.
    const create = await pgRpc('create_calendar_share', jwt, {
      p_workspace_id: RANDOM_UUID,
    });
    expect(create.status).toBe(403);
  });
});
