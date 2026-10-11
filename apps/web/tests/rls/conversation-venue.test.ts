import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import {
  decodeJwt,
  envReady,
  limitedEnvReady,
  login,
  pgGet,
  pgPatch,
  pgRpc,
  requireEnv,
  requireLimitedEnv,
} from './_helpers';

/**
 * ADR-102, fase 2 · la conversación se crea, se lee y empareja el correo por
 * su organización y sus contactos (20261011800000_conversation_with_organization_reads).
 *
 * Lo que fija este fichero:
 * - alta por organización, sin persona; con solo una persona, la organización
 *   es la suya o una con su nombre; 409 por organización con el id de la que
 *   ya existe; revivir por organización;
 * - `organization_id` no se escribe por PostgREST (grant por columnas);
 * - unicidad por organización: dos compartidas no; una privada ajena no cuenta
 *   y convive;
 * - papel de más de 200 caracteres: 400 (22023), no un 23514;
 * - la ficha de persona (conversaciones por contacto) no enseña una privada
 *   ajena; `mail_send_authorize` tampoco la deja usar;
 * - correo (con la clave de servicio, si la hay): fechas del contacto y regla
 *   del hilo, y las direcciones que sincroniza un buzón.
 *
 * Fixture: `playwright`, proyecto `zzz-e2e-collab`, organizaciones y personas
 * `ZZZ F2 …` propias. Las conversaciones quedan borradas al final y la pasada
 * siguiente las revive. Nunca toca `muk-cia`. Va rojo contra un origen sin
 * `20261011800000`.
 */
const ORG_A = 'ZZZ F2 Venue A';
const ORG_B = 'ZZZ F2 Venue B';
const ORG_C = 'ZZZ F2 Venue C';
const ORG_D = 'ZZZ F2 Venue D';
const ORG_E1 = 'ZZZ F2 Venue E1';
const ORG_E2 = 'ZZZ F2 Venue E2';
const P5 = { name: 'ZZZ F2 Contact Moves', email: 'zzz-f2-moves@hour.test' };
const SOLO_NAME = 'ZZZ F2 Solo Programmer';
const SOLO_EMAIL = 'zzz-f2-solo@hour.test';
const P1 = { name: 'ZZZ F2 Contact One', email: 'zzz-f2-one@hour.test' };
const P2 = { name: 'ZZZ F2 Contact Two', email: 'zzz-f2-two@hour.test' };
const P3 = { name: 'ZZZ F2 Contact Old', email: 'zzz-f2-old@hour.test' };
const P4 = { name: 'ZZZ F2 Contact Main', email: 'zzz-f2-main@hour.test' };
const FAKE_SEALED = 'v1.zzzzzzzzzzzzzzzz.zzzzzzzzzzzzzzzzzzzz';
const RUN = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

interface ConversationRow {
  id: string;
  slug: string;
  person_id: string | null;
  organization_id: string | null;
  private_to: string | null;
  previous_slugs: string[];
}

interface ProjectMembershipRow {
  id: string;
  roles: string[];
  permission_grants: string[];
  permission_revokes: string[];
}

const one = <T>(data: T | T[] | null): T | undefined =>
  Array.isArray(data) ? data[0] : (data ?? undefined);

const day = (offset: number): string => {
  const d = new Date(Date.now() + offset * 86_400_000);
  return d.toISOString().slice(0, 10);
};
const noonUtc = (offset: number): string => `${day(offset)}T12:00:00Z`;

/** service_role, como el cron del Worker. */
async function serviceRpc<T>(name: string, args: Record<string, unknown>): Promise<{ status: number; data: T | null; error?: string }> {
  const { url, anon } = requireEnv();
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY as string;
  const res = await fetch(new URL(`/rest/v1/rpc/${name}`, url), {
    method: 'POST',
    headers: {
      apikey: key.startsWith('eyJ') ? anon : key,
      Authorization: `Bearer ${key}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify(args),
  });
  const text = await res.text();
  return res.ok
    ? { status: res.status, data: text ? (JSON.parse(text) as T) : null }
    : { status: res.status, data: null, error: text };
}

describe.skipIf(!envReady())('conversation with the venue (ADR-102, fase 2)', () => {
  let jwt: string;
  let me: string;
  let projectId: string;
  let workspaceId: string;
  let originalSetting: boolean | undefined;
  const made = new Set<string>();

  const create = (args: Record<string, unknown>, as: string = jwt) =>
    pgRpc<ConversationRow>('create_conversation', as, { p_project_id: projectId, ...args });

  const orgId = async (name: string): Promise<string | undefined> => {
    const r = await pgGet<{ id: string }>(
      'workspace_organization',
      jwt,
      new URLSearchParams({ select: 'id', workspace_id: `eq.${workspaceId}`, name: `eq.${name}`, deleted_at: 'is.null' }),
    );
    return r.rows[0]?.id;
  };

  /** El dossier de una persona de prueba; si no existe, nace con una conversación propia que se borra. */
  const ensurePerson = async (p: { name: string; email: string }): Promise<string> => {
    const r = await pgGet<{ person_id: string }>(
      'workspace_person',
      jwt,
      new URLSearchParams({ select: 'person_id', workspace_id: `eq.${workspaceId}`, email: `eq.${p.email}`, deleted_at: 'is.null' }),
    );
    if (r.rows[0]) return r.rows[0].person_id;
    const c = await create({ p_organization_name: `${p.name} Org`, p_full_name: p.name, p_email: p.email });
    expect(c.status, c.error).toBe(200);
    await pgRpc('delete_conversation', jwt, { p_conversation_id: one(c.data)!.id });
    return one(c.data)!.person_id!;
  };

  const sweep = async () => {
    // Una pasada muerta a medias deja conversaciones vivas: se recogen.
    for (const name of [ORG_A, ORG_B, ORG_C, ORG_D, ORG_E1, ORG_E2, SOLO_NAME]) {
      const id = await orgId(name);
      if (!id) continue;
      const r = await pgGet<{ id: string }>(
        'conversation',
        jwt,
        new URLSearchParams({ select: 'id', organization_id: `eq.${id}`, project_id: `eq.${projectId}` }),
      );
      for (const row of r.rows) {
        // Sin principal: la pasada siguiente las revive como nacen, sin persona.
        await pgPatch('conversation', jwt, { private_to: null, person_id: null }, new URLSearchParams({ id: `eq.${row.id}` }));
        await pgRpc('delete_conversation', jwt, { p_conversation_id: row.id });
      }
    }
  };

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

    // Las conversaciones de esta pasada nacen compartidas; se restaura al final.
    const ws = await pgGet<{ new_conversations_private: boolean }>(
      'workspace',
      jwt,
      new URLSearchParams({ select: 'new_conversations_private', id: `eq.${workspaceId}` }),
    );
    originalSetting = ws.rows[0]?.new_conversations_private;
    await pgPatch('workspace', jwt, { new_conversations_private: false }, new URLSearchParams({ id: `eq.${workspaceId}` }));
    await sweep();
  });

  afterAll(async () => {
    for (const id of made) {
      await pgPatch('conversation', jwt, { private_to: null, person_id: null }, new URLSearchParams({ id: `eq.${id}` }));
      await pgRpc('delete_conversation', jwt, { p_conversation_id: id });
    }
    if (originalSetting !== undefined) {
      await pgPatch('workspace', jwt, { new_conversations_private: originalSetting }, new URLSearchParams({ id: `eq.${workspaceId}` }));
    }
  });

  test('a conversation is created with an organization and no person', async () => {
    const r = await create({ p_organization_name: ORG_A });
    expect(r.status, r.error).toBe(200);
    const conv = one(r.data)!;
    made.add(conv.id);
    expect(conv.person_id).toBeNull();
    expect(conv.organization_id).toBe(await orgId(ORG_A));
    expect(conv.slug).toMatch(/^zzz-f2-venue-a/);

    // Sin persona no hay principal (una pasada anterior deja contactos sin la marca).
    const contacts = await pgGet<{ is_primary: boolean }>(
      'conversation_contact',
      jwt,
      new URLSearchParams({ select: 'is_primary', conversation_id: `eq.${conv.id}` }),
    );
    expect(contacts.rows.filter((c) => c.is_primary)).toHaveLength(0);
  });

  test('a second one with the same organization is a 409 that names the first', async () => {
    const org = (await orgId(ORG_A))!;
    const first = [...made][0]!;
    for (const args of [{ p_organization_id: org }, { p_organization_name: ORG_A.toLowerCase() }, { p_organization_id: org, p_full_name: P1.name, p_email: P1.email }]) {
      const r = await create(args);
      expect(r.status, JSON.stringify(args)).toBe(409);
      expect(JSON.parse(r.error!).details).toBe(`conversation_id=${first}`);
    }
  });

  test('with only a person, the organization is theirs, or one named after them', async () => {
    const r = await create({ p_full_name: SOLO_NAME, p_email: SOLO_EMAIL });
    expect(r.status, r.error).toBe(200);
    const conv = one(r.data)!;
    made.add(conv.id);
    const org = await orgId(SOLO_NAME);
    expect(org).toBeTruthy();
    expect(conv.organization_id).toBe(org);
    const dossier = await pgGet<{ organization_id: string }>(
      'workspace_person',
      jwt,
      new URLSearchParams({ select: 'organization_id', workspace_id: `eq.${workspaceId}`, person_id: `eq.${conv.person_id}` }),
    );
    expect(dossier.rows[0]?.organization_id).toBe(org);
  });

  test('nothing to talk to is a 400; an organization of nowhere is a 403', async () => {
    expect((await create({})).status).toBe(400);
    expect((await create({ p_organization_id: '00000000-0000-4000-8000-000000000000' })).status).toBe(403);
  });

  test('organization_id is not writable through PostgREST', async () => {
    const conv = [...made][0]!;
    const other = (await orgId(SOLO_NAME))!;
    const r = await pgPatch('conversation', jwt, { organization_id: other }, new URLSearchParams({ id: `eq.${conv}` }));
    expect(r.status).toBeGreaterThanOrEqual(400);
    const after = await pgGet<ConversationRow>('conversation', jwt, new URLSearchParams({ select: 'organization_id', id: `eq.${conv}` }));
    expect(after.rows[0]?.organization_id).toBe(await orgId(ORG_A));
    // Lo de siempre sigue escribible.
    const ok = await pgPatch('conversation', jwt, { next_action_note: 'f2' }, new URLSearchParams({ id: `eq.${conv}` }));
    expect(ok.status).toBe(200);
  });

  test('a role longer than 200 characters is invalid input, not a constraint error', async () => {
    const long = 'x'.repeat(201);
    const c = await create({ p_organization_name: ORG_B, p_full_name: P1.name, p_email: P1.email, p_role: long });
    expect(c.status).toBe(400);
    expect(JSON.parse(c.error!).code).toBe('22023');

    const conv = [...made][0]!;
    // B nace con P1 de principal (la usan las pruebas de correo).
    const p = await create({ p_organization_name: ORG_B, p_full_name: P1.name, p_email: P1.email });
    expect(p.status, p.error).toBe(200);
    made.add(one(p.data)!.id);
    const s = await pgRpc('set_conversation_contact', jwt, {
      p_conversation_id: conv,
      p_person_id: one(p.data)!.person_id,
      p_role: long,
    });
    expect(s.status).toBe(400);
    expect(JSON.parse(s.error!).code).toBe('22023');
  });

  test('revive by organization: the deleted one comes back with the same id', async () => {
    const conv = [...made][0]!;
    expect((await pgRpc('delete_conversation', jwt, { p_conversation_id: conv })).status).toBeLessThan(300);
    const r = await create({ p_organization_id: await orgId(ORG_A) });
    expect(r.status, r.error).toBe(200);
    expect(one(r.data)!.id).toBe(conv);
  });

  test('re-adding a person without an organization revives THEIR last conversation, even with another organization than the dossier', async () => {
    // El dossier se queda la primera organización (E1); la conversación borrada es con E2.
    const first = await create({ p_organization_name: ORG_E1, p_full_name: P5.name, p_email: P5.email });
    expect(first.status, first.error).toBe(200);
    await pgRpc('delete_conversation', jwt, { p_conversation_id: one(first.data)!.id });
    const second = await create({ p_organization_name: ORG_E2, p_full_name: P5.name, p_email: P5.email });
    expect(second.status, second.error).toBe(200);
    const theirs = one(second.data)!;
    expect(theirs.organization_id).toBe(await orgId(ORG_E2));
    await pgRpc('delete_conversation', jwt, { p_conversation_id: theirs.id });

    const again = await create({ p_full_name: P5.name, p_email: P5.email, p_status: 'in_conversation' });
    expect(again.status, again.error).toBe(200);
    made.add(one(again.data)!.id);
    expect(one(again.data)!.id).toBe(theirs.id);
    expect(one(again.data)!.organization_id).toBe(await orgId(ORG_E2));
    // Y viva, otra vez la misma persona sin organización: 409, como siempre.
    expect((await create({ p_full_name: P5.name, p_email: P5.email })).status).toBe(409);
  });

  test('add_conversation_contact: a person without a dossier joins as a contact (primary if none)', async () => {
    const c = await create({ p_organization_name: ORG_C });
    expect(c.status, c.error).toBe(200);
    const conv = one(c.data)!.id;
    made.add(conv);
    const email = 'zzz-f2-inline@hour.test';
    const r = await pgRpc<{ person_id: string; is_primary: boolean; until: string | null }>('add_conversation_contact', jwt, {
      p_conversation_id: conv,
      p_full_name: 'ZZZ F2 Inline',
      p_email: email,
      p_role: 'producción',
    });
    expect(r.status, r.error).toBe(200);
    const row = one(r.data)!;
    expect(row.until).toBeNull();
    const dossier = await pgGet<{ person_id: string }>(
      'workspace_person',
      jwt,
      new URLSearchParams({ select: 'person_id', workspace_id: `eq.${workspaceId}`, email: `eq.${email}` }),
    );
    expect(dossier.rows[0]?.person_id).toBe(row.person_id);
    // Otra vez: ya es contacto vigente, la misma fila.
    const again = await pgRpc<{ person_id: string }>('add_conversation_contact', jwt, {
      p_conversation_id: conv,
      p_full_name: 'ZZZ F2 Inline',
      p_email: email,
    });
    expect(one(again.data)!.person_id).toBe(row.person_id);
    expect((await pgRpc('add_conversation_contact', null, { p_conversation_id: conv, p_full_name: 'x' })).status).toBeGreaterThanOrEqual(400);
    expect((await pgRpc('add_conversation_contact', jwt, { p_conversation_id: '00000000-0000-4000-8000-000000000000', p_full_name: 'x' })).status).toBe(403);
  });

  describe.skipIf(!limitedEnvReady())('with a second member', () => {
    let other: string;
    let otherSub: string;
    let membership: ProjectMembershipRow;
    let theirs: string | undefined;

    beforeAll(async () => {
      const limited = requireLimitedEnv();
      other = await login(limited.email, limited.password);
      otherSub = String(decodeJwt(other).sub);
      const m = await pgGet<ProjectMembershipRow>(
        'project_membership',
        jwt,
        new URLSearchParams({
          project_id: `eq.${projectId}`,
          user_id: `eq.${otherSub}`,
          select: 'id,roles,permission_grants,permission_revokes',
        }),
      );
      membership = m.rows[0]!;
      await pgPatch(
        'project_membership',
        jwt,
        {
          permission_grants: [...new Set([...membership.permission_grants, 'read:conversation', 'edit:conversation'])],
          permission_revokes: membership.permission_revokes.filter((x) => x !== 'read:conversation' && x !== 'edit:conversation'),
        },
        new URLSearchParams({ id: `eq.${membership.id}` }),
      );
    });

    afterAll(async () => {
      if (theirs) {
        await pgPatch('conversation', other, { private_to: null }, new URLSearchParams({ id: `eq.${theirs}` }));
        await pgRpc('delete_conversation', other, { p_conversation_id: theirs });
      }
      await pgPatch(
        'project_membership',
        jwt,
        {
          roles: membership.roles,
          permission_grants: membership.permission_grants,
          permission_revokes: membership.permission_revokes,
        },
        new URLSearchParams({ id: `eq.${membership.id}` }),
      );
    });

    test('a private one of someone else does not count: each gets theirs, and two shared cannot coexist', async () => {
      const mine = [...made][0]!;
      const byId = new URLSearchParams({ id: `eq.${mine}` });
      expect((await pgPatch('conversation', jwt, { private_to: me }, byId)).status).toBe(200);

      // Para la otra persona la mía no existe: crea la suya, compartida.
      const r = await create({ p_organization_id: await orgId(ORG_A) }, other);
      expect(r.status, r.error).toBe(200);
      theirs = one(r.data)!.id;
      expect(theirs).not.toBe(mine);
      expect(one(r.data)!.private_to).toBeNull();

      // Volver a compartir la mía chocaría con la suya.
      const clash = await pgPatch('conversation', jwt, { private_to: null }, byId);
      expect(clash.status).toBe(409);
    });

    test('the person file and mail_send_authorize do not reach a private one of someone else', async () => {
      const mine = [...made][0]!;
      const person = await ensurePerson(P2);
      expect(
        (await pgRpc('set_conversation_contact', jwt, { p_conversation_id: mine, p_person_id: person, p_role: 'técnica' })).status,
      ).toBe(200);

      const viaContact = (as: string) =>
        pgGet<{ id: string }>(
          'conversation',
          as,
          new URLSearchParams({
            select: 'id,contact:conversation_contact!inner(person_id)',
            'contact.person_id': `eq.${person}`,
            deleted_at: 'is.null',
          }),
        );
      expect((await viaContact(jwt)).rows.map((r) => r.id)).toContain(mine);
      expect((await viaContact(other)).rows.map((r) => r.id)).not.toContain(mine);

      const auth = await pgRpc('mail_send_authorize', other, {
        p_conversation_id: mine,
        p_account_id: '00000000-0000-4000-8000-000000000000',
      });
      expect(auth.status).toBe(403);
    });
  });

  describe.skipIf(!process.env.SUPABASE_SERVICE_ROLE_KEY)('mail: contact dates and the thread rule', () => {
    let convA: string;
    let convB: string;
    let boxA: string;
    let boxB: string;
    const person: Record<string, string> = {};

    const msg = (id: string, from: string, occurred: string, extra: Record<string, unknown> = {}) => ({
      provider_message_id: `${RUN}-${id}`,
      provider_thread_id: `${RUN}-thread-${id}`,
      rfc_message_id: `<${RUN}-${id}@f2.test>`,
      occurred_at: occurred,
      direction: 'inbound',
      subject: `F2 ${id}`,
      from,
      to: ['zzz-f2-box@hour.test'],
      cc: [],
      counterparts: [from],
      body: `Body ${id}`,
      ...extra,
    });
    const ingest = (box: string, m: Record<string, unknown>) =>
      serviceRpc<number>('mail_ingest_message', { p_account_id: box, p_message: m });
    const eventsOf = async (conv: string) =>
      (
        await pgGet<{ provider_message_id: string }>(
          'conversation_event',
          jwt,
          new URLSearchParams({
            select: 'provider_message_id:metadata->>provider_message_id',
            conversation_id: `eq.${conv}`,
            source: 'eq.email',
          }),
        )
      ).rows.map((r) => r.provider_message_id);

    beforeAll(async () => {
      convA = [...made][0]!;
      // La conversación A, compartida otra vez si la anterior la dejó privada.
      await pgPatch('conversation', jwt, { private_to: null }, new URLSearchParams({ id: `eq.${convA}` }));
      const b = await pgGet<{ id: string }>(
        'conversation',
        jwt,
        new URLSearchParams({ select: 'id', organization_id: `eq.${await orgId(ORG_B)}`, project_id: `eq.${projectId}`, deleted_at: 'is.null' }),
      );
      convB = b.rows[0]!.id;
      for (const p of [P1, P2, P3, P4]) person[p.email] = await ensurePerson(p);
      const set = (conv: string, email: string, args: Record<string, unknown> = {}) =>
        pgRpc('set_conversation_contact', jwt, { p_conversation_id: conv, p_person_id: person[email], ...args });
      // A: P1 vigente; P2 se fue hace 60 días (estuvo desde hace 200); P3 se fue hace 400.
      expect((await set(convA, P1.email, { p_since: day(-300) })).status).toBe(200);
      // El principal de A (P1 ya es el de B, y la unicidad vieja por persona sigue viva).
      expect((await set(convA, P4.email, { p_is_primary: true })).status).toBe(200);
      expect((await set(convA, P2.email, { p_since: day(-200) })).status).toBe(200);
      expect((await set(convA, P3.email)).status).toBe(200);
      expect((await pgRpc('end_conversation_contact', jwt, { p_conversation_id: convA, p_person_id: person[P2.email], p_until: day(-60) })).status).toBe(200);
      expect((await pgRpc('end_conversation_contact', jwt, { p_conversation_id: convA, p_person_id: person[P3.email], p_until: day(-400) })).status).toBe(200);
      // B: P1 es su principal desde el alta.

      for (const [suffix, assign] of [['a', (id: string) => (boxA = id)], ['b', (id: string) => (boxB = id)]] as const) {
        const c = await pgRpc<string>('connect_mail_account', jwt, {
          p_workspace_id: workspaceId,
          p_scope: 'workspace',
          p_provider: 'google',
          p_address: `zzz-f2-box-${suffix}@hour.test`,
          p_refresh_token_ciphertext: FAKE_SEALED,
        });
        expect(c.status, c.error).toBe(200);
        assign(String(c.data));
      }
    });

    afterAll(async () => {
      for (const box of [boxA, boxB]) if (box) await pgRpc('disconnect_mail_account', jwt, { p_account_id: box });
    });

    test('the mailbox syncs current contacts and those closed less than 12 months ago', async () => {
      const r = await serviceRpc<{ address: string }[]>('mail_contact_addresses', { p_account_id: boxA });
      expect(r.status, r.error).toBe(200);
      const addresses = r.data!.map((x) => x.address);
      expect(addresses).toContain(P1.email);
      expect(addresses).toContain(P2.email);
      expect(addresses).not.toContain(P3.email);
    });

    test('a new thread enters only within the contact dates', async () => {
      expect((await ingest(boxA, msg('inside', P2.email, noonUtc(-90)))).data).toBe(1);
      expect((await ingest(boxA, msg('after', P2.email, noonUtc(-30)))).data).toBe(0);
      expect((await ingest(boxA, msg('before', P2.email, noonUtc(-250)))).data).toBe(0);
      const events = await eventsOf(convA);
      expect(events).toContain(`${RUN}-inside`);
      expect(events).not.toContain(`${RUN}-after`);
      expect(events).not.toContain(`${RUN}-before`);
    });

    test('a reply to a thread already in the conversation enters, from the same mailbox or by In-Reply-To', async () => {
      const thread = `${RUN}-thread-inside`;
      // Mismo hilo, otro buzón: el id de hilo de Gmail es por buzón, no cuenta.
      expect((await ingest(boxB, msg('otherbox', P2.email, noonUtc(-20), { provider_thread_id: thread }))).data).toBe(0);
      // Mismo hilo, mismo buzón: entra.
      expect((await ingest(boxA, msg('reply', P2.email, noonUtc(-20), { provider_thread_id: thread }))).data).toBe(1);
      // Otro buzón, respondiendo a un correo de la conversación: entra.
      expect(
        (await ingest(boxB, msg('inreplyto', P2.email, noonUtc(-10), { in_reply_to: `<${RUN}-inside@f2.test>` }))).data,
      ).toBe(1);
      expect(
        (await ingest(boxB, msg('references', P2.email, noonUtc(-9), { references: [`<${RUN}-zzz@f2.test>`, `<${RUN}-reply@f2.test>`] }))).data,
      ).toBe(1);
      const events = await eventsOf(convA);
      for (const id of ['reply', 'inreplyto', 'references']) expect(events).toContain(`${RUN}-${id}`);
      expect(events).not.toContain(`${RUN}-otherbox`);
    });

    test('an address that is a contact of two conversations enters both', async () => {
      expect((await ingest(boxA, msg('both', P1.email, noonUtc(-1)))).data).toBe(2);
      expect(await eventsOf(convA)).toContain(`${RUN}-both`);
      expect(await eventsOf(convB)).toContain(`${RUN}-both`);
    });

    test('what enters a private conversation does not count for the shared mailbox', async () => {
      const byId = new URLSearchParams({ id: `eq.${convB}` });
      expect((await pgPatch('conversation', jwt, { private_to: me }, byId)).status).toBe(200);
      try {
        // P1: A (compartida) y B (privada) → dos eventos, uno en el recuento.
        expect((await ingest(boxA, msg('counted', P1.email, noonUtc(-1)))).data).toBe(1);
        expect(await eventsOf(convB)).toContain(`${RUN}-counted`);
      } finally {
        await pgPatch('conversation', jwt, { private_to: null }, byId);
      }
    });

    test('a reply that arrives before its original waits, and enters once the original is in', async () => {
      const orig = `<${RUN}-orig@f2.test>`;
      // La respuesta llega antes, por el otro buzón: P2 ya no es contacto ese día y su hilo no está.
      expect((await ingest(boxB, msg('early', P2.email, noonUtc(-15), { in_reply_to: orig }))).data).toBe(0);
      const before = await serviceRpc<string[]>('mail_deferred_ready', { p_account_id: boxB });
      expect(before.status, before.error).toBe(200);
      expect(before.data).not.toContain(`${RUN}-early`);
      // Llega el original (dentro de las fechas de P2) por el buzón A.
      expect((await ingest(boxA, msg('orig', P2.email, noonUtc(-100)))).data).toBe(1);
      const ready = await serviceRpc<string[]>('mail_deferred_ready', { p_account_id: boxB });
      expect(ready.data).toContain(`${RUN}-early`);
      // La sincronización la vuelve a registrar: ahora entra, y deja de esperar.
      expect((await ingest(boxB, msg('early', P2.email, noonUtc(-15), { in_reply_to: orig }))).data).toBe(1);
      expect(await eventsOf(convA)).toContain(`${RUN}-early`);
      const after = await serviceRpc<string[]>('mail_deferred_ready', { p_account_id: boxB });
      expect(after.data).not.toContain(`${RUN}-early`);
      // Un correo sin hilo de alguien que nunca fue contacto no espera: no vuelve.
      expect((await ingest(boxB, msg('stranger', 'zzz-f2-nobody@hour.test', noonUtc(-1), { in_reply_to: orig }))).data).toBe(0);
      expect((await serviceRpc<string[]>('mail_deferred_ready', { p_account_id: boxB })).data).not.toContain(`${RUN}-stranger`);
    });

    test('sending goes to the primary contact only; without one, a clear 400', async () => {
      const r = await pgRpc<{ recipient_address: string }[]>('mail_send_authorize', jwt, {
        p_conversation_id: convA,
        p_account_id: boxA,
      });
      expect(r.status, r.error).toBe(200);
      expect(r.data!.map((x) => x.recipient_address)).toEqual([P4.email]);

      const bare = await create({ p_organization_name: ORG_D });
      expect(bare.status, bare.error).toBe(200);
      made.add(one(bare.data)!.id);
      const none = await pgRpc('mail_send_authorize', jwt, { p_conversation_id: one(bare.data)!.id, p_account_id: boxA });
      expect(none.status).toBe(400);
      expect(JSON.parse(none.error!)).toMatchObject({ code: '22023', message: 'the conversation has no primary contact' });
    });
  });
});
