/**
 * Borrado lógico de organización y persona del espacio
 * (`20261021200000_delete_organization_person`).
 *
 * `delete_workspace_organization` y `delete_workspace_person`: dueño, admin o
 * miembro del espacio; se niegan (23503 → 409) mientras algo vivo los usa, y
 * lo que no existe, ya está borrado o es de otro sale 42501 (403) sin decir
 * cuál. Todo en `playwright`, sobre `zzz-e2e-collab`, y lo que crea lo borra.
 */

import { beforeAll, describe, expect, test } from 'vitest';
import {
  envReady,
  externalEnvReady,
  login,
  pgGet,
  pgRpc,
  requireEnv,
  requireExternalEnv,
} from './_helpers';

type Conversation = { id: string; organization_id: string };
type Dossier = { workspace_id: string; person_id: string };

const tail = () => Math.random().toString(16).slice(2, 10);

describe.skipIf(!envReady())('RLS — delete_workspace_organization / delete_workspace_person', () => {
  let jwt: string;
  let projectId: string;
  let workspaceId: string;

  beforeAll(async () => {
    const env = requireEnv();
    jwt = await login(env.email, env.password);
    const p = await pgGet<{ id: string; workspace_id: string }>(
      'project',
      jwt,
      new URLSearchParams({
        select: 'id,workspace_id,workspace:workspace_id!inner(slug)',
        'workspace.slug': 'eq.playwright',
        slug: 'eq.zzz-e2e-collab',
        deleted_at: 'is.null',
        limit: '1',
      }),
    );
    if (p.rows.length === 0) throw new Error('zzz-e2e-collab missing in playwright');
    projectId = p.rows[0]!.id;
    workspaceId = p.rows[0]!.workspace_id;
  });

  const orgLive = async (id: string) =>
    (
      await pgGet<{ id: string }>(
        'workspace_organization',
        jwt,
        new URLSearchParams({ select: 'id', id: `eq.${id}` }),
      )
    ).rows.length > 0;

  const personLive = async (id: string) =>
    (
      await pgGet<{ person_id: string }>(
        'workspace_person',
        jwt,
        new URLSearchParams({ select: 'person_id', workspace_id: `eq.${workspaceId}`, person_id: `eq.${id}` }),
      )
    ).rows.length > 0;

  test('a dossier nobody uses goes; twice is a 42501', async () => {
    const made = await pgRpc<Dossier>('create_workspace_person', jwt, {
      p_workspace_id: workspaceId,
      p_full_name: `Zzz Delete ${tail()}`,
    });
    expect(made.status, made.error).toBe(200);
    const id = made.data!.person_id;

    const del = await pgRpc('delete_workspace_person', jwt, { p_workspace_id: workspaceId, p_person_id: id });
    expect(del.status, del.error).toBe(204);
    expect(await personLive(id)).toBe(false);

    const again = await pgRpc('delete_workspace_person', jwt, { p_workspace_id: workspaceId, p_person_id: id });
    expect(again.status).toBe(403);
    expect(again.error).toContain('42501');
  });

  test('a live conversation holds its organization and contact; once it goes, both can go', async () => {
    const name = `Zzz Delete Org ${tail()}`;
    const conv = await pgRpc<Conversation>('create_conversation', jwt, {
      p_project_id: projectId,
      p_organization_name: name,
      p_full_name: `${name} contacto`,
    });
    expect(conv.status, conv.error).toBe(200);
    const orgId = conv.data!.organization_id;
    const contact = await pgGet<{ person_id: string }>(
      'conversation_contact',
      jwt,
      new URLSearchParams({ select: 'person_id', conversation_id: `eq.${conv.data!.id}`, is_primary: 'is.true' }),
    );
    const personId = contact.rows[0]!.person_id;

    try {
      const orgHeld = await pgRpc('delete_workspace_organization', jwt, { p_organization_id: orgId });
      expect(orgHeld.status).toBe(409);
      expect(orgHeld.error).toContain('23503');
      const personHeld = await pgRpc('delete_workspace_person', jwt, {
        p_workspace_id: workspaceId,
        p_person_id: personId,
      });
      expect(personHeld.status).toBe(409);
      expect(personHeld.error).toContain('23503');
      expect(await orgLive(orgId)).toBe(true);
      expect(await personLive(personId)).toBe(true);
    } finally {
      const gone = await pgRpc('delete_conversation', jwt, { p_conversation_id: conv.data!.id });
      expect(gone.status, gone.error).toBe(204);
    }

    const person = await pgRpc('delete_workspace_person', jwt, { p_workspace_id: workspaceId, p_person_id: personId });
    expect(person.status, person.error).toBe(204);
    const org = await pgRpc('delete_workspace_organization', jwt, { p_organization_id: orgId });
    expect(org.status, org.error).toBe(204);
    expect(await orgLive(orgId)).toBe(false);
    expect(await personLive(personId)).toBe(false);
  });

  test('the caller’s own login is not a contact to delete', async () => {
    const me = await pgGet<{ person_id: string | null }>(
      'user_profile',
      jwt,
      new URLSearchParams({ select: 'person_id', person_id: 'not.is.null', limit: '1' }),
    );
    const personId = me.rows[0]?.person_id;
    if (!personId || !(await personLive(personId))) return;
    const res = await pgRpc('delete_workspace_person', jwt, { p_workspace_id: workspaceId, p_person_id: personId });
    expect(res.status).toBe(409);
    expect(await personLive(personId)).toBe(true);
  });

  test.skipIf(!externalEnvReady())('someone outside the workspace gets 42501 and nothing moves', async () => {
    const made = await pgRpc<Dossier>('create_workspace_person', jwt, {
      p_workspace_id: workspaceId,
      p_full_name: `Zzz Delete Ext ${tail()}`,
    });
    expect(made.status, made.error).toBe(200);
    const id = made.data!.person_id;
    const conv = await pgRpc<Conversation>('create_conversation', jwt, {
      p_project_id: projectId,
      p_organization_name: `Zzz Delete Ext Org ${tail()}`,
    });
    expect(conv.status, conv.error).toBe(200);
    await pgRpc('delete_conversation', jwt, { p_conversation_id: conv.data!.id });
    const orgId = conv.data!.organization_id;

    const external = requireExternalEnv();
    const ext = await login(external.email, external.password);
    const p = await pgRpc('delete_workspace_person', ext, { p_workspace_id: workspaceId, p_person_id: id });
    expect(p.status).toBe(403);
    expect(p.error).toContain('42501');
    const o = await pgRpc('delete_workspace_organization', ext, { p_organization_id: orgId });
    expect(o.status).toBe(403);
    expect(o.error).toContain('42501');
    expect(await personLive(id)).toBe(true);
    expect(await orgLive(orgId)).toBe(true);

    expect((await pgRpc('delete_workspace_person', jwt, { p_workspace_id: workspaceId, p_person_id: id })).status).toBe(204);
    expect((await pgRpc('delete_workspace_organization', jwt, { p_organization_id: orgId })).status).toBe(204);
  });
});
