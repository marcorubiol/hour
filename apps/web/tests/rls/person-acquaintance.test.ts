import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import {
  decodeJwt,
  envReady,
  externalEnvReady,
  limitedEnvReady,
  login,
  pgGet,
  pgPatch,
  pgPost,
  pgRpc,
  projectAccess,
  requireEnv,
  requireExternalEnv,
  requireLimitedEnv,
  restoreProjectAccess,
  setFacets,
  type ProjectAccess,
} from './_helpers';

/**
 * ADR-138 § 5 · «lo conozco» (20261020110000_person_acquaintance).
 *
 * Lo que fija este fichero:
 * - la fila propia se lee; la de otro sin compartir, no; compartida, la lee
 *   quien lee ese dossier;
 * - la API no escribe la tabla: solo `set_acquaintance`, y quitar la marca
 *   borra la fila;
 * - una marca compartida de un contacto que solo existe por una privada ajena
 *   no la ve nadie más, tampoco el admin (ADR-124 § 2), y el admin no puede
 *   marcarlo;
 * - la marca no abre nada: sin Converses, ni la marca, ni el dossier, ni la
 *   conversación;
 * - la marca de un exmiembro deja de verse.
 *
 * Fixture: `playwright`, proyecto `zzz-e2e-collab`, personas
 * `zzz-rls-acq-*-<pasada>`. Deja borradas las conversaciones, quitadas las
 * marcas que puede quitar, el acceso del limitado y el ajuste del espacio
 * como estaban, y al externo fuera del espacio. La marca del exmiembro se
 * queda en la tabla, invisible, colgando de un dossier de prueba. Va rojo
 * contra un origen sin `20261020110000`.
 */
const RUN = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const TEAM = { name: `ZZZ RLS Acq Team ${RUN}`, email: `zzz-rls-acq-team-${RUN}@hour.test` };
const EXMEMBER = { name: `ZZZ RLS Acq Ex ${RUN}`, email: `zzz-rls-acq-ex-${RUN}@hour.test` };
const SHARED = { name: `ZZZ RLS Acq Shared ${RUN}`, email: `zzz-rls-acq-shared-${RUN}@hour.test`, org: `ZZZ RLS Acq Sala Shared ${RUN}` };
const PRIVATE = { name: `ZZZ RLS Acq Private ${RUN}`, email: `zzz-rls-acq-private-${RUN}@hour.test`, org: `ZZZ RLS Acq Sala Private ${RUN}` };

interface AcquaintanceRow {
  workspace_id: string;
  person_id: string;
  user_id: string;
  shared: boolean;
}

interface ConversationRow {
  id: string;
  private_to: string | null;
}

const one = <T>(data: T | T[] | null): T | undefined =>
  Array.isArray(data) ? data[0] : (data ?? undefined);

describe.skipIf(!envReady() || !limitedEnvReady())('«lo conozco» is personal and opens nothing (ADR-138 § 5)', () => {
  let admin: string;
  let adminSub: string;
  let limited: string;
  let limitedSub: string;
  let workspaceId: string;
  let projectId: string;
  let snapshot: ProjectAccess;
  let originalSetting: boolean | undefined;
  const live: { id: string; jwt: () => string }[] = [];
  const marks: { jwt: () => string; personId: string }[] = [];

  async function setSetting(value: boolean) {
    const r = await pgPatch<{ new_conversations_private: boolean }>(
      'workspace',
      admin,
      { new_conversations_private: value },
      new URLSearchParams({ id: `eq.${workspaceId}` }),
    );
    expect(r.rows[0]?.new_conversations_private).toBe(value);
  }

  async function teamPerson(who: { name: string; email: string }): Promise<string> {
    const r = await pgRpc<{ person_id: string }>('create_workspace_person', admin, {
      p_workspace_id: workspaceId,
      p_full_name: who.name,
      p_email: who.email,
    });
    expect(r.status, r.error).toBe(200);
    return one(r.data)!.person_id;
  }

  async function create(as: string, who: { name: string; email: string; org: string }) {
    const r = await pgRpc<ConversationRow>('create_conversation', as, {
      p_project_id: projectId,
      p_full_name: who.name,
      p_email: who.email,
      p_organization_name: who.org,
    });
    expect(r.status, r.error).toBe(200);
    const row = one(r.data)!;
    live.push({ id: row.id, jwt: () => as });
    // Quien la creó lee su contacto, sea privada o no.
    const cc = await pgGet<{ person_id: string }>('conversation_contact', as, new URLSearchParams({
      conversation_id: `eq.${row.id}`,
      is_primary: 'eq.true',
      select: 'person_id',
    }));
    expect(cc.rows).toHaveLength(1);
    return { ...row, personId: cc.rows[0]!.person_id };
  }

  async function remove(as: string, id: string) {
    await pgRpc('delete_conversation', as, { p_conversation_id: id });
    const i = live.findIndex((c) => c.id === id);
    if (i >= 0) live.splice(i, 1);
  }

  async function mark(as: string, personId: string, known: boolean, shared = false) {
    const r = await pgRpc<AcquaintanceRow[]>('set_acquaintance', as, {
      p_workspace_id: workspaceId,
      p_person_id: personId,
      p_known: known,
      p_shared: shared,
    });
    if (known && r.status < 300) marks.push({ jwt: () => as, personId });
    return r;
  }

  async function marksOf(as: string, personId: string): Promise<AcquaintanceRow[]> {
    const r = await pgGet<AcquaintanceRow>('person_acquaintance', as, new URLSearchParams({
      workspace_id: `eq.${workspaceId}`,
      person_id: `eq.${personId}`,
      select: 'workspace_id,person_id,user_id,shared',
    }));
    expect(r.status).toBe(200);
    return r.rows;
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
    for (const m of marks) {
      await pgRpc('set_acquaintance', m.jwt(), {
        p_workspace_id: workspaceId,
        p_person_id: m.personId,
        p_known: false,
      }).catch(() => undefined);
    }
    for (const c of [...live]) await remove(c.jwt(), c.id).catch(() => undefined);
    if (originalSetting !== undefined) await setSetting(originalSetting);
    await restoreProjectAccess(admin, projectId, limitedSub, snapshot);
  });

  test('own mark yes, someone else unshared no; shared, whoever reads the dossier; unmarking deletes', async () => {
    const person = await teamPerson(TEAM);

    const set = await mark(admin, person, true);
    expect(set.status, set.error).toBe(200);
    expect(set.data).toEqual([expect.objectContaining({ user_id: adminSub, shared: false })]);
    expect(await marksOf(admin, person)).toHaveLength(1);
    // Un dossier del equipo lo lee cualquiera; la marca sin compartir, no.
    expect(await marksOf(limited, person)).toHaveLength(0);

    const shared = await mark(admin, person, true, true);
    expect(shared.data).toEqual([expect.objectContaining({ shared: true })]);
    expect(await marksOf(limited, person)).toEqual([expect.objectContaining({ user_id: adminSub, shared: true })]);

    // La API no escribe la tabla: ni una fila ajena ni la propia.
    const forged = await pgPost('person_acquaintance', limited, {
      workspace_id: workspaceId,
      person_id: person,
      user_id: adminSub,
      shared: true,
    });
    expect(forged.status).toBeGreaterThanOrEqual(400);
    const flip = await pgPatch('person_acquaintance', limited, { shared: false },
      new URLSearchParams({ person_id: `eq.${person}`, user_id: `eq.${adminSub}` }));
    expect(flip.status === 200 ? flip.rows : []).toHaveLength(0);
    expect(await marksOf(limited, person)).toEqual([expect.objectContaining({ shared: true })]);

    // Cada uno, la suya: la del limitado no toca la del admin.
    expect((await mark(limited, person, true)).status).toBe(200);
    expect((await marksOf(limited, person)).map((r) => r.user_id).sort()).toEqual([adminSub, limitedSub].sort());
    expect(await marksOf(admin, person)).toHaveLength(1);

    const off = await mark(admin, person, false);
    expect(off.status, off.error).toBe(200);
    expect(off.data).toEqual([]);
    expect(await marksOf(admin, person)).toHaveLength(0);
    expect(await marksOf(limited, person)).toEqual([expect.objectContaining({ user_id: limitedSub })]);
    await mark(limited, person, false);
  });

  test("a shared mark on a contact only someone else's private conversation holds: nobody else, not even the admin", async () => {
    await setFacets(admin, snapshot.membershipId, { converses: 'edit' });
    await setSetting(true);
    const priv = await create(limited, PRIVATE);
    expect(priv.private_to).toBe(limitedSub);

    const set = await mark(limited, priv.personId, true, true);
    expect(set.status, set.error).toBe(200);
    expect(await marksOf(limited, priv.personId)).toHaveLength(1);
    expect(await marksOf(admin, priv.personId)).toHaveLength(0);

    // Tampoco por la lista de todo el espacio.
    const all = await pgGet<AcquaintanceRow>('person_acquaintance', admin, new URLSearchParams({
      workspace_id: `eq.${workspaceId}`,
      user_id: `eq.${limitedSub}`,
      select: 'person_id',
    }));
    expect(all.rows.map((r) => r.person_id)).not.toContain(priv.personId);

    // Y el admin no puede marcar un dossier que no lee.
    expect((await mark(admin, priv.personId, true)).status).toBeGreaterThanOrEqual(400);

    await remove(limited, priv.id);
  });

  test('the mark opens nothing: without Converses, not the mark, nor the dossier, nor the conversation', async () => {
    await setFacets(admin, snapshot.membershipId, { converses: null });
    await setSetting(false);
    const conv = await create(admin, SHARED);
    expect(conv.private_to).toBeNull();
    expect((await mark(admin, conv.personId, true, true)).status).toBe(200);

    expect(await marksOf(limited, conv.personId)).toHaveLength(0);
    const dossier = await pgGet('workspace_person', limited, new URLSearchParams({
      workspace_id: `eq.${workspaceId}`,
      person_id: `eq.${conv.personId}`,
      select: 'person_id',
    }));
    expect(dossier.rows).toHaveLength(0);
    const read = await pgGet('conversation', limited, new URLSearchParams({ id: `eq.${conv.id}`, select: 'id' }));
    expect(read.rows).toHaveLength(0);
    // Ni por el embebido del dossier desde la marca.
    const embed = await pgGet('person_acquaintance', limited, new URLSearchParams({
      person_id: `eq.${conv.personId}`,
      select: 'person_id,dossier:workspace_person!person_acquaintance_workspace_person_fkey(full_name)',
    }));
    expect(embed.rows).toHaveLength(0);
    // Y no puede marcarlo.
    expect((await mark(limited, conv.personId, true)).status).toBeGreaterThanOrEqual(400);

    await mark(admin, conv.personId, false);
    await remove(admin, conv.id);
  });

  describe.skipIf(!externalEnvReady())('a former member', () => {
    let external: string;
    let externalSub: string;

    async function removeExternal() {
      const rows = await pgGet<{ id: string }>('membership', admin, new URLSearchParams({
        level: 'eq.workspace',
        workspace_id: `eq.${workspaceId}`,
        user_id: `eq.${externalSub}`,
        select: 'id',
      }));
      for (const row of rows.rows) await pgRpc('revoke_workspace_member', admin, { p_membership_id: row.id });
    }

    beforeAll(async () => {
      const ext = requireExternalEnv();
      external = await login(ext.email, ext.password);
      externalSub = String(decodeJwt(external).sub);
      await removeExternal();
    });

    afterAll(async () => {
      await removeExternal();
    });

    test("a former member's shared mark stops showing", async () => {
      const person = await teamPerson(EXMEMBER);
      const invited = await pgRpc<{ token: string }[]>('create_workspace_invitation', admin, {
        p_workspace_id: workspaceId,
        p_email: requireExternalEnv().email,
        p_role: 'member',
        p_expires_days: 1,
      });
      expect(invited.status, invited.error).toBe(200);
      const accepted = await pgRpc('accept_workspace_invitation', external, { p_token: invited.data![0]!.token });
      expect(accepted.status, accepted.error).toBe(200);

      const set = await pgRpc('set_acquaintance', external, {
        p_workspace_id: workspaceId,
        p_person_id: person,
        p_known: true,
        p_shared: true,
      });
      expect(set.status, set.error).toBe(200);
      expect(await marksOf(admin, person)).toEqual([expect.objectContaining({ user_id: externalSub, shared: true })]);

      await removeExternal();
      expect(await marksOf(admin, person)).toHaveLength(0);
      expect(await marksOf(external, person)).toHaveLength(0);
    });
  });
});
