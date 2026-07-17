/**
 * RLS regression — public road sheet shares (ADR-047).
 *
 * The security contract, in order of blast radius:
 *   1. `roadsheet_share` is deny-all through PostgREST for EVERY role —
 *      tokens must never be readable by table access (not even
 *      authenticated members: management is RPC-only, gated edit:performance).
 *   2. `get_public_roadsheet` as anon returns the bundle for a live
 *      token, with NO fee and NO performance notes anywhere in it.
 *   3. Revocation kills the token on the next request.
 *
 * Full lifecycle against production, self-cleaning: the share created
 * here is revoked at the end (and revocation IS the assertion).
 */

import { describe, expect, test } from 'vitest';
import { envReady, login, pgGet, pgRpc, requireEnv } from './_helpers';

type Share = { id: string; token: string; role: string };

describe.skipIf(!envReady())('RLS — roadsheet_share (ADR-047)', () => {
  test('share lifecycle: deny-all table, sanitized anon bundle, revoke kills token', async () => {
    const { email, password } = requireEnv();
    const jwt = await login(email, password);

    // Resolve a fixture gig in the test user's own workspace.
    const perf = await pgGet<{ id: string }>(
      'performance',
      jwt,
      new URLSearchParams({ select: 'id', slug: 'eq.zzz-e2e-1', limit: '1' }),
    );
    expect(perf.rows).toHaveLength(1);
    const performanceId = perf.rows[0].id;

    // Create a share via RPC.
    const created = await pgRpc<Share>('create_roadsheet_share', jwt, {
      p_performance_id: performanceId,
      p_role: 'venue',
    });
    expect(created.status).toBe(200);
    expect(created.data?.token).toMatch(/^[0-9a-f]{64}$/);
    const share = created.data!;

    // 1. Table is deny-all through PostgREST — anon AND authenticated.
    for (const who of [null, jwt]) {
      const direct = await pgGet('roadsheet_share', who, new URLSearchParams({
        select: 'token',
        limit: '1',
      }));
      expect(direct.status).toBeGreaterThanOrEqual(400);
      expect(direct.rows).toHaveLength(0);
    }

    // 2. Anon resolves the token to a sanitized bundle.
    const pub = await pgRpc<Record<string, unknown>>('get_public_roadsheet', null, {
      p_token: share.token,
    });
    expect(pub.status).toBe(200);
    expect(pub.data).not.toBeNull();
    expect(pub.data?.role).toBe('venue');
    const raw = JSON.stringify(pub.data);
    expect(raw).not.toContain('fee_amount');
    expect(raw).not.toContain('fee_currency');
    expect(pub.data?.performance).not.toHaveProperty('notes');

    // Bogus token → null, not an error (no oracle).
    const bogus = await pgRpc('get_public_roadsheet', null, { p_token: 'deadbeef' });
    expect(bogus.status).toBe(200);
    expect(bogus.data).toBeNull();

    // 3. Revoke (self-cleaning) — token dies on the next request.
    const revoked = await pgRpc('revoke_roadsheet_share', jwt, { p_share_id: share.id });
    expect(revoked.status).toBeLessThan(300);
    const dead = await pgRpc('get_public_roadsheet', null, { p_token: share.token });
    expect(dead.data).toBeNull();
  });

  test('anon cannot create or revoke shares', async () => {
    const create = await pgRpc('create_roadsheet_share', null, {
      p_performance_id: '00000000-0000-0000-0000-000000000000',
      p_role: 'venue',
    });
    expect(create.status).toBeGreaterThanOrEqual(400);

    const revoke = await pgRpc('revoke_roadsheet_share', null, {
      p_share_id: '00000000-0000-0000-0000-000000000000',
    });
    expect(revoke.status).toBeGreaterThanOrEqual(400);
  });
});
