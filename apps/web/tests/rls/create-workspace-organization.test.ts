/**
 * 136: alta directa de una organización y la organización de un dossier
 * (`20261111130000_create_workspace_organization`). Rojo hasta aplicar esa
 * migración: las dos funciones no existen antes.
 *
 * `create_workspace_organization`: owner, admin o member del espacio; nombre
 * obligatorio, tipo de la lista, email válido; un nombre que ya tiene otra
 * organización viva del espacio es 23505 (409). `set_workspace_person_organization`:
 * el permiso de `create_workspace_person`; la organización del mismo espacio.
 * Quien es de fuera recibe 42501 y nada se mueve. Todo en `playwright`, y lo
 * que crea lo borra.
 */

import { beforeAll, describe, expect, test } from 'vitest';
import { envReady, externalEnvReady, login, pgGet, pgRpc, requireEnv, requireExternalEnv } from './_helpers';

type Org = { id: string; workspace_id: string; slug: string; name: string; kind: string; city: string | null; email: string | null };
type Dossier = { workspace_id: string; person_id: string; organization_id: string | null };

const tail = () => Math.random().toString(16).slice(2, 10);

describe.skipIf(!envReady())('RLS — create_workspace_organization / set_workspace_person_organization', () => {
  let jwt: string;
  let workspaceId: string;
  let otherWorkspaceId: string | null = null;

  beforeAll(async () => {
    const env = requireEnv();
    jwt = await login(env.email, env.password);
    const ws = await pgGet<{ id: string; slug: string }>(
      'workspace',
      jwt,
      new URLSearchParams({ select: 'id,slug', deleted_at: 'is.null' }),
    );
    const pw = ws.rows.find((w) => w.slug === 'playwright');
    if (!pw) throw new Error('playwright workspace missing');
    workspaceId = pw.id;
    otherWorkspaceId = ws.rows.find((w) => w.slug !== 'playwright')?.id ?? null;
  });

  const dropOrg = (id: string) => pgRpc('delete_workspace_organization', jwt, { p_organization_id: id });
  const dropPerson = (id: string) => pgRpc('delete_workspace_person', jwt, { p_workspace_id: workspaceId, p_person_id: id });

  test('a member makes one with its facts; the same name again is 23505', async () => {
    const name = `Zzz Org ${tail()}`;
    const made = await pgRpc<Org>('create_workspace_organization', jwt, {
      p_workspace_id: workspaceId,
      p_name: `  ${name} `,
      p_kind: 'theatre',
      p_city: 'Girona',
      p_email: 'prog@zzz.test',
    });
    expect(made.status, made.error).toBe(200);
    const org = made.data!;
    try {
      expect(org).toMatchObject({ workspace_id: workspaceId, name, kind: 'theatre', city: 'Girona', email: 'prog@zzz.test' });
      expect(org.slug).toMatch(/^zzz-org-/);

      const again = await pgRpc('create_workspace_organization', jwt, {
        p_workspace_id: workspaceId,
        p_name: name.toUpperCase(),
      });
      expect(again.status).toBe(409);
      expect(again.error).toContain('23505');
    } finally {
      expect((await dropOrg(org.id)).status).toBe(204);
    }
  });

  test('without a kind it is «other»; a bad kind, a blank name or a bad email is 22023', async () => {
    const made = await pgRpc<Org>('create_workspace_organization', jwt, { p_workspace_id: workspaceId, p_name: `Zzz Org ${tail()}` });
    expect(made.status, made.error).toBe(200);
    expect(made.data!.kind).toBe('other');
    await dropOrg(made.data!.id);

    for (const args of [
      { p_name: 'Zzz', p_kind: 'bar' },
      { p_name: '   ' },
      { p_name: 'Zzz', p_email: 'nope' },
    ]) {
      const res = await pgRpc('create_workspace_organization', jwt, { p_workspace_id: workspaceId, ...args });
      expect(res.status, JSON.stringify(args)).toBe(400);
      expect(res.error).toContain('22023');
    }
  });

  test('a dossier takes an organization of its space, and NULL clears it', async () => {
    const org = await pgRpc<Org>('create_workspace_organization', jwt, { p_workspace_id: workspaceId, p_name: `Zzz Org ${tail()}` });
    const person = await pgRpc<Dossier>('create_workspace_person', jwt, { p_workspace_id: workspaceId, p_full_name: `Zzz Persona ${tail()}` });
    expect(org.status, org.error).toBe(200);
    expect(person.status, person.error).toBe(200);
    try {
      const set = await pgRpc<Dossier>('set_workspace_person_organization', jwt, {
        p_workspace_id: workspaceId,
        p_person_id: person.data!.person_id,
        p_organization_id: org.data!.id,
      });
      expect(set.status, set.error).toBe(200);
      expect(set.data!.organization_id).toBe(org.data!.id);

      const cleared = await pgRpc<Dossier>('set_workspace_person_organization', jwt, {
        p_workspace_id: workspaceId,
        p_person_id: person.data!.person_id,
        p_organization_id: null,
      });
      expect(cleared.status, cleared.error).toBe(200);
      expect(cleared.data!.organization_id).toBeNull();
    } finally {
      await dropPerson(person.data!.person_id);
      await dropOrg(org.data!.id);
    }
  });

  test('an organization of another space is 42501', async () => {
    if (!otherWorkspaceId) return; // the fixture belongs to one space only
    const person = await pgRpc<Dossier>('create_workspace_person', jwt, { p_workspace_id: workspaceId, p_full_name: `Zzz Persona ${tail()}` });
    const foreign = await pgRpc<Org>('create_workspace_organization', jwt, { p_workspace_id: otherWorkspaceId, p_name: `Zzz Org ${tail()}` });
    try {
      if (foreign.status !== 200) return; // no write there: nothing to cross
      const res = await pgRpc('set_workspace_person_organization', jwt, {
        p_workspace_id: workspaceId,
        p_person_id: person.data!.person_id,
        p_organization_id: foreign.data!.id,
      });
      expect(res.status).toBe(403);
      expect(res.error).toContain('42501');
    } finally {
      await dropPerson(person.data!.person_id);
      if (foreign.status === 200) await pgRpc('delete_workspace_organization', jwt, { p_organization_id: foreign.data!.id });
    }
  });

  test.skipIf(!externalEnvReady())('someone outside the space gets 42501 and nothing is made', async () => {
    const external = requireExternalEnv();
    const ext = await login(external.email, external.password);
    const name = `Zzz Org Ext ${tail()}`;
    const res = await pgRpc('create_workspace_organization', ext, { p_workspace_id: workspaceId, p_name: name });
    expect(res.status).toBe(403);
    expect(res.error).toContain('42501');
    const found = await pgGet<{ id: string }>(
      'workspace_organization',
      jwt,
      new URLSearchParams({ select: 'id', workspace_id: `eq.${workspaceId}`, name: `eq.${name}` }),
    );
    expect(found.rows).toHaveLength(0);
  });
});
