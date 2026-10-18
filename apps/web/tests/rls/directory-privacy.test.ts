import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import {
  decodeJwt,
  envReady,
  limitedEnvReady,
  login,
  pgGet,
  pgPatch,
  pgRpc,
  projectAccess,
  requireEnv,
  requireLimitedEnv,
  restoreProjectAccess,
  setFacets,
  type ProjectAccess,
} from './_helpers';

/**
 * ADR-123 · el directorio pide Converses y hereda la privacidad
 * (20261018100000_directory_privacy).
 *
 * Lo que fija este fichero:
 * - sin Converses en ningún proyecto, el limitado no lee el directorio (ni la
 *   sala ni el contacto de una conversación compartida), y
 *   `conversation_access` le dice que no;
 * - con Converses lo lee, salvo lo que solo existe por una privada ajena (viva o
 *   borrada); quien la marcó lo sigue leyendo; al volverla compartida aparece;
 * - el equipo sigue a la vista sin Converses: un dossier sin conversación (el
 *   alta de ADR-107) y uno del reparto aunque también sea contacto de una
 *   privada ajena.
 *
 * Fixture: `playwright`, proyecto `zzz-e2e-collab`, personas `zzz-rls-dir-*`.
 * Deja las conversaciones borradas y el acceso del limitado como estaba. Va
 * rojo contra un origen sin `20261018100000`.
 */
const SHARED = { name: 'ZZZ RLS Dir Shared', email: 'zzz-rls-dir-shared@hour.test', org: 'ZZZ RLS Dir Sala Shared' };
const PRIVATE = { name: 'ZZZ RLS Dir Private', email: 'zzz-rls-dir-private@hour.test', org: 'ZZZ RLS Dir Sala Private' };
const CAST = { name: 'ZZZ RLS Dir Cast', email: 'zzz-rls-dir-cast@hour.test' };
const TEAM = { name: 'ZZZ RLS Dir Team', email: 'zzz-rls-dir-team@hour.test' };

interface ConversationRow {
  id: string;
  person_id: string | null;
  organization_id: string | null;
  private_to: string | null;
  created_by: string | null;
}

const one = <T>(data: T | T[] | null): T | undefined =>
  Array.isArray(data) ? data[0] : (data ?? undefined);

describe.skipIf(!envReady() || !limitedEnvReady())(
  'the directory needs Converses and inherits privacy (ADR-123)',
  () => {
    let admin: string;
    let adminSub: string;
    let limited: string;
    let limitedSub: string;
    let workspaceId: string;
    let projectId: string;
    let snapshot: ProjectAccess;
    let originalSetting: boolean | undefined;
    const live: { id: string; jwt: () => string }[] = [];
    const casts: string[] = [];

    async function setSetting(value: boolean) {
      const r = await pgPatch<{ new_conversations_private: boolean }>(
        'workspace',
        admin,
        { new_conversations_private: value },
        new URLSearchParams({ id: `eq.${workspaceId}` }),
      );
      expect(r.rows[0]?.new_conversations_private).toBe(value);
    }

    async function create(
      as: string,
      who: { name: string; email: string; org?: string },
    ): Promise<ConversationRow> {
      const r = await pgRpc<ConversationRow>('create_conversation', as, {
        p_project_id: projectId,
        p_full_name: who.name,
        p_email: who.email,
        p_organization_name: who.org ?? null,
      });
      expect(r.status, r.error).toBe(200);
      const row = one(r.data)!;
      live.push({ id: row.id, jwt: () => as });
      // El contacto vive en `conversation_contact` (ADR-102); el admin lo lee.
      const cc = await pgGet<{ person_id: string }>('conversation_contact', admin, new URLSearchParams({
        conversation_id: `eq.${row.id}`,
        is_primary: 'eq.true',
        select: 'person_id',
      }));
      return { ...row, person_id: cc.rows[0]?.person_id ?? null };
    }

    async function remove(as: string, id: string) {
      const r = await pgRpc('delete_conversation', as, { p_conversation_id: id });
      expect(r.status, r.error).toBeLessThan(300);
      const i = live.findIndex((c) => c.id === id);
      if (i >= 0) live.splice(i, 1);
    }

    async function seesPerson(as: string, personId: string): Promise<boolean> {
      const r = await pgGet('workspace_person', as, new URLSearchParams({
        workspace_id: `eq.${workspaceId}`,
        person_id: `eq.${personId}`,
        select: 'person_id',
      }));
      expect(r.status).toBe(200);
      return r.rows.length === 1;
    }

    async function seesOrg(as: string, orgId: string): Promise<boolean> {
      const r = await pgGet('workspace_organization', as, new URLSearchParams({
        id: `eq.${orgId}`,
        select: 'id',
      }));
      expect(r.status).toBe(200);
      return r.rows.length === 1;
    }

    async function access(as: string): Promise<{ read: boolean; edit: boolean }> {
      const r = await pgRpc<{ read: boolean; edit: boolean }>('conversation_access', as, {});
      expect(r.status, r.error).toBe(200);
      return r.data as unknown as { read: boolean; edit: boolean };
    }

    beforeAll(async () => {
      const env = requireEnv();
      admin = await login(env.email, env.password);
      adminSub = String(decodeJwt(admin).sub);
      const lim = requireLimitedEnv();
      limited = await login(lim.email, lim.password);
      limitedSub = String(decodeJwt(limited).sub);
      const p = await pgGet<{ id: string; workspace_id: string }>(
        'project',
        admin,
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
      const ws = await pgGet<{ new_conversations_private: boolean }>(
        'workspace',
        admin,
        new URLSearchParams({ id: `eq.${workspaceId}`, select: 'new_conversations_private' }),
      );
      originalSetting = ws.rows[0]?.new_conversations_private;
      snapshot = await projectAccess(admin, projectId, limitedSub);
    });

    afterAll(async () => {
      for (const id of casts) await pgRpc('remove_cast_member', admin, { p_cast_member_id: id }).catch(() => undefined);
      for (const c of [...live]) await remove(c.jwt(), c.id).catch(() => undefined);
      if (originalSetting !== undefined) await setSetting(originalSetting);
      await restoreProjectAccess(admin, projectId, limitedSub, snapshot);
    });

    test('without Converses the limited reads no directory, and the screen flag says so', async () => {
      await setFacets(admin, snapshot.membershipId, { converses: null });
      await setSetting(false);
      const shared = await create(admin, SHARED);
      expect(shared.private_to).toBeNull();

      expect(await seesPerson(admin, shared.person_id!)).toBe(true);
      expect(await seesOrg(admin, shared.organization_id!)).toBe(true);
      expect(await seesPerson(limited, shared.person_id!)).toBe(false);
      expect(await seesOrg(limited, shared.organization_id!)).toBe(false);

      const all = await pgGet('workspace_organization', limited, new URLSearchParams({
        workspace_id: `eq.${workspaceId}`,
        select: 'id',
      }));
      expect(all.rows).toHaveLength(0);

      expect(await access(limited)).toEqual({ read: false, edit: false });
      expect(await access(admin)).toEqual({ read: true, edit: true });
      await remove(admin, shared.id);
    });

    test("with Converses it reads the directory, except what only someone else's private conversation holds", async () => {
      await setFacets(admin, snapshot.membershipId, { converses: 'view' });
      expect(await access(limited)).toEqual({ read: true, edit: false });

      await setSetting(false);
      const shared = await create(admin, SHARED);
      expect(await seesPerson(limited, shared.person_id!)).toBe(true);
      expect(await seesOrg(limited, shared.organization_id!)).toBe(true);

      await setSetting(true);
      const priv = await create(admin, PRIVATE);
      expect(priv.private_to).toBe(adminSub);
      expect(await seesPerson(admin, priv.person_id!)).toBe(true);
      expect(await seesOrg(admin, priv.organization_id!)).toBe(true);
      expect(await seesPerson(limited, priv.person_id!)).toBe(false);
      expect(await seesOrg(limited, priv.organization_id!)).toBe(false);

      // Embebido en otra lectura: tampoco sale.
      const viaEmbed = await pgGet<{ organization: unknown }>('workspace_person', limited, new URLSearchParams({
        workspace_id: `eq.${workspaceId}`,
        select: 'person_id,organization:workspace_organization!workspace_person_organization_fkey(id)',
        'organization.id': `eq.${priv.organization_id}`,
        organization: 'not.is.null',
      }));
      expect(viaEmbed.rows).toHaveLength(0);

      // Compartida por quien la marcó: aparece.
      const opened = await pgPatch<ConversationRow>('conversation', admin, { private_to: null },
        new URLSearchParams({ id: `eq.${priv.id}` }));
      expect(opened.rows).toHaveLength(1);
      expect(await seesPerson(limited, priv.person_id!)).toBe(true);
      expect(await seesOrg(limited, priv.organization_id!)).toBe(true);

      // Privada otra vez y borrada: borrar no la destapa.
      const closed = await pgPatch<ConversationRow>('conversation', admin, { private_to: adminSub },
        new URLSearchParams({ id: `eq.${priv.id}` }));
      expect(closed.rows).toHaveLength(1);
      await remove(admin, priv.id);
      expect(await seesPerson(limited, priv.person_id!)).toBe(false);
      expect(await seesOrg(limited, priv.organization_id!)).toBe(false);
      expect(await seesPerson(admin, priv.person_id!)).toBe(true);

      await remove(admin, shared.id);
    });

    test('the team stays visible without Converses: a dossier with no conversation, and the cast', async () => {
      await setFacets(admin, snapshot.membershipId, { converses: null });

      const team = await pgRpc<{ person_id: string }>('create_workspace_person', admin, {
        p_workspace_id: workspaceId,
        p_full_name: TEAM.name,
        p_email: TEAM.email,
      });
      expect(team.status, team.error).toBe(200);
      expect(await seesPerson(limited, one(team.data)!.person_id)).toBe(true);

      await setSetting(true);
      const priv = await create(admin, CAST);
      expect(priv.private_to).toBe(adminSub);
      expect(await seesPerson(limited, priv.person_id!)).toBe(false);

      const cast = await pgRpc<{ id: string }>('add_cast_member', admin, {
        p_project_id: projectId,
        p_person_id: priv.person_id,
        p_role: 'zzz-rls-dir',
      });
      expect(cast.status, cast.error).toBe(200);
      casts.push(one(cast.data)!.id);
      expect(await seesPerson(limited, priv.person_id!)).toBe(true);

      const castRead = await pgGet<{ person: { full_name: string } | null }>('cast_member', limited, new URLSearchParams({
        id: `eq.${one(cast.data)!.id}`,
        select: 'id,person:workspace_person!cast_member_workspace_person_fkey(full_name)',
      }));
      expect(castRead.rows[0]?.person?.full_name).toBe(CAST.name);

      await pgRpc('remove_cast_member', admin, { p_cast_member_id: one(cast.data)!.id });
      casts.pop();
      expect(await seesPerson(limited, priv.person_id!)).toBe(false);
      await remove(admin, priv.id);
    });
  },
);
