import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import {
  decodeJwt,
  envReady,
  externalEnvReady,
  limitedEnvReady,
  login,
  pgGet,
  pgPatch,
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
 * ADR-138 · fase E1 (20261020100000_conversation_relation).
 *
 * Lo que fija este fichero:
 * - `conversation_bolos` devuelve fecha, sala, ciudad y estado, NUNCA caché ni
 *   pagador, a quien lee la conversación y tiene `read:performance`;
 * - sin `read:conversation` (Converses) o sin acceso al proyecto, 0 filas; una
 *   privada de otra persona, 0 filas (también por `conversations_bolos`);
 * - «no esta vez» se escribe por el grant de columnas y la relación derivada
 *   (`conversation_relation`) lo dice; quitarlo lo levanta.
 *
 * `read:performance` es el acceso al propio contenedor (ADR-100 § 1): quien
 * tiene Converses en el proyecto lo tiene. «Sin read:performance» es, pues,
 * alguien sin acceso al proyecto: la identidad externa.
 *
 * Fixture: `playwright`, proyecto `zzz-e2e-collab`. Autolimpiante: borra lo que
 * crea y deja el acceso del limitado y el ajuste del espacio como estaban. Va
 * rojo contra un origen sin `20261020100000`.
 */
const RUN = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

/** Lo único que la RPC puede devolver: ni caché, ni moneda, ni pagador. */
const BOLO_COLUMNS = [
  'bolo_id',
  'city',
  'conversation_id',
  'country',
  'first_performed_at',
  'function_count',
  'last_performed_at',
  'line_id',
  'performance_slug',
  'project_id',
  'status',
  'venue_name',
];

interface Row {
  id: string;
}
interface BoloRow extends Record<string, unknown> {
  conversation_id: string;
  bolo_id: string;
  status: string;
  first_performed_at: string | null;
}

const one = <T>(data: T | T[] | null): T | undefined => (Array.isArray(data) ? data[0] : (data ?? undefined));

describe.skipIf(!envReady() || !limitedEnvReady())('conversation_bolos and «not this time» (ADR-138 E1)', () => {
  let admin: string;
  let adminSub: string;
  let limited: string;
  let limitedSub: string;
  let workspaceId: string;
  let projectId: string;
  let snapshot: ProjectAccess;
  let originalSetting: boolean | undefined;
  let shared = '';
  let mine = '';
  const bolos: string[] = [];
  const perfs: string[] = [];

  async function setSetting(value: boolean) {
    const r = await pgPatch<{ new_conversations_private: boolean }>(
      'workspace',
      admin,
      { new_conversations_private: value },
      new URLSearchParams({ id: `eq.${workspaceId}` }),
    );
    expect(r.rows[0]?.new_conversations_private).toBe(value);
  }

  async function createConversation(label: string): Promise<string> {
    const r = await pgRpc<Row>('create_conversation', admin, {
      p_project_id: projectId,
      p_organization_name: `ZZZ RLS Relation ${label} ${RUN}`,
    });
    expect(r.status, r.error).toBe(200);
    return one(r.data)!.id;
  }

  async function seedBolo(conversationId: string, day: string): Promise<void> {
    const bolo = await pgRpc<Row>('create_bolo', admin, {
      p_project_id: projectId,
      p_conversation_id: conversationId,
      p_status: 'hold_1',
      p_venue_name: `ZZZ RLS Relation ${RUN}`,
      p_city: 'Girona',
      p_fee_amount: 1500,
      p_fee_currency: 'EUR',
    });
    expect(bolo.status, bolo.error).toBe(200);
    bolos.push(one(bolo.data)!.id);
    const perf = await pgRpc<Row>('create_performance', admin, {
      p_project_id: projectId,
      p_performed_at: day,
      p_status: 'hold_1',
      p_venue_name: `ZZZ RLS Relation ${RUN}`,
      p_bolo_id: one(bolo.data)!.id,
    });
    expect(perf.status, perf.error).toBe(200);
    perfs.push(one(perf.data)!.id);
  }

  async function bolosOf(jwt: string, conversationId: string): Promise<BoloRow[]> {
    const r = await pgRpc<BoloRow[]>('conversation_bolos', jwt, { p_conversation_id: conversationId });
    expect(r.status, r.error).toBe(200);
    return r.data ?? [];
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

    await setSetting(false);
    shared = await createConversation('Shared');
    mine = await createConversation('Mine');
    const priv = await pgPatch<Row>('conversation', admin, { private_to: adminSub }, new URLSearchParams({ id: `eq.${mine}` }));
    expect(priv.rows).toHaveLength(1);
    await seedBolo(shared, '2027-03-14');
    await seedBolo(mine, '2027-04-02');
  });

  afterAll(async () => {
    for (const id of perfs) await pgRpc('delete_performance', admin, { p_performance_id: id }).catch(() => undefined);
    for (const id of bolos) await pgRpc('delete_bolo', admin, { p_bolo_id: id }).catch(() => undefined);
    for (const id of [shared, mine]) {
      if (id) await pgRpc('delete_conversation', admin, { p_conversation_id: id }).catch(() => undefined);
    }
    if (originalSetting !== undefined) await setSetting(originalSetting);
    if (snapshot) await restoreProjectAccess(admin, projectId, limitedSub, snapshot);
  });

  test('who reads the conversation sees its bolos with date and status, never fee nor payer', async () => {
    const rows = await bolosOf(admin, shared);
    expect(rows).toHaveLength(1);
    expect(Object.keys(rows[0]!).sort()).toEqual(BOLO_COLUMNS);
    expect(rows[0]).toMatchObject({
      conversation_id: shared,
      status: 'hold_1',
      city: 'Girona',
      function_count: 1,
      first_performed_at: '2027-03-14',
      last_performed_at: '2027-03-14',
    });
  });

  test('without Converses: 0 rows', async () => {
    await setFacets(admin, snapshot.membershipId, { converses: null });
    expect(await bolosOf(limited, shared)).toEqual([]);
  });

  test('with Converses: the shared one, without money; someone else\'s private one: 0 rows', async () => {
    await setFacets(admin, snapshot.membershipId, { converses: 'view', diners: null });
    const rows = await bolosOf(limited, shared);
    expect(rows).toHaveLength(1);
    expect(Object.keys(rows[0]!).sort()).toEqual(BOLO_COLUMNS);
    expect(await bolosOf(limited, mine)).toEqual([]);

    const batch = await pgRpc<BoloRow[]>('conversations_bolos', limited, { p_conversation_ids: [shared, mine] });
    expect(batch.status, batch.error).toBe(200);
    expect((batch.data ?? []).map((b) => b.conversation_id)).toEqual([shared]);
  });

  test.skipIf(!externalEnvReady())('without access to the project (no read:performance): 0 rows', async () => {
    const ext = requireExternalEnv();
    const external = await login(ext.email, ext.password);
    expect(await bolosOf(external, shared)).toEqual([]);
  });

  test('«not this time» is written by its column grant and the derived relation says it', async () => {
    // La relación se relee por id: en la respuesta del PATCH ve la fila de
    // antes. Se escribe y se vuelve a leer, como hace la pantalla.
    const read = async () =>
      (
        await pgGet<{ relation: string; not_now_until: string | null }>(
          'conversation',
          admin,
          new URLSearchParams({ id: `eq.${shared}`, select: 'id,not_now_until,relation:conversation_relation' }),
        )
      ).rows[0];
    const only = new URLSearchParams({ id: `eq.${shared}` });
    try {
      const set = await pgPatch('conversation', admin, { not_now_at: new Date().toISOString(), not_now_until: '2099-01-01' }, only);
      expect(set.status).toBe(200);
      expect(await read()).toMatchObject({ relation: 'not_now', not_now_until: '2099-01-01' });
    } finally {
      const lifted = await pgPatch('conversation', admin, { not_now_at: null, not_now_until: null }, only);
      expect(lifted.status).toBe(200);
    }
    expect((await read())?.relation).not.toBe('not_now');
  });

  test('a day to write again needs «not this time»', async () => {
    const r = await pgPatch('conversation', admin, { not_now_until: '2099-01-01' }, new URLSearchParams({ id: `eq.${shared}` }));
    expect(r.status).toBe(400);
  });

  test('the relation of a conversation the caller cannot read is not answered', async () => {
    const r = await pgGet<{ id: string; relation: string | null }>(
      'conversation',
      limited,
      new URLSearchParams({ id: `eq.${mine}`, select: 'id,relation:conversation_relation' }),
    );
    expect(r.rows).toEqual([]);
  });
});
