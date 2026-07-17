/**
 * RLS regression — custom_access_token_hook correctness.
 *
 * The hook lives in Supabase Auth and runs at sign-in / refresh. It picks
 * the user's first accepted workspace_membership and writes its
 * `workspace_id` into the JWT as `current_workspace_id`. Without that
 * claim, the SQL helper `current_workspace_id()` returns NULL and a few
 * write paths that use it (conversation insert, expense insert, section
 * insert) deny.
 *
 * This test asserts:
 *   1. The hook ran (claim is present + UUID-shaped).
 *   2. The injected workspace matches a real workspace the user belongs to.
 */

import { beforeAll, describe, expect, test } from 'vitest';
import { decodeJwt, envReady, login, pgGet, requireEnv } from './_helpers';

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

describe.skipIf(!envReady())('RLS — auth hook claim correctness', () => {
  let jwt: string;
  let claims: Record<string, unknown>;

  beforeAll(async () => {
    const { email, password } = requireEnv();
    jwt = await login(email, password);
    claims = decodeJwt(jwt);
  });

  test('JWT carries current_workspace_id claim shaped like a UUID', () => {
    const cwid = claims.current_workspace_id;
    expect(typeof cwid).toBe('string');
    expect(cwid).toMatch(UUID_REGEX);
  });

  test('current_workspace_id points to a workspace the user can see', async () => {
    const cwid = String(claims.current_workspace_id);
    const { rows } = await pgGet<{ id: string }>(
      'workspace',
      jwt,
      new URLSearchParams({ select: 'id', id: `eq.${cwid}` }),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe(cwid);
  });

  test('JWT role is `authenticated`', () => {
    // Belt-and-suspenders: if the hook ever degraded to anon-style claims,
    // RLS would silently widen the surface for this user. Cheap check.
    expect(claims.role).toBe('authenticated');
  });
});
