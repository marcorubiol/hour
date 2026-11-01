/**
 * Editar la organización y la conversación del bolo, del mismo proyecto
 * (`20261101100000_organization_edit_bolo_conversation_project`, § 64).
 *
 * `update_workspace_organization`: dueño, admin o miembro del espacio que la
 * lee; un guest o alguien de fuera reciben 42501 (403) y no se mueve nada. Un
 * nombre que ya tiene otra organización viva del espacio, 23505 (409).
 *
 * `create_bolo` con `p_conversation_id`: la conversación es del proyecto del
 * bolo; una de otro proyecto del mismo espacio, 42501. Va ROJO contra una base
 * sin la migración (antes sólo se miraba el espacio).
 *
 * En `playwright` (`zzz-e2e-collab` y `zzz-rls-foreign-project`). Lo que crea
 * lo borra; la fixture limitada vuelve a su rol en `finally`.
 */

import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import {
  decodeJwt,
  envReady,
  externalEnvReady,
  limitedEnvReady,
  login,
  pgGet,
  pgRpc,
  requireEnv,
  requireExternalEnv,
  requireLimitedEnv,
} from './_helpers';

type Conversation = { id: string; organization_id: string; project_id: string };
type Org = { id: string; name: string; kind: string; city: string | null; email: string | null; slug: string };

const RUN = `${Date.now().toString(36)}${Math.random().toString(16).slice(2, 6)}`;

describe.skipIf(!envReady())('RLS — update_workspace_organization / create_bolo same project (§ 64)', () => {
  let jwt: string;
  let homeProjectId: string;
  let foreignProjectId: string;
  let workspaceId: string;
  let homeConv: Conversation;
  let foreignConv: Conversation;
  const boloIds: string[] = [];

  beforeAll(async () => {
    const env = requireEnv();
    jwt = await login(env.email, env.password);
    const projects = await pgGet<{ id: string; slug: string; workspace_id: string }>(
      'project',
      jwt,
      new URLSearchParams({
        select: 'id,slug,workspace_id,workspace:workspace_id!inner(slug)',
        'workspace.slug': 'eq.playwright',
        slug: 'in.(zzz-e2e-collab,zzz-rls-foreign-project)',
        deleted_at: 'is.null',
      }),
    );
    const home = projects.rows.find((p) => p.slug === 'zzz-e2e-collab');
    const foreign = projects.rows.find((p) => p.slug === 'zzz-rls-foreign-project');
    if (!home || !foreign) throw new Error('zzz-e2e-collab or zzz-rls-foreign-project missing in playwright');
    homeProjectId = home.id;
    foreignProjectId = foreign.id;
    workspaceId = home.workspace_id;

    for (const [projectId, tag] of [
      [homeProjectId, 'home'],
      [foreignProjectId, 'foreign'],
    ] as const) {
      const conv = await pgRpc<Conversation>('create_conversation', jwt, {
        p_project_id: projectId,
        p_organization_name: `Zzz Org Edit ${tag} ${RUN}`,
      });
      expect(conv.status, conv.error).toBe(200);
      if (tag === 'home') homeConv = conv.data!;
      else foreignConv = conv.data!;
    }
  });

  afterAll(async () => {
    for (const id of boloIds) await pgRpc('delete_bolo', jwt, { p_bolo_id: id });
    for (const c of [homeConv, foreignConv]) {
      if (!c) continue;
      await pgRpc('delete_conversation', jwt, { p_conversation_id: c.id });
      await pgRpc('delete_workspace_organization', jwt, { p_organization_id: c.organization_id });
    }
  });

  const readOrg = async (id: string) =>
    (
      await pgGet<Org>(
        'workspace_organization',
        jwt,
        new URLSearchParams({ select: 'id,name,kind,city,email,slug', id: `eq.${id}` }),
      )
    ).rows[0];

  test('an admin edits name, kind, city and email; the slug stays; empty clears', async () => {
    const id = homeConv.organization_id;
    const before = await readOrg(id);
    const name = `Zzz Org Edit renamed ${RUN}`;
    const res = await pgRpc<Org>('update_workspace_organization', jwt, {
      p_organization_id: id,
      p_name: `  ${name} `,
      p_kind: 'theatre',
      p_city: 'Girona',
      p_email: `prog-${RUN}@example.test`,
    });
    expect(res.status, res.error).toBe(200);
    expect(res.data).toMatchObject({ id, name, kind: 'theatre', city: 'Girona', email: `prog-${RUN}@example.test` });
    expect(await readOrg(id)).toMatchObject({ name, kind: 'theatre', city: 'Girona', slug: before!.slug });

    const cleared = await pgRpc<Org>('update_workspace_organization', jwt, {
      p_organization_id: id,
      p_name: name,
      p_kind: '',
      p_city: '',
      p_email: null,
    });
    expect(cleared.status, cleared.error).toBe(200);
    expect(await readOrg(id)).toMatchObject({ name, kind: 'other', city: null, email: null });
  });

  test('bad input is 22023; a name another organization holds is 23505', async () => {
    const id = homeConv.organization_id;
    for (const args of [
      { p_name: '   ' },
      { p_name: 'X', p_kind: 'venue' },
      { p_name: 'X', p_email: 'not-an-email' },
    ]) {
      const res = await pgRpc('update_workspace_organization', jwt, { p_organization_id: id, ...args });
      expect(res.status, JSON.stringify(args)).toBe(400);
      expect(res.error).toContain('22023');
    }
    const other = await readOrg(foreignConv.organization_id);
    const taken = await pgRpc('update_workspace_organization', jwt, {
      p_organization_id: id,
      p_name: other!.name.toUpperCase(),
    });
    expect(taken.status).toBe(409);
    expect(taken.error).toContain('23505');
  });

  test('a deleted or unknown organization is 42501', async () => {
    const res = await pgRpc('update_workspace_organization', jwt, {
      p_organization_id: '00000000-0000-0000-0000-000000000000',
      p_name: 'X',
    });
    expect(res.status).toBe(403);
    expect(res.error).toContain('42501');
    expect((await pgRpc('update_workspace_organization', null, { p_organization_id: homeConv.organization_id, p_name: 'X' })).status).not.toBe(200);
  });

  describe.skipIf(!limitedEnvReady())('as a guest of the workspace', () => {
    test('42501 and the name does not move', async () => {
      const limited = requireLimitedEnv();
      const limitedJwt = await login(limited.email, limited.password);
      const limitedUserId = String(decodeJwt(limitedJwt).sub);
      const memberships = await pgGet<{ id: string; workspace_role: string }>(
        'membership',
        jwt,
        new URLSearchParams({
          level: 'eq.workspace',
          workspace_id: `eq.${workspaceId}`,
          user_id: `eq.${limitedUserId}`,
          select: 'id,workspace_role',
        }),
      );
      expect(memberships.rows).toHaveLength(1);
      const m = memberships.rows[0]!;
      expect(m.workspace_role, 'a previous run left the fixture as guest').not.toBe('guest');

      const id = homeConv.organization_id;
      const before = await readOrg(id);
      const changed = await pgRpc('update_workspace_member_role', jwt, { p_membership_id: m.id, p_role: 'guest' });
      expect(changed.status, changed.error).toBe(204);
      try {
        const res = await pgRpc('update_workspace_organization', limitedJwt, {
          p_organization_id: id,
          p_name: `${before!.name} pwned`,
        });
        expect(res.status).toBe(403);
        expect(res.error).toContain('42501');
      } finally {
        await pgRpc('update_workspace_member_role', jwt, { p_membership_id: m.id, p_role: m.workspace_role });
      }
      expect((await readOrg(id))!.name).toBe(before!.name);
    });
  });

  test.skipIf(!externalEnvReady())('someone outside the workspace gets 42501 and nothing moves', async () => {
    const external = requireExternalEnv();
    const ext = await login(external.email, external.password);
    const id = homeConv.organization_id;
    const before = await readOrg(id);
    const res = await pgRpc('update_workspace_organization', ext, {
      p_organization_id: id,
      p_name: `${before!.name} pwned`,
    });
    expect(res.status).toBe(403);
    expect(res.error).toContain('42501');
    expect((await readOrg(id))!.name).toBe(before!.name);
  });

  test('create_bolo refuses a conversation of another project of the same workspace', async () => {
    const res = await pgRpc<{ id: string }>('create_bolo', jwt, {
      p_project_id: homeProjectId,
      p_status: 'proposed',
      p_venue_name: `RLS org edit cross ${RUN}`,
      p_conversation_id: foreignConv.id,
    });
    if (res.status === 200 && res.data) boloIds.push(res.data.id);
    expect(res.status, 'a bolo of A must not hang from a conversation of B').toBe(403);
    expect(res.error).toContain('42501');
  });

  test('create_bolo accepts a conversation of its own project', async () => {
    const res = await pgRpc<{ id: string; conversation_id: string | null; project_id: string }>('create_bolo', jwt, {
      p_project_id: homeProjectId,
      p_status: 'proposed',
      p_venue_name: `RLS org edit same ${RUN}`,
      p_conversation_id: homeConv.id,
    });
    expect(res.status, res.error).toBe(200);
    boloIds.push(res.data!.id);
    expect(res.data).toMatchObject({ project_id: homeProjectId, conversation_id: homeConv.id });
  });
});
