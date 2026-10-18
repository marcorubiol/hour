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
 * ADR-124 § 2 · volver privada una compartida: solo quien la creó o el admin
 * (20261018110000_conversation_private_guard).
 *
 * Lo que fija este fichero: el editor de Converses que no la creó no vuelve
 * privada una conversación compartida de la compañía (403) y sigue pudiendo
 * editar lo demás; quien la creó y el admin, sí (para sí mismos).
 *
 * Fixture: `playwright`, proyecto `zzz-e2e-collab`, personas `zzz-rls-guard-*`.
 * Deja las conversaciones borradas y el acceso del limitado como estaba. Va
 * rojo contra un origen sin `20261018110000`.
 */
// Un sufijo por pasada, como en directory-privacy: nombres fijos chocan (409)
// con lo que deja una pasada cortada.
const RUN = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const THEIRS = { name: `ZZZ RLS Guard Theirs ${RUN}`, email: `zzz-rls-guard-theirs-${RUN}@hour.test`, org: `ZZZ RLS Guard Sala Theirs ${RUN}` };
const MINE = { name: `ZZZ RLS Guard Mine ${RUN}`, email: `zzz-rls-guard-mine-${RUN}@hour.test`, org: `ZZZ RLS Guard Sala Mine ${RUN}` };

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
  'only who created a shared conversation, or an admin, makes it private (ADR-124)',
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
    let created = 0;

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
      // Cada alta, la suya: si un test se corta, el siguiente no choca con
      // la conversación que dejó viva (afterAll la borra).
      const n = ++created;
      const r = await pgRpc<ConversationRow>('create_conversation', as, {
        p_project_id: projectId,
        p_full_name: `${who.name} ${n}`,
        p_email: who.email.replace('@', `-${n}@`),
        p_organization_name: who.org ? `${who.org} ${n}` : null,
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
      for (const c of [...live]) await remove(c.jwt(), c.id).catch(() => undefined);
      if (originalSetting !== undefined) await setSetting(originalSetting);
      await restoreProjectAccess(admin, projectId, limitedSub, snapshot);
    });

    test('a Converses editor cannot make the company\'s conversation private; the creator and the admin can', async () => {
      await setFacets(admin, snapshot.membershipId, { converses: 'edit' });
      await setSetting(false);

      // De la compañía, creada por el admin: el limitado no la vuelve privada.
      const theirs = await create(admin, THEIRS);
      expect(theirs.created_by).toBe(adminSub);
      const denied = await pgPatch<ConversationRow>('conversation', limited, { private_to: limitedSub },
        new URLSearchParams({ id: `eq.${theirs.id}` }));
      expect(denied.status).toBe(403);
      const still = await pgGet<ConversationRow>('conversation', admin, new URLSearchParams({
        id: `eq.${theirs.id}`,
        select: 'id,private_to',
      }));
      expect(still.rows[0]?.private_to).toBeNull();

      // Las otras ediciones de una compartida siguen abiertas al editor.
      const note = await pgPatch<ConversationRow>('conversation', limited, { next_action_note: 'zzz-rls-guard' },
        new URLSearchParams({ id: `eq.${theirs.id}` }));
      expect(note.rows).toHaveLength(1);
      await remove(admin, theirs.id);

      // La suya: sí.
      const mine = await create(limited, MINE);
      expect(mine.private_to).toBeNull();
      const own = await pgPatch<ConversationRow>('conversation', limited, { private_to: limitedSub },
        new URLSearchParams({ id: `eq.${mine.id}` }));
      expect(own.rows).toHaveLength(1);
      const back = await pgPatch<ConversationRow>('conversation', limited, { private_to: null },
        new URLSearchParams({ id: `eq.${mine.id}` }));
      expect(back.rows).toHaveLength(1);

      // El admin, aunque no la creó: sí (para sí mismo).
      const byAdmin = await pgPatch<ConversationRow>('conversation', admin, { private_to: adminSub },
        new URLSearchParams({ id: `eq.${mine.id}` }));
      expect(byAdmin.rows).toHaveLength(1);
      const reopen = await pgPatch<ConversationRow>('conversation', admin, { private_to: null },
        new URLSearchParams({ id: `eq.${mine.id}` }));
      expect(reopen.rows).toHaveLength(1);
      await remove(limited, mine.id);
    });
  },
);
