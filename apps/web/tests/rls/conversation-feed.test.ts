/**
 * RLS regression: la lectura común de Conversaciones (ADR-138, fase 3 de
 * etiquetas; migración 20261021100000_conversation_feed; plan
 * `build/plans/2026-10-19-conversations-tags.md` § 5).
 *
 * `conversation_feed` mezcla dos fuentes en una RPC SECURITY DEFINER, que es
 * justo donde se cuela una fila. Lo que fija este fichero:
 *   - para cada usuario fixture (owner, la limitada en Mínim, Equip y
 *     Coordinació, un login de otro espacio), los ids del feed son EXACTAMENTE
 *     la unión de lo que le dan `conversation` y `thread` por PostgREST con su
 *     JWT (hilos de bolo o de conversación vivos, con mensajes vivos; el hilo
 *     de una conversación va dentro de su fila, `thread_id`);
 *   - una privada ajena: ni la fila, ni sus etiquetas, ni sus no leídos, ni su
 *     nombre, tampoco filtrando por su etiqueta o buscándola;
 *   - la regla de no leídos: un correo entrante cuenta; uno automático no; lo
 *     que apuntaste tú a mano no es nuevo para ti, sí para el resto; marcar
 *     leída lo baja solo para quien la marca; los mensajes ajenos de su hilo
 *     se suman a la fila;
 *   - el orden: lo que tiene nuevos arriba;
 *   - la etiqueta acota (Prensa, Equipo) y la búsqueda lee las dos fuentes
 *     (la organización de una conversación, la sala de un bolo);
 *   - una clave mal formada es 400; anon no llama.
 *
 * Espacio `playwright`, proyecto `zzz-e2e-collab`; nunca toca `muk-cia` (todo
 * va acotado al espacio). Autolimpiante: borra sus conversaciones, su bolo y
 * sus mensajes, y deja el acceso de la limitada como estaba. Va rojo contra un
 * origen sin 20261021100000.
 */

import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import {
  decodeJwt,
  envReady,
  externalEnvReady,
  grantPreset,
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
  type ProjectAccess,
} from './_helpers';

const RUN = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

interface FeedConversation {
  kind: 'conversation';
  id: string;
  title: string | null;
  tags: string[];
  unread_count: number;
  event_unread: number;
  thread_unread: number;
  thread_id: string | null;
  due: boolean;
}
interface FeedThread {
  kind: 'thread';
  thread_id: string;
  anchor_kind: 'bolo' | 'conversation';
  anchor_id: string;
  unread_count: number;
}
type FeedRow = FeedConversation | FeedThread;
interface Feed {
  items: FeedRow[];
  more: boolean;
}

const one = <T>(data: T | T[] | null): T | undefined => (Array.isArray(data) ? data[0] : (data ?? undefined));

describe.skipIf(!envReady())('RLS: la lectura común, conversation_feed (ADR-138 fase 3)', () => {
  let admin: string;
  let adminSub: string;
  let workspaceId: string;
  let projectId: string;
  let liveBolos = new Set<string>();
  let tags: Record<string, string> = {};
  let shared = '';
  let quiet = '';
  let privateId = '';
  let boloId = '';
  let perfId = '';
  const messages: { id: string; jwt: () => string }[] = [];
  let limitedJwtRef = '';
  const ORG = (label: string) => `ZZZ RLS Feed ${label} ${RUN}`;
  const VENUE = `ZZZ RLS Feed Sala ${RUN}`;

  async function feed(jwt: string, args: Record<string, unknown> = {}): Promise<Feed> {
    const res = await pgRpc<Feed>('conversation_feed', jwt, { p_workspace_ids: [workspaceId], p_limit: 500, ...args });
    expect(res.status, res.error).toBe(200);
    return res.data!;
  }

  const conversationRow = (f: Feed, id: string) =>
    f.items.find((r): r is FeedConversation => r.kind === 'conversation' && r.id === id);

  async function createConversation(label: string): Promise<string> {
    const r = await pgRpc<{ id: string }>('create_conversation', admin, {
      p_project_id: projectId,
      p_organization_name: ORG(label),
    });
    expect(r.status, r.error).toBe(200);
    return one(r.data)!.id;
  }

  async function record(conversationId: string, args: Record<string, unknown>, jwt = admin) {
    const r = await pgRpc('record_conversation_event', jwt, {
      p_conversation_id: conversationId,
      p_kind: 'email',
      p_direction: 'inbound',
      p_source: 'email',
      ...args,
    });
    expect(r.status, r.error).toBe(200);
  }

  async function post(jwt: string, kind: 'bolo' | 'conversation', anchor: string) {
    const r = await pgRpc<{ id: string; thread_id: string }>('post_message', jwt, {
      p_anchor_kind: kind,
      p_anchor_id: anchor,
      p_body: `RLS feed ${RUN}`,
      p_facet_id: null,
    });
    expect(r.status, r.error).toBe(200);
    const row = one(r.data)!;
    messages.push({ id: row.id, jwt: () => (jwt === admin ? admin : limitedJwtRef) });
    return row;
  }

  /** Lo que la RLS le da a este JWT, con el mismo corte que el feed. */
  async function expectedIds(jwt: string): Promise<Set<string>> {
    const convs = await pgGet<{ id: string }>(
      'conversation',
      jwt,
      new URLSearchParams({ select: 'id', workspace_id: `eq.${workspaceId}` }),
    );
    expect(convs.status).toBe(200);
    const convIds = new Set(convs.rows.map((r) => r.id));
    const threads = await pgGet<{ id: string; bolo_id: string | null; conversation_id: string | null; msgs: { id: string }[] }>(
      'thread',
      jwt,
      new URLSearchParams({
        select: 'id,bolo_id,conversation_id,msgs:message(id)',
        workspace_id: `eq.${workspaceId}`,
        last_message_at: 'not.is.null',
        or: '(bolo_id.not.is.null,conversation_id.not.is.null)',
      }),
    );
    expect(threads.status).toBe(200);
    const out = new Set(convIds);
    for (const t of threads.rows) {
      if (t.msgs.length === 0) continue;
      const anchorLive = t.conversation_id ? convIds.has(t.conversation_id) : liveBolos.has(t.bolo_id!);
      if (anchorLive) out.add(t.id);
    }
    return out;
  }

  function feedIds(f: Feed): Set<string> {
    const out = new Set<string>();
    for (const r of f.items) {
      if (r.kind === 'conversation') {
        out.add(r.id);
        if (r.thread_id) out.add(r.thread_id);
      } else out.add(r.thread_id);
    }
    return out;
  }

  async function sameAsRls(jwt: string) {
    const f = await feed(jwt);
    expect(f.more, 'the fixture space fits one page').toBe(false);
    expect([...feedIds(f)].sort()).toEqual([...(await expectedIds(jwt))].sort());
    return f;
  }

  beforeAll(async () => {
    const env = requireEnv();
    admin = await login(env.email, env.password);
    adminSub = String(decodeJwt(admin).sub);

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

    const vocab = await pgGet<{ id: string; key: string }>(
      'conversation_tag',
      admin,
      new URLSearchParams({ workspace_id: 'is.null', select: 'id,key' }),
    );
    tags = Object.fromEntries(vocab.rows.map((t) => [t.key, t.id]));

    shared = await createConversation('Shared');
    quiet = await createConversation('Quiet');
    privateId = await createConversation('Private');
    for (const id of [shared, quiet]) {
      const r = await pgPatch('conversation', admin, { private_to: null }, new URLSearchParams({ id: `eq.${id}` }));
      expect(r.status).toBe(200);
    }
    const priv = await pgPatch<{ id: string }>('conversation', admin, { private_to: adminSub }, new URLSearchParams({ id: `eq.${privateId}` }));
    expect(priv.rows).toHaveLength(1);
    expect((await pgRpc('set_conversation_tags', admin, { p_conversation_id: privateId, p_tag_ids: [tags.press] })).status).toBe(200);
    expect((await pgRpc('set_conversation_tags', admin, { p_conversation_id: shared, p_tag_ids: [tags.press] })).status).toBe(200);
    // The private one has news from outside: its unread must not travel.
    await record(privateId, {});

    const bolo = await pgRpc<{ id: string }>('create_bolo', admin, {
      p_project_id: projectId,
      p_venue_name: VENUE,
      p_fee_amount: 1234,
      p_status: 'proposed',
    });
    expect(bolo.status, bolo.error).toBe(200);
    boloId = one(bolo.data)!.id;
    const perf = await pgRpc<{ id: string }>('create_performance', admin, {
      p_project_id: projectId,
      p_performed_at: '2099-05-02',
      p_venue_name: VENUE,
      p_bolo_id: boloId,
    });
    expect(perf.status, perf.error).toBe(200);
    perfId = one(perf.data)!.id;
    await post(admin, 'bolo', boloId);

    // Live bolos as the owner sees them (bolo_select asks for Diners): a
    // thread of a deleted bolo is not on the feed, whoever reads it.
    const bolos = await pgGet<{ id: string }>(
      'bolo',
      admin,
      new URLSearchParams({ select: 'id', workspace_id: `eq.${workspaceId}`, deleted_at: 'is.null' }),
    );
    expect(bolos.status).toBe(200);
    liveBolos = new Set(bolos.rows.map((b) => b.id));
  });

  afterAll(async () => {
    for (const m of messages) await pgRpc('delete_message', m.jwt(), { p_message_id: m.id });
    if (perfId) await pgRpc('delete_performance', admin, { p_performance_id: perfId });
    if (boloId) await pgRpc('delete_bolo', admin, { p_bolo_id: boloId });
    for (const id of [shared, quiet, privateId]) {
      if (id) await pgRpc('delete_conversation', admin, { p_conversation_id: id });
    }
  });

  test('the owner: exactly what PostgREST gives, the private one included', async () => {
    const f = await sameAsRls(admin);
    expect(conversationRow(f, privateId)).toMatchObject({ tags: ['press'], event_unread: 1 });
    const raw = JSON.stringify(f);
    for (const money of ['fee_amount', 'fee_currency', '1234', 'payer']) expect(raw, money).not.toContain(money);
  });

  test('unread: an inbound mail counts, an automatic one does not, and reading clears it for whoever reads', async () => {
    expect(conversationRow(await feed(admin), shared)).toMatchObject({ event_unread: 0, unread_count: 0 });

    await record(shared, { p_metadata: { auto: true, subject: 'Out of office' } });
    expect(conversationRow(await feed(admin), shared)?.event_unread).toBe(0);

    await record(shared, { p_metadata: { subject: `Re: dates ${RUN}` } });
    let row = conversationRow(await feed(admin), shared)!;
    expect(row).toMatchObject({ event_unread: 1, unread_count: 1, due: true });

    // A call I wrote down myself is not news to me.
    await record(shared, { p_kind: 'call', p_source: 'manual' });
    expect(conversationRow(await feed(admin), shared)?.event_unread).toBe(1);

    // With news it goes above the quiet one.
    const order = (await feed(admin)).items.map((r) => (r.kind === 'conversation' ? r.id : r.thread_id));
    expect(order.indexOf(shared)).toBeLessThan(order.indexOf(quiet));

    const read = await pgRpc('mark_conversation_read', admin, { p_conversation_id: shared });
    expect(read.status, read.error).toBe(200);
    row = conversationRow(await feed(admin), shared)!;
    expect(row).toMatchObject({ event_unread: 0, unread_count: 0 });
  });

  test('the tag narrows, never opens; the search reads both sources', async () => {
    const press = await feed(admin, { p_tag: 'press' });
    expect(press.items.every((r) => r.kind === 'conversation' && r.tags.includes('press'))).toBe(true);
    expect(press.items.map((r) => (r.kind === 'conversation' ? r.id : '')).sort()).toEqual(expect.arrayContaining([shared, privateId]));
    expect(conversationRow(press, quiet)).toBeUndefined();

    // Untagged reads as Difusión.
    const sales = await feed(admin, { p_tag: 'sales' });
    expect(conversationRow(sales, quiet)).toBeDefined();
    expect(conversationRow(sales, shared)).toBeUndefined();

    const team = await feed(admin, { p_tag: 'team' });
    expect(team.items.every((r) => r.kind === 'thread')).toBe(true);
    expect(team.items.some((r) => r.kind === 'thread' && r.anchor_id === boloId)).toBe(true);

    const byOrg = await feed(admin, { p_q: ORG('Shared').toLowerCase() });
    expect(byOrg.items.map((r) => (r.kind === 'conversation' ? r.id : r.thread_id))).toEqual([shared]);
    const byVenue = await feed(admin, { p_q: VENUE.toUpperCase() });
    expect(byVenue.items).toHaveLength(1);
    expect(byVenue.items[0]).toMatchObject({ kind: 'thread', anchor_id: boloId });

    const bad = await pgRpc('conversation_feed', admin, { p_tag: 'Press!' });
    expect(bad.status).toBe(400);
  });

  test('anon does not call', async () => {
    const env = requireEnv();
    const res = await fetch(`${env.url}/rest/v1/rpc/conversation_feed`, {
      method: 'POST',
      headers: { apikey: env.anon, Authorization: `Bearer ${env.anon}`, 'content-type': 'application/json' },
      body: '{}',
    });
    expect(res.status).toBeGreaterThanOrEqual(400);
  });

  describe.skipIf(!externalEnvReady())('a login of another space', () => {
    test('nothing of playwright, as PostgREST', async () => {
      const ext = requireExternalEnv();
      const jwt = await login(ext.email, ext.password);
      const f = await sameAsRls(jwt);
      expect(f.items).toHaveLength(0);
      const everything = await pgRpc<Feed>('conversation_feed', jwt, { p_q: RUN });
      expect(everything.status).toBe(200);
      expect(everything.data?.items ?? []).toHaveLength(0);
    });
  });

  describe.skipIf(!limitedEnvReady())('the limited fixture', () => {
    let limited: string;
    let limitedSub: string;
    let snapshot: ProjectAccess | null = null;

    beforeAll(async () => {
      const lim = requireLimitedEnv();
      limited = await login(lim.email, lim.password);
      limitedJwtRef = limited;
      limitedSub = String(decodeJwt(limited).sub);
      snapshot = await projectAccess(admin, projectId, limitedSub);
    });

    afterAll(async () => {
      if (snapshot) await restoreProjectAccess(admin, projectId, limitedSub, snapshot);
    });

    for (const preset of ['minim', 'equip', 'coordinacio'] as const) {
      test(`${preset}: exactly what PostgREST gives; never the private one`, async () => {
        await grantPreset(admin, 'project', projectId, limitedSub, preset);
        const f = await sameAsRls(limited);
        const raw = JSON.stringify(f);
        expect(raw).not.toContain(privateId);
        expect(raw).not.toContain(ORG('Private'));
        // Not by its tag, nor by its name.
        const press = await feed(limited, { p_tag: 'press' });
        expect(JSON.stringify(press)).not.toContain(privateId);
        const byName = await feed(limited, { p_q: ORG('Private') });
        expect(byName.items).toHaveLength(0);
      });
    }

    test('unread is per person: my own note is news to the team, my read is not theirs, their thread message adds up', async () => {
      await grantPreset(admin, 'project', projectId, limitedSub, 'coordinacio');
      // Before: the inbound mail of the previous test (after its creation) and
      // the call the owner wrote down are news to her; the automatic one is not.
      const before = conversationRow(await feed(limited), shared);
      expect(before).toMatchObject({ event_unread: 2 });

      await pgRpc('mark_conversation_read', limited, { p_conversation_id: shared });
      expect(conversationRow(await feed(limited), shared)?.event_unread).toBe(0);

      // Her message in the conversation's team thread: news to the owner, inside the row.
      const msg = await post(limited, 'conversation', shared);
      const forOwner = conversationRow(await feed(admin), shared)!;
      expect(forOwner).toMatchObject({ thread_id: msg.thread_id, thread_unread: 1, unread_count: 1 });
      expect(conversationRow(await feed(limited), shared)).toMatchObject({ thread_unread: 0 });
      // And the thread does not come again as a row of its own.
      expect((await feed(admin)).items.some((r) => r.kind === 'thread' && r.thread_id === msg.thread_id)).toBe(false);
      // Under Equipo it does, as a thread.
      expect((await feed(admin, { p_tag: 'team' })).items.some((r) => r.kind === 'thread' && r.thread_id === msg.thread_id)).toBe(true);
    });
  });
});
