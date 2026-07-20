/**
 * RLS regression — ADR-062 `update_workspace`: the space-identity edit path.
 *
 * Why this exists: the RPC has gated production since 2026-07-14 with no
 * coverage at all. It is an authorization boundary (owner/admin only) on the
 * one table that defines every tenant, and `workspace.UPDATE` is denied by
 * RLS precisely so that this SECURITY DEFINER wrapper is the only door — a
 * regression here would either lock owners out of their own space or let a
 * plain member rewrite it.
 *
 * Fixture: the test user's OWN `playwright` workspace, never muk-cia (real
 * data). Every mutation snapshots the row first and restores it in `finally`
 * — the workspace is permanent, so a skipped restore poisons later runs.
 *
 * The second fixture user is a plain workspace member with the `performer`
 * role in this project. It proves both halves of the boundary: membership
 * makes the tenant visible, but neither workspace administration nor unrelated
 * project permissions are implied by that membership.
 */

import { beforeAll, describe, expect, test } from 'vitest';
import {
  envReady,
  limitedEnvReady,
  login,
  pgGet,
  pgPatch,
  pgRpc,
  requireEnv,
  requireLimitedEnv,
} from './_helpers';

type WorkspaceRow = {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  accent: string | null;
  domain: string | null;
  city: string | null;
  logo_url: string | null;
};

/**
 * A workspace the caller is provably not owner/admin of. Doubles as the
 * "unknown id" case: the RPC checks membership BEFORE it looks the row up,
 * so a stranger's workspace and a nonexistent one are indistinguishable to
 * the caller — that non-leak is asserted below, not incidental.
 */
const NOT_A_MEMBER_UUID = '00000000-0000-4000-8000-000000000000';

describe.skipIf(!envReady())('RLS — update_workspace (ADR-062)', () => {
  let jwt: string;
  let limitedJwt: string;
  let fixture: WorkspaceRow;
  let projectId: string;

  beforeAll(async () => {
    const { email, password } = requireEnv();
    jwt = await login(email, password);

    const res = await pgGet<WorkspaceRow>(
      'workspace',
      jwt,
      new URLSearchParams({
        slug: 'eq.playwright',
        select: 'id,slug,name,description,accent,domain,city,logo_url',
      }),
    );
    expect(res.status).toBe(200);
    expect(res.rows).toHaveLength(1);
    fixture = res.rows[0];

    if (limitedEnvReady()) {
      const limited = requireLimitedEnv();
      limitedJwt = await login(limited.email, limited.password);

      const project = await pgGet<{ id: string }>(
        'project',
        jwt,
        new URLSearchParams({
          workspace_id: `eq.${fixture.id}`,
          slug: 'eq.zzz-e2e-collab',
          deleted_at: 'is.null',
          select: 'id',
        }),
      );
      expect(project.status).toBe(200);
      expect(project.rows).toHaveLength(1);
      projectId = project.rows[0].id;
    }
  });

  /** Put the fixture back exactly as found. */
  async function restore() {
    await pgRpc('update_workspace', jwt, {
      p_workspace_id: fixture.id,
      p_patch: {
        name: fixture.name,
        description: fixture.description ?? '',
        accent: fixture.accent ?? '',
        domain: fixture.domain ?? '',
        city: fixture.city ?? '',
      },
    });
  }

  async function read(): Promise<WorkspaceRow> {
    const res = await pgGet<WorkspaceRow>(
      'workspace',
      jwt,
      new URLSearchParams({
        id: `eq.${fixture.id}`,
        select: 'id,slug,name,description,accent,domain,city,logo_url',
      }),
    );
    return res.rows[0];
  }

  test('the direct table PATCH is gated by the same owner/admin rule', async () => {
    // The RPC is NOT the only door — `workspace_update` (rls-policies.sql)
    // allows UPDATE to owner/admin with the very same membership test, so an
    // admin's direct PostgREST PATCH lands. That is not an escalation: a
    // non-owner/admin is refused by the policy exactly as the RPC refuses
    // them. The concrete member case is asserted separately below.
    //
    // The migration's docblock claimed UPDATE "stays denied"; it doesn't.
    // Corrected there 2026-07-16 after this test caught it.
    const stranger = await pgPatch<WorkspaceRow>(
      'workspace',
      jwt,
      { name: 'ZZZ cross-tenant' },
      new URLSearchParams({ id: `eq.${NOT_A_MEMBER_UUID}` }),
    );
    // RLS filters the row out: 2xx, zero rows touched, nothing leaked.
    expect(stranger.rows).toHaveLength(0);

    // What the direct path skips vs the RPC: the "" → NULL patch semantics,
    // the non-empty-name check, and slug immutability. Reachable only by an
    // owner/admin, only from outside the app (the API never exposes it) —
    // same family as the line.notes item on the Shelf. Documented, not fixed.
  });

  test.runIf(limitedEnvReady())(
    'a plain member sees the workspace but cannot rewrite its identity',
    async () => {
      const visible = await pgGet<WorkspaceRow>(
        'workspace',
        limitedJwt,
        new URLSearchParams({ id: `eq.${fixture.id}`, select: 'id,slug,name' }),
      );
      expect(visible.status).toBe(200);
      expect(visible.rows).toHaveLength(1);

      const direct = await pgPatch<WorkspaceRow>(
        'workspace',
        limitedJwt,
        { name: 'ZZZ member cannot land' },
        new URLSearchParams({ id: `eq.${fixture.id}` }),
      );
      expect(direct.status).toBeLessThan(300);
      expect(direct.rows).toHaveLength(0);

      const rpc = await pgRpc('update_workspace', limitedJwt, {
        p_workspace_id: fixture.id,
        p_patch: { name: 'ZZZ member cannot land' },
      });
      expect(rpc.status).toBe(403);
      expect((await read()).name).toBe(fixture.name);
    },
  );

  test.runIf(limitedEnvReady())(
    'the performer role grants only its declared project capability',
    async () => {
      const internalNotes = await pgRpc<boolean>('has_permission', limitedJwt, {
        p_project_id: projectId,
        p_perm: 'read:internal_notes',
      });
      const money = await pgRpc<boolean>('has_permission', limitedJwt, {
        p_project_id: projectId,
        p_perm: 'read:money',
      });
      const membership = await pgRpc<boolean>('has_permission', limitedJwt, {
        p_project_id: projectId,
        p_perm: 'edit:membership',
      });

      expect(internalNotes).toMatchObject({ status: 200, data: true });
      expect(money).toMatchObject({ status: 200, data: false });
      expect(membership).toMatchObject({ status: 200, data: false });
    },
  );

  test('owner/admin can patch identity fields', async () => {
    try {
      const res = await pgRpc<WorkspaceRow[]>('update_workspace', jwt, {
        p_workspace_id: fixture.id,
        p_patch: { name: 'ZZZ RLS Fixture Name', city: 'Testville', domain: 'circus' },
      });
      expect(res.status).toBe(200);

      const row = await read();
      expect(row.name).toBe('ZZZ RLS Fixture Name');
      expect(row.city).toBe('Testville');
      expect(row.domain).toBe('circus');
    } finally {
      await restore();
    }
  });

  test('patch semantics: absent keys are left alone, "" clears', async () => {
    try {
      // Seed a city, then patch ONLY the name: the city must survive. This is
      // the property the edit dialog leans on for logo_url, which it never
      // sends (ADR-062) — an all-columns UPDATE would silently wipe it.
      await pgRpc('update_workspace', jwt, {
        p_workspace_id: fixture.id,
        p_patch: { city: 'Barcelona' },
      });
      await pgRpc('update_workspace', jwt, {
        p_workspace_id: fixture.id,
        p_patch: { name: 'ZZZ Only The Name' },
      });
      let row = await read();
      expect(row.name).toBe('ZZZ Only The Name');
      expect(row.city).toBe('Barcelona');

      // '' clears a nullable column (NULLIF in the RPC).
      await pgRpc('update_workspace', jwt, {
        p_workspace_id: fixture.id,
        p_patch: { city: '' },
      });
      row = await read();
      expect(row.city).toBeNull();
    } finally {
      await restore();
    }
  });

  test('slug is not editable here — rename has its own machinery', async () => {
    try {
      await pgRpc('update_workspace', jwt, {
        p_workspace_id: fixture.id,
        p_patch: { slug: 'zzz-hijacked', name: 'ZZZ Slug Probe' },
      });
      const row = await read();
      // The name lands (a key the RPC manages); the slug is simply not a key
      // it reads, so previous_slugs/redirects can't be bypassed through here.
      expect(row.name).toBe('ZZZ Slug Probe');
      expect(row.slug).toBe('playwright');
    } finally {
      await restore();
    }
  });

  test('a caller without owner/admin membership is refused, and learns nothing', async () => {
    const res = await pgRpc('update_workspace', jwt, {
      p_workspace_id: NOT_A_MEMBER_UUID,
      p_patch: { name: 'ZZZ cross-tenant' },
    });
    // 42501 → PostgREST 403. Same answer a real stranger's workspace gives:
    // membership is checked before existence, so this never distinguishes
    // "not yours" from "does not exist".
    expect(res.status).toBe(403);
  });

  test('anon cannot call it at all', async () => {
    const res = await pgRpc('update_workspace', null, {
      p_workspace_id: fixture.id,
      p_patch: { name: 'ZZZ anon' },
    });
    // EXECUTE is granted to `authenticated` only (REVOKEd from PUBLIC/anon).
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect((await read()).name).toBe(fixture.name);
  });

  test('an empty name is rejected', async () => {
    const res = await pgRpc('update_workspace', jwt, {
      p_workspace_id: fixture.id,
      p_patch: { name: '   ' },
    });
    expect(res.status).toBeGreaterThanOrEqual(400); // 22023
    expect((await read()).name).toBe(fixture.name);
  });

  test('an invalid domain is rejected by the enum', async () => {
    const res = await pgRpc('update_workspace', jwt, {
      p_workspace_id: fixture.id,
      p_patch: { domain: 'not-a-discipline' },
    });
    expect(res.status).toBeGreaterThanOrEqual(400); // 22P02
    expect((await read()).domain).toBe(fixture.domain);
  });
});
