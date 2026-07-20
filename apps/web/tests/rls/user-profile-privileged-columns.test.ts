/**
 * RLS/GRANT regression — a user owns their profile row, not its privileged
 * control columns. RLS chooses the row; column grants restrict the fields.
 *
 * The writes below are deliberately idempotent (each value is written back to
 * itself), so a pre-fix failure cannot alter the fixture. The privileged
 * attempts must still be rejected before Postgres executes the UPDATE.
 */

import { beforeAll, describe, expect, test } from 'vitest';
import { decodeJwt, envReady, login, pgGet, pgPatch, requireEnv } from './_helpers';

type ProfileRow = {
  user_id: string;
  full_name: string;
  is_platform_admin: boolean;
  person_id: string | null;
};

describe.skipIf(!envReady())('RLS — user_profile privileged columns', () => {
  let jwt: string;
  let profile: ProfileRow;

  beforeAll(async () => {
    const { email, password } = requireEnv();
    jwt = await login(email, password);
    const userId = String(decodeJwt(jwt).sub);
    const result = await pgGet<ProfileRow>(
      'user_profile',
      jwt,
      new URLSearchParams({
        user_id: `eq.${userId}`,
        select: 'user_id,full_name,is_platform_admin,person_id',
      }),
    );
    expect(result.status).toBe(200);
    expect(result.rows).toHaveLength(1);
    profile = result.rows[0];
  });

  test('ordinary self profile fields remain writable', async () => {
    const result = await pgPatch<ProfileRow>(
      'user_profile',
      jwt,
      { full_name: profile.full_name },
      new URLSearchParams({ user_id: `eq.${profile.user_id}`, select: 'user_id,full_name' }),
    );
    expect(result.status).toBeLessThan(300);
    expect(result.rows).toHaveLength(1);
  });

  test('a user cannot grant themselves platform admin', async () => {
    const result = await pgPatch(
      'user_profile',
      jwt,
      { is_platform_admin: profile.is_platform_admin },
      new URLSearchParams({ user_id: `eq.${profile.user_id}` }),
    );
    expect(result.status).toBeGreaterThanOrEqual(400);
  });

  test('a user cannot claim a person row directly', async () => {
    const result = await pgPatch(
      'user_profile',
      jwt,
      { person_id: profile.person_id },
      new URLSearchParams({ user_id: `eq.${profile.user_id}` }),
    );
    expect(result.status).toBeGreaterThanOrEqual(400);
  });
});
