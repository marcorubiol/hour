import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import {
  decodeJwt,
  envReady,
  limitedEnvReady,
  login,
  pgGet,
  pgPatch,
  pgPost,
  pgRpc,
  requireEnv,
  requireLimitedEnv,
} from './_helpers';

/**
 * ADR-102, fase 1 · `conversation_contact` y `conversation.organization_id`
 * (20261011600000_conversation_organization_expand).
 *
 * Lo que fija este fichero:
 * - la lectura hereda la frontera de la conversación: sin `read:conversation`
 *   no se ve, una privada ajena no se ve, anon no ve nada;
 * - se escribe solo por `set_conversation_contact` / `end_conversation_contact`
 *   con `edit:conversation`, y «no existe» y «no es tuyo» dan el mismo 403;
 * - un principal como mucho y siempre vigente; `until >= since`;
 * - mientras conviven los modelos, el principal es `conversation.person_id`:
 *   el alta crea el contacto y la organización del dossier llega a la
 *   conversación; nombrar principal a otra persona mueve `person_id`;
 * - el relleno: toda conversación visible tiene exactamente un principal, el
 *   de su `person_id`.
 *
 * Fixture: `playwright`, proyecto `zzz-e2e-collab`, persona
 * `zzz-rls-contact@hour.test` (con su organización) y el dossier
 * `zzz-difusion-contact-024` de `playwright-difusion.sql` como segundo
 * contacto. Se deja la conversación borrada con su persona de principal, así
 * que la siguiente pasada la recupera. Nunca toca `muk-cia`. Va rojo contra un
 * origen sin `20261011600000`.
 */
const NOWHERE = '00000000-0000-4000-8000-000000000000';
const FIXTURE_EMAIL = 'zzz-rls-contact@hour.test';
const FIXTURE_NAME = 'ZZZ RLS Contact Fixture';
const FIXTURE_ORG = 'ZZZ RLS Contact Venue';
const SECOND_SLUG = 'zzz-difusion-contact-024';

interface ConversationRow {
  id: string;
  person_id: string;
  organization_id: string | null;
  role: string | null;
  private_to: string | null;
}

interface ContactRow {
  id: string;
  workspace_id: string;
  conversation_id: string;
  person_id: string;
  role: string | null;
  since: string | null;
  until: string | null;
  is_primary: boolean;
}

interface ProjectMembershipRow {
  id: string;
  roles: string[];
  permission_grants: string[];
  permission_revokes: string[];
}

const one = <T>(data: T | T[] | null): T | undefined =>
  Array.isArray(data) ? data[0] : (data ?? undefined);

describe.skipIf(!envReady())('conversation_contact (ADR-102, fase 1)', () => {
  let jwt: string;
  let me: string;
  let projectId: string;
  let workspaceId: string;
  let conversation: ConversationRow;
  let firstPerson: string;
  let secondPerson: string;

  const contacts = async (as: string | null = jwt): Promise<ContactRow[]> => {
    const r = await pgGet<ContactRow>(
      'conversation_contact',
      as,
      new URLSearchParams({
        select: '*',
        conversation_id: `eq.${conversation.id}`,
        order: 'person_id',
      }),
    );
    expect(r.status).toBe(200);
    return r.rows;
  };

  const readConversation = async (): Promise<ConversationRow> => {
    const r = await pgGet<ConversationRow>(
      'conversation',
      jwt,
      new URLSearchParams({
        select: 'id,person_id,organization_id,role,private_to',
        id: `eq.${conversation.id}`,
      }),
    );
    expect(r.rows).toHaveLength(1);
    return r.rows[0]!;
  };

  const setContact = (args: Record<string, unknown>, as: string | null = jwt) =>
    pgRpc<ContactRow>('set_conversation_contact', as, {
      p_conversation_id: conversation.id,
      ...args,
    });

  const endContact = (args: Record<string, unknown>, as: string | null = jwt) =>
    pgRpc<ContactRow>('end_conversation_contact', as, {
      p_conversation_id: conversation.id,
      ...args,
    });

  beforeAll(async () => {
    const env = requireEnv();
    jwt = await login(env.email, env.password);
    me = String(decodeJwt(jwt).sub);

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

    const second = await pgGet<{ person_id: string }>(
      'workspace_person',
      jwt,
      new URLSearchParams({
        select: 'person_id',
        workspace_id: `eq.${workspaceId}`,
        slug: `eq.${SECOND_SLUG}`,
        deleted_at: 'is.null',
      }),
    );
    if (second.rows.length === 0) throw new Error(`${SECOND_SLUG} missing in playwright`);
    secondPerson = second.rows[0]!.person_id;

    // Una pasada muerta a medias deja la conversación viva: se recoge, con
    // su persona de principal otra vez para que la próxima la recupere.
    const stale = await pgGet<{ id: string; person_id: string }>(
      'conversation',
      jwt,
      new URLSearchParams({
        select: 'id,person_id,contact:conversation_contact!inner(person:workspace_person!conversation_contact_workspace_person_fkey!inner(email))',
        'contact.person.email': `eq.${FIXTURE_EMAIL}`,
        project_id: `eq.${projectId}`,
        deleted_at: 'is.null',
      }),
    );
    for (const row of stale.rows) {
      await pgRpc('delete_conversation', jwt, { p_conversation_id: row.id });
    }

    const created = await pgRpc<ConversationRow>('create_conversation', jwt, {
      p_project_id: projectId,
      p_full_name: FIXTURE_NAME,
      p_email: FIXTURE_EMAIL,
      p_organization_name: FIXTURE_ORG,
      p_role: 'programación',
    });
    expect(created.status, created.error).toBe(200);
    conversation = one(created.data)!;
    firstPerson = conversation.person_id;
  });

  afterAll(async () => {
    if (!conversation) return;
    const now = await readConversation().catch(() => undefined);
    if (now && now.person_id !== firstPerson) {
      await setContact({ p_person_id: firstPerson, p_is_primary: true });
    }
    await pgRpc('delete_conversation', jwt, { p_conversation_id: conversation.id });
  });

  test('the new conversation takes its dossier organization and one primary contact', async () => {
    expect(conversation.organization_id).not.toBeNull();
    const org = await pgGet<{ name: string }>(
      'workspace_organization',
      jwt,
      new URLSearchParams({ select: 'name', id: `eq.${conversation.organization_id}` }),
    );
    expect(org.rows[0]?.name).toBe(FIXTURE_ORG);

    // Una pasada anterior deja más contactos en la recuperada: se mira el principal.
    const rows = (await contacts()).filter((r) => r.is_primary);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      workspace_id: workspaceId,
      person_id: firstPerson,
      role: 'programación',
      is_primary: true,
      until: null,
    });
  });

  test('every conversation I see has exactly one primary contact: its person (none without one)', async () => {
    const r = await pgGet<{
      id: string;
      person_id: string | null;
      contacts: { person_id: string; is_primary: boolean }[];
    }>(
      'conversation',
      jwt,
      new URLSearchParams({
        select: 'id,person_id,contacts:conversation_contact(person_id,is_primary)',
        workspace_id: `eq.${workspaceId}`,
      }),
    );
    expect(r.status).toBe(200);
    expect(r.rows.length).toBeGreaterThan(0);
    for (const c of r.rows) {
      const primaries = c.contacts.filter((x) => x.is_primary);
      // ADR-102, fase 2: una conversación puede nacer solo con su organización.
      if (c.person_id === null) {
        expect(primaries, c.id).toHaveLength(0);
        continue;
      }
      expect(primaries, c.id).toHaveLength(1);
      expect(primaries[0]!.person_id, c.id).toBe(c.person_id);
    }
  });

  test('anon reads nothing and cannot write', async () => {
    const read = await pgGet('conversation_contact', null, new URLSearchParams({ select: 'id' }));
    expect(read.rows).toHaveLength(0);
    const w = await setContact({ p_person_id: secondPerson }, null);
    expect(w.status).toBeGreaterThanOrEqual(400);
  });

  test('no direct insert, update or delete for a member', async () => {
    const before = (await contacts()).length;
    const ins = await pgPost('conversation_contact', jwt, {
      workspace_id: workspaceId,
      conversation_id: conversation.id,
      person_id: secondPerson,
    });
    expect(ins.status).toBeGreaterThanOrEqual(400);

    const upd = await pgPatch(
      'conversation_contact',
      jwt,
      { role: 'hijacked' },
      new URLSearchParams({ conversation_id: `eq.${conversation.id}` }),
    );
    expect(upd.status).toBeGreaterThanOrEqual(400);

    const { url, anon } = requireEnv();
    const del = await fetch(
      `${url}/rest/v1/conversation_contact?conversation_id=eq.${conversation.id}`,
      { method: 'DELETE', headers: { apikey: anon, Authorization: `Bearer ${jwt}` } },
    );
    expect(del.status).toBeGreaterThanOrEqual(400);
    expect(await contacts()).toHaveLength(before);
  });

  test('a contact is added, closed with a date, and comes back', async () => {
    const added = await setContact({
      p_person_id: secondPerson,
      p_role: 'técnica',
      p_since: '2026-01-10',
    });
    expect(added.status, added.error).toBe(200);
    expect(one(added.data)).toMatchObject({
      person_id: secondPerson,
      role: 'técnica',
      since: '2026-01-10',
      until: null,
      is_primary: false,
    });

    const early = await endContact({ p_person_id: secondPerson, p_until: '2026-01-01' });
    expect(early.status).toBe(400);

    const ended = await endContact({ p_person_id: secondPerson, p_until: '2026-03-31' });
    expect(ended.status, ended.error).toBe(200);
    expect(one(ended.data)?.until).toBe('2026-03-31');

    const back = await setContact({ p_person_id: secondPerson, p_role: 'técnica', p_since: '2026-06-01' });
    expect(back.status, back.error).toBe(200);
    expect(one(back.data)).toMatchObject({ since: '2026-06-01', until: null });
    expect(await contacts()).toHaveLength(2);
  });

  test('the primary cannot be closed nor demoted without naming another', async () => {
    const end = await endContact({ p_person_id: firstPerson });
    expect(end.status).toBe(400);
    const demote = await setContact({ p_person_id: firstPerson, p_is_primary: false });
    expect(demote.status).toBe(400);
    const rows = await contacts();
    expect(rows.find((r) => r.person_id === firstPerson)).toMatchObject({ is_primary: true, until: null });
  });

  test('naming another primary moves conversation.person_id; one primary at a time', async () => {
    const r = await setContact({ p_person_id: secondPerson, p_role: 'dirección', p_is_primary: true });
    expect(r.status, r.error).toBe(200);
    const conv = await readConversation();
    expect(conv.person_id).toBe(secondPerson);
    expect(conv.role).toBe('dirección');
    expect(conv.organization_id).toBe(conversation.organization_id);

    const rows = await contacts();
    expect(rows.filter((x) => x.is_primary).map((x) => x.person_id)).toEqual([secondPerson]);
    // El principal anterior sigue de contacto vigente.
    expect(rows.find((x) => x.person_id === firstPerson)).toMatchObject({ is_primary: false, until: null });

    const backR = await setContact({ p_person_id: firstPerson, p_role: 'programación', p_is_primary: true });
    expect(backR.status, backR.error).toBe(200);
    expect((await readConversation()).person_id).toBe(firstPerson);
  });

  test('a dossier from nowhere and a conversation from nowhere give the same 403', async () => {
    const person = await setContact({ p_person_id: NOWHERE });
    expect(person.status).toBe(403);
    const conv = await pgRpc('set_conversation_contact', jwt, {
      p_conversation_id: NOWHERE,
      p_person_id: secondPerson,
    });
    expect(conv.status).toBe(403);
    const end = await pgRpc('end_conversation_contact', jwt, {
      p_conversation_id: NOWHERE,
      p_person_id: secondPerson,
    });
    expect(end.status).toBe(403);
  });

  test.skipIf(!limitedEnvReady())(
    'without read:conversation nothing shows; a private one of someone else is "not found"',
    async () => {
      const limited = requireLimitedEnv();
      const other = await login(limited.email, limited.password);
      const otherSub = String(decodeJwt(other).sub);

      // Sin permiso (lo que trae el fixture): nada.
      const m = await pgGet<ProjectMembershipRow>(
        'project_membership',
        jwt,
        new URLSearchParams({
          project_id: `eq.${projectId}`,
          user_id: `eq.${otherSub}`,
          select: 'id,roles,permission_grants,permission_revokes',
        }),
      );
      expect(m.rows).toHaveLength(1);
      const membership = m.rows[0]!;
      const restore = () =>
        pgPatch(
          'project_membership',
          jwt,
          {
            roles: membership.roles,
            permission_grants: membership.permission_grants,
            permission_revokes: membership.permission_revokes,
          },
          new URLSearchParams({ id: `eq.${membership.id}` }),
        );
      const setPrivate = (value: string | null) =>
        pgPatch(
          'conversation',
          jwt,
          { private_to: value },
          new URLSearchParams({ id: `eq.${conversation.id}` }),
        );

      try {
        const revoked = await pgPatch(
          'project_membership',
          jwt,
          {
            permission_grants: membership.permission_grants.filter(
              (p) => p !== 'read:conversation' && p !== 'edit:conversation',
            ),
            permission_revokes: [
              ...new Set([...membership.permission_revokes, 'read:conversation', 'edit:conversation']),
            ],
          },
          new URLSearchParams({ id: `eq.${membership.id}` }),
        );
        expect(revoked.rows).toHaveLength(1);
        expect((await setPrivate(null)).rows).toHaveLength(1);
        expect(await contacts(other)).toHaveLength(0);
        const denied = await setContact({ p_person_id: secondPerson }, other);
        expect(denied.status).toBe(403);

        // Con permiso y compartida: la ve y la edita.
        const granted = await pgPatch(
          'project_membership',
          jwt,
          {
            permission_grants: [
              ...new Set([...membership.permission_grants, 'read:conversation', 'edit:conversation']),
            ],
            permission_revokes: membership.permission_revokes.filter(
              (p) => p !== 'read:conversation' && p !== 'edit:conversation',
            ),
          },
          new URLSearchParams({ id: `eq.${membership.id}` }),
        );
        expect(granted.rows).toHaveLength(1);
        expect((await contacts(other)).length).toBeGreaterThan(0);
        const allowed = await setContact({ p_person_id: secondPerson, p_role: 'técnica' }, other);
        expect(allowed.status, allowed.error).toBe(200);

        // Privada mía: para la otra persona no existe, ni para leer ni para
        // escribir, con el mismo 403 que una que no existe.
        expect((await setPrivate(me)).rows).toHaveLength(1);
        expect(await contacts(other)).toHaveLength(0);
        const hidden = await setContact({ p_person_id: secondPerson }, other);
        expect(hidden.status).toBe(403);
        const hiddenEnd = await endContact({ p_person_id: secondPerson }, other);
        expect(hiddenEnd.status).toBe(403);
        expect((await contacts()).length).toBeGreaterThan(0);
      } finally {
        await restore();
      }
    },
  );
});
