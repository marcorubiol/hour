/**
 * RLS regression: hilos internos con facetas (ADR-106; migración
 * 20261014100000_comms_threads; plan build/plans/2026-10-14-comms-threads.md,
 * fase 1, lista de tests 1 a 17).
 *
 * Todo ocurre en el espacio `playwright`, entre sus dos proyectos
 * (`zzz-e2e-collab`, donde la fixture limitada tiene membresía, y
 * `zzz-rls-foreign-project`, donde no). Cada fichero es dueño de sus filas:
 * crea sus bolos, funciones y conversación, y los borra al final; sus mensajes
 * se borran (blando) y los hilos quedan colgando de bolos borrados, que nadie
 * lee. El acceso de la fixture limitada se restaura como estaba.
 *
 * Lo que prueba:
 *   - lectura: General por el acceso al contenedor; faceta por verla en la
 *     cadena (proyecto -> bolo); conversación por leer la conversación y su
 *     privacidad; un ajeno no lee nada;
 *   - escritura solo por RPC, con el que llama como autor; la faceta tiene que
 *     existir en el nivel, ser del espacio y estar activa;
 *   - la función nombrada cuelga del bolo del hilo;
 *   - thread_audience y bolo_board (sin dinero) solo a quien toca;
 *   - thread_read, solo la fila propia.
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
  pgPost,
  pgRpc,
  projectAccess,
  requireEnv,
  requireExternalEnv,
  requireLimitedEnv,
  restoreProjectAccess,
  standardFacetIds,
  type ProjectAccess,
} from './_helpers';

const RUN = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const NOWHERE = '00000000-0000-4000-8000-000000000000';

interface MessageRow {
  id: string;
  thread_id: string;
  workspace_id: string;
  author_id: string | null;
  performance_id: string | null;
  body: string;
  edited_at: string | null;
}

interface ThreadRow {
  id: string;
  workspace_id: string;
  bolo_id: string | null;
  conversation_id: string | null;
  facet_id: string | null;
}

interface BoardThread {
  thread_id: string | null;
  facet_id: string | null;
  facet_key: string | null;
  message_count: number;
  unread_count: number;
}

interface Board {
  bolo: { id: string; venue_name: string | null } | null;
  performances: { id: string; performed_at: string }[];
  threads: BoardThread[];
}

interface Audience {
  count: number;
  reason: { kind: string; facet_key?: string };
  people: { user_id: string; name: string | null }[];
}

const one = <T>(data: T | T[] | null): T | undefined => (Array.isArray(data) ? data[0] : (data ?? undefined));

describe.skipIf(!envReady())('RLS: hilos con facetas (ADR-106)', () => {
  let adminJwt: string;
  let adminUserId: string;
  let workspaceId: string;
  let homeProjectId: string;
  let foreignProjectId: string;
  let facets: Record<string, string> = {};
  let boloId: string;
  let otherBoloId: string;
  let foreignBoloId: string;
  let perfA: string;
  let perfB: string;
  let otherPerf: string;
  let foreignPerf: string;
  let conversationId: string;
  const created: { id: string; jwt: () => string }[] = [];

  async function post(
    jwt: string,
    args: { kind?: string; anchor: string; body?: string; facet?: string | null; performance?: string | null },
  ) {
    const res = await pgRpc<MessageRow | MessageRow[]>('post_message', jwt, {
      p_anchor_kind: args.kind ?? 'bolo',
      p_anchor_id: args.anchor,
      p_body: args.body ?? `RLS hilo ${RUN}`,
      p_facet_id: args.facet ?? null,
      p_performance_id: args.performance ?? null,
    });
    const row = one(res.data);
    if (res.status === 200 && row) created.push({ id: row.id, jwt: () => (row.author_id === adminUserId ? adminJwt : limitedJwtRef) });
    return { status: res.status, row, error: res.error };
  }

  /** Los hilos de un ancla que el que llama ve por PostgREST. */
  async function threadsOf(jwt: string, column: 'bolo_id' | 'conversation_id', id: string) {
    const res = await pgGet<ThreadRow>(
      'thread',
      jwt,
      new URLSearchParams({ [column]: `eq.${id}`, select: 'id,workspace_id,bolo_id,conversation_id,facet_id' }),
    );
    return res.rows;
  }

  async function messagesOf(jwt: string, threadId: string) {
    const res = await pgGet<MessageRow>(
      'message',
      jwt,
      new URLSearchParams({ thread_id: `eq.${threadId}`, select: 'id,thread_id,workspace_id,author_id,body' }),
    );
    return res.rows;
  }

  async function board(jwt: string, performanceId: string) {
    return pgRpc<Board>('bolo_board', jwt, { p_performance_id: performanceId });
  }

  let limitedJwtRef = '';

  beforeAll(async () => {
    const admin = requireEnv();
    adminJwt = await login(admin.email, admin.password);
    adminUserId = String(decodeJwt(adminJwt).sub);

    const projects = await pgGet<{ id: string; slug: string; workspace_id: string }>(
      'project',
      adminJwt,
      new URLSearchParams({
        slug: 'in.(zzz-e2e-collab,zzz-rls-foreign-project)',
        select: 'id,slug,workspace_id',
      }),
    );
    homeProjectId = projects.rows.find((p) => p.slug === 'zzz-e2e-collab')!.id;
    foreignProjectId = projects.rows.find((p) => p.slug === 'zzz-rls-foreign-project')!.id;
    workspaceId = projects.rows.find((p) => p.slug === 'zzz-e2e-collab')!.workspace_id;
    expect(homeProjectId && foreignProjectId && workspaceId).toBeTruthy();

    facets = await standardFacetIds(adminJwt);

    const bolo = async (projectId: string, label: string) => {
      const res = await pgRpc<{ id: string }>('create_bolo', adminJwt, {
        p_project_id: projectId,
        p_venue_name: `RLS hilos ${label} ${RUN}`,
        p_fee_amount: 1234,
        p_status: 'proposed',
      });
      expect(res.status, res.error).toBe(200);
      return one(res.data)!.id;
    };
    const performance = async (projectId: string, date: string, boloRef: string) => {
      const res = await pgRpc<{ id: string }>('create_performance', adminJwt, {
        p_project_id: projectId,
        p_performed_at: date,
        p_venue_name: `RLS hilos ${RUN}`,
        p_bolo_id: boloRef,
      });
      expect(res.status, res.error).toBe(200);
      return one(res.data)!.id;
    };

    boloId = await bolo(homeProjectId, 'home');
    otherBoloId = await bolo(homeProjectId, 'other');
    foreignBoloId = await bolo(foreignProjectId, 'foreign');
    perfA = await performance(homeProjectId, '2027-03-12', boloId);
    perfB = await performance(homeProjectId, '2027-03-13', boloId);
    otherPerf = await performance(homeProjectId, '2027-03-20', otherBoloId);
    foreignPerf = await performance(foreignProjectId, '2027-03-21', foreignBoloId);

    const conv = await pgRpc<{ id: string }>('create_conversation', adminJwt, {
      p_project_id: homeProjectId,
      p_full_name: `RLS Hilos ${RUN}`,
      p_email: `rls-hilos-${RUN}@example.test`,
    });
    expect(conv.status, conv.error).toBe(200);
    conversationId = one(conv.data)!.id;
    // Compartida para empezar; el test de privacidad la cierra.
    await pgPatch('conversation', adminJwt, { private_to: null }, new URLSearchParams({ id: `eq.${conversationId}` }));
  });

  afterAll(async () => {
    for (const m of created) await pgRpc('delete_message', m.jwt(), { p_message_id: m.id });
    for (const id of [perfA, perfB, otherPerf, foreignPerf]) {
      if (id) await pgRpc('delete_performance', adminJwt, { p_performance_id: id });
    }
    for (const id of [boloId, otherBoloId, foreignBoloId]) {
      if (id) await pgRpc('delete_bolo', adminJwt, { p_bolo_id: id });
    }
    if (conversationId) await pgRpc('delete_conversation', adminJwt, { p_conversation_id: conversationId });
  });

  test('8 · post_message firma con el que llama; el cuerpo vacío o de más de 10.000 no entra', async () => {
    const ok = await post(adminJwt, { anchor: boloId, body: `  General ${RUN}  ` });
    expect(ok.status, ok.error).toBe(200);
    expect(ok.row).toMatchObject({ author_id: adminUserId, body: `General ${RUN}`, workspace_id: workspaceId });

    const forged = await pgRpc('post_message', adminJwt, {
      p_anchor_kind: 'bolo',
      p_anchor_id: boloId,
      p_body: 'firmado por otro',
      p_author_id: NOWHERE,
    });
    expect(forged.status, 'no hay parámetro de autor').toBeGreaterThanOrEqual(400);

    expect((await post(adminJwt, { anchor: boloId, body: '   ' })).status).toBe(400);
    expect((await post(adminJwt, { anchor: boloId, body: 'x'.repeat(10_001) })).status).toBe(400);
    expect((await post(adminJwt, { kind: 'project', anchor: homeProjectId })).status, 'este corte abre bolo y conversación').toBe(400);
  });

  test('11 · el mensaje y su hilo son del espacio del bolo', async () => {
    const res = await post(adminJwt, { anchor: boloId, facet: facets.tecnica, body: `Técnica ${RUN}` });
    expect(res.status, res.error).toBe(200);
    const [thread] = (await threadsOf(adminJwt, 'bolo_id', boloId)).filter((t) => t.facet_id === facets.tecnica);
    expect(thread).toMatchObject({ workspace_id: workspaceId, bolo_id: boloId });
    expect(res.row).toMatchObject({ thread_id: thread.id, workspace_id: workspaceId });
  });

  test('9 · nadie escribe hilos ni mensajes por la API, ni el owner', async () => {
    const msg = await post(adminJwt, { anchor: boloId, body: `intacto ${RUN}` });
    expect(msg.status).toBe(200);
    const threadId = msg.row!.thread_id;

    expect((await pgPost('thread', adminJwt, { workspace_id: workspaceId, bolo_id: otherBoloId })).status).toBeGreaterThanOrEqual(400);
    expect(
      (await pgPost('message', adminJwt, { thread_id: threadId, workspace_id: workspaceId, body: 'directo' })).status,
    ).toBeGreaterThanOrEqual(400);
    const patch = await pgPatch('message', adminJwt, { body: 'cambiado' }, new URLSearchParams({ id: `eq.${msg.row!.id}` }));
    expect(patch.status === 200 ? patch.rows.length : 0).toBe(0);
    const patchThread = await pgPatch('thread', adminJwt, { bolo_id: otherBoloId }, new URLSearchParams({ id: `eq.${threadId}` }));
    expect(patchThread.status === 200 ? patchThread.rows.length : 0).toBe(0);

    const env = requireEnv();
    for (const table of ['message', 'thread']) {
      const id = table === 'message' ? msg.row!.id : threadId;
      const del = await fetch(`${env.url}/rest/v1/${table}?id=eq.${id}`, {
        method: 'DELETE',
        headers: { apikey: env.anon, Authorization: `Bearer ${adminJwt}`, Prefer: 'return=minimal' },
      });
      expect(del.status, `DELETE ${table}`).toBeGreaterThanOrEqual(400);
    }

    const still = await messagesOf(adminJwt, threadId);
    expect(still.find((m) => m.id === msg.row!.id)?.body).toBe(`intacto ${RUN}`);
  });

  test('7 · una faceta que no existe en el nivel, o que no existe, no tiene hilo', async () => {
    expect((await post(adminJwt, { anchor: boloId, facet: facets.converses })).status, 'Converses no está en el bolo').toBe(403);
    expect((await post(adminJwt, { anchor: boloId, facet: NOWHERE })).status).toBe(403);
    const audience = await pgRpc('thread_audience', adminJwt, {
      p_anchor_kind: 'bolo',
      p_anchor_id: boloId,
      p_facet_id: facets.converses,
    });
    expect(audience.status).toBe(403);
  });

  test('13 · la función nombrada cuelga del bolo del hilo', async () => {
    const ok = await post(adminJwt, { anchor: boloId, facet: facets.tecnica, performance: perfB, body: `sáb ${RUN}` });
    expect(ok.status, ok.error).toBe(200);
    expect(ok.row?.performance_id).toBe(perfB);

    expect((await post(adminJwt, { anchor: boloId, performance: otherPerf })).status, 'función de otro bolo').toBe(400);
    expect((await post(adminJwt, { anchor: boloId, performance: NOWHERE })).status).toBe(400);
    expect(
      (await post(adminJwt, { kind: 'conversation', anchor: conversationId, performance: perfA })).status,
      'un hilo de conversación no nombra funciones',
    ).toBe(400);
  });

  test('15 · bolo_board: el bolo sin dinero, sus funciones y los hilos legibles', async () => {
    const res = await board(adminJwt, perfA);
    expect(res.status, res.error).toBe(200);
    const b = res.data!;
    expect(b.bolo?.id).toBe(boloId);
    expect(b.performances.map((p) => p.id).sort()).toEqual([perfA, perfB].sort());
    const raw = JSON.stringify(b);
    for (const money of ['fee_amount', 'fee_currency', '"status"', 'conversation_id', 'payer']) {
      expect(raw, money).not.toContain(money);
    }
    // General primero; después las facetas del bolo, Converses no.
    expect(b.threads[0]).toMatchObject({ facet_id: null });
    const keys = b.threads.map((t) => t.facet_key);
    for (const key of ['materials', 'tecnica', 'logistica', 'full_de_ruta', 'comidas', 'diners']) {
      expect(keys, key).toContain(key);
    }
    expect(keys).not.toContain('converses');
    const tecnica = b.threads.find((t) => t.facet_key === 'tecnica')!;
    expect(tecnica.thread_id).toBeTruthy();
    expect(tecnica.message_count).toBeGreaterThanOrEqual(1);
    expect(tecnica.unread_count, 'lo propio no es no leído').toBe(0);

    const noBolo = await pgRpc<{ id: string }>('create_performance', adminJwt, {
      p_project_id: homeProjectId,
      p_performed_at: '2027-03-30',
      p_venue_name: `RLS hilos sin bolo ${RUN}`,
    });
    expect(noBolo.status).toBe(200);
    try {
      const empty = await board(adminJwt, one(noBolo.data)!.id);
      expect(empty.data).toEqual({ bolo: null, performances: [], threads: [] });
    } finally {
      await pgRpc('delete_performance', adminJwt, { p_performance_id: one(noBolo.data)!.id });
    }
  });

  test('6 · una faceta desactivada en el espacio no se lista, no se escribe y lo escrito deja de leerse', async () => {
    const key = { workspace_id: `eq.${workspaceId}`, facet_id: `eq.${facets.materials}` };
    const before = await pgGet<{ active: boolean }>('workspace_facet_setting', adminJwt, new URLSearchParams({ ...key, select: 'active' }));
    const had = before.rows[0];
    const written = await post(adminJwt, { anchor: boloId, facet: facets.materials, body: `antes de desactivar ${RUN}` });
    if (!had || had.active) expect(written.status, written.error).toBe(200);
    try {
      if (had) {
        await pgPatch('workspace_facet_setting', adminJwt, { active: false }, new URLSearchParams(key));
      } else {
        const ins = await pgPost('workspace_facet_setting', adminJwt, {
          workspace_id: workspaceId,
          facet_id: facets.materials,
          active: false,
        });
        expect(ins.status).toBe(201);
      }
      const b = await board(adminJwt, perfA);
      expect(b.data!.threads.map((t) => t.facet_key)).not.toContain('materials');
      expect((await post(adminJwt, { anchor: boloId, facet: facets.materials })).status).toBe(403);
      if (written.row) {
        expect(await messagesOf(adminJwt, written.row.thread_id), 'GET /message').toHaveLength(0);
        expect(await threadsOf(adminJwt, 'bolo_id', boloId)).not.toContainEqual(
          expect.objectContaining({ facet_id: facets.materials }),
        );
      }
    } finally {
      // Materials vuelve como estaba (activa si no había ajuste).
      const restored = await pgPatch(
        'workspace_facet_setting',
        adminJwt,
        { active: had ? had.active : true },
        new URLSearchParams(key),
      );
      expect(restored.status).toBe(200);
    }
    if (!had || had.active) {
      expect((await post(adminJwt, { anchor: boloId, facet: facets.materials })).status).toBe(200);
      if (written.row) expect(await messagesOf(adminJwt, written.row.thread_id)).not.toHaveLength(0);
    }
  });

  test('anclas borradas en blando: el hilo y sus mensajes desaparecen y no se escribe', async () => {
    const res = await pgRpc<{ id: string }>('create_bolo', adminJwt, {
      p_project_id: homeProjectId,
      p_venue_name: `RLS hilos borrado ${RUN}`,
      p_status: 'proposed',
    });
    expect(res.status, res.error).toBe(200);
    const doomed = one(res.data)!.id;
    const msg = await post(adminJwt, { anchor: doomed, body: `antes de borrar ${RUN}` });
    expect(msg.status).toBe(200);
    expect(await threadsOf(adminJwt, 'bolo_id', doomed)).toHaveLength(1);

    expect((await pgRpc('delete_bolo', adminJwt, { p_bolo_id: doomed })).status).toBe(204);
    expect(await threadsOf(adminJwt, 'bolo_id', doomed)).toHaveLength(0);
    expect(await messagesOf(adminJwt, msg.row!.thread_id)).toHaveLength(0);
    expect((await post(adminJwt, { anchor: doomed })).status).toBe(403);
  });

  test('9b · authenticated no tiene privilegio de escritura en las tres tablas', async () => {
    // Sin grant, PostgREST responde «permission denied for table», no una
    // violación de política: el privilegio no existe (TRUNCATE, en el SQL local).
    const env = requireEnv();
    for (const table of ['thread', 'message', 'thread_read']) {
      const ins = await fetch(`${env.url}/rest/v1/${table}`, {
        method: 'POST',
        headers: { apikey: env.anon, Authorization: `Bearer ${adminJwt}`, 'content-type': 'application/json', Prefer: 'return=minimal' },
        body: JSON.stringify({}),
      });
      expect(ins.status, `INSERT ${table}`).toBe(403);
      expect(await ins.text(), `INSERT ${table}`).toContain('permission denied for table');
      for (const method of ['PATCH', 'DELETE']) {
        const res = await fetch(`${env.url}/rest/v1/${table}?${table === 'thread_read' ? 'thread_id' : 'id'}=eq.${NOWHERE}`, {
          method,
          headers: { apikey: env.anon, Authorization: `Bearer ${adminJwt}`, 'content-type': 'application/json', Prefer: 'return=minimal' },
          body: method === 'PATCH' ? JSON.stringify({ [table === 'thread_read' ? 'last_read_at' : 'updated_at']: new Date().toISOString() }) : undefined,
        });
        expect(res.status, `${method} ${table}`).toBe(403);
        expect(await res.text(), `${method} ${table}`).toContain('permission denied for table');
      }
    }
  });

  test('16 · anon no lee ni llama a nada', async () => {
    for (const table of ['thread', 'message', 'thread_read']) {
      const res = await pgGet(table, null, new URLSearchParams({ select: '*' }));
      expect(res.rows, table).toHaveLength(0);
    }
    const calls: [string, Record<string, unknown>][] = [
      ['post_message', { p_anchor_kind: 'bolo', p_anchor_id: boloId, p_body: 'anon' }],
      ['edit_message', { p_message_id: NOWHERE, p_body: 'anon' }],
      ['delete_message', { p_message_id: NOWHERE }],
      ['mark_thread_read', { p_thread_id: NOWHERE }],
      ['thread_audience', { p_anchor_kind: 'bolo', p_anchor_id: boloId }],
      ['bolo_board', { p_performance_id: perfA }],
    ];
    for (const [fn, args] of calls) {
      expect((await pgRpc(fn, null, args)).status, fn).toBeGreaterThanOrEqual(400);
    }
  });

  describe.skipIf(!externalEnvReady())('un login de otro espacio', () => {
    test('1 · no lee hilo ni mensaje de un bolo ajeno, y no escribe', async () => {
      const ext = requireExternalEnv();
      const jwt = await login(ext.email, ext.password);
      const general = await post(adminJwt, { anchor: boloId, body: `para nadie de fuera ${RUN}` });
      expect(general.status).toBe(200);

      expect(await threadsOf(jwt, 'bolo_id', boloId)).toHaveLength(0);
      expect(await messagesOf(jwt, general.row!.thread_id)).toHaveLength(0);
      expect((await post(jwt, { anchor: boloId })).status).toBe(403);
      expect((await post(jwt, { kind: 'conversation', anchor: conversationId })).status).toBe(403);
      expect((await board(jwt, perfA)).status).toBe(403);
      expect(
        (await pgRpc('thread_audience', jwt, { p_anchor_kind: 'bolo', p_anchor_id: boloId })).status,
      ).toBe(403);
      expect((await pgRpc('mark_thread_read', jwt, { p_thread_id: general.row!.thread_id })).status).toBe(403);
    });
  });

  describe.skipIf(!limitedEnvReady())('fixture limitada', () => {
    let limitedJwt: string;
    let limitedUserId: string;
    let snapshot: ProjectAccess;

    beforeAll(async () => {
      const limited = requireLimitedEnv();
      limitedJwt = await login(limited.email, limited.password);
      limitedJwtRef = limitedJwt;
      limitedUserId = String(decodeJwt(limitedJwt).sub);
      snapshot = await projectAccess(adminJwt, homeProjectId, limitedUserId);
    });

    afterAll(async () => {
      if (snapshot) await restoreProjectAccess(adminJwt, homeProjectId, limitedUserId, snapshot);
    });

    /** ¿Lee y escribe la limitada en este hilo del bolo de su proyecto? */
    async function reachable(facetKey: string | null): Promise<{ read: boolean; write: boolean }> {
      const facetId = facetKey ? facets[facetKey] : null;
      // El hilo existe: lo escribe el owner.
      expect((await post(adminJwt, { anchor: boloId, facet: facetId, body: `${facetKey ?? 'general'} ${RUN}` })).status).toBe(200);
      const visible = (await threadsOf(limitedJwt, 'bolo_id', boloId)).some((t) => t.facet_id === facetId);
      const write = (await post(limitedJwt, { anchor: boloId, facet: facetId })).status === 200;
      return { read: visible, write };
    }

    test('2 · un miembro del espacio sin membresía de proyecto no lee el General del bolo', async () => {
      const general = await post(adminJwt, { anchor: foreignBoloId, body: `ajeno ${RUN}` });
      expect(general.status).toBe(200);
      expect(await threadsOf(limitedJwt, 'bolo_id', foreignBoloId)).toHaveLength(0);
      expect(await messagesOf(limitedJwt, general.row!.thread_id)).toHaveLength(0);
      expect((await post(limitedJwt, { anchor: foreignBoloId })).status).toBe(403);
      expect((await board(limitedJwt, foreignPerf)).status).toBe(403);
    });

    test('3 · Mínim lee y escribe en el General; no lee Técnica ni Diners', async () => {
      await grantPreset(adminJwt, 'project', homeProjectId, limitedUserId, 'minim');
      expect(await reachable(null)).toEqual({ read: true, write: true });
      expect(await reachable('tecnica')).toEqual({ read: false, write: false });
      expect(await reachable('diners')).toEqual({ read: false, write: false });
    });

    test('15 · bolo_board sin leer dinero: funciones y hilos, sin caché ni estado', async () => {
      await grantPreset(adminJwt, 'project', homeProjectId, limitedUserId, 'minim');
      const res = await board(limitedJwt, perfA);
      expect(res.status, res.error).toBe(200);
      expect(res.data!.bolo?.id).toBe(boloId);
      expect(res.data!.performances.map((p) => p.id).sort()).toEqual([perfA, perfB].sort());
      expect(res.data!.threads.map((t) => t.facet_key)).toEqual([null]);
      const raw = JSON.stringify(res.data);
      expect(raw).not.toContain('1234');
      expect(raw).not.toContain('fee');
      // Por la API el bolo sigue siendo dinero.
      expect((await pgGet('bolo', limitedJwt, new URLSearchParams({ id: `eq.${boloId}`, select: 'id' }))).rows).toHaveLength(0);
    });

    test('4 · Equip lee Técnica, Logística y Comidas (proyecto -> bolo); no Diners', async () => {
      await grantPreset(adminJwt, 'project', homeProjectId, limitedUserId, 'equip');
      for (const key of ['tecnica', 'logistica', 'comidas', 'full_de_ruta', 'materials']) {
        expect(await reachable(key), key).toEqual({ read: true, write: true });
      }
      expect(await reachable('diners')).toEqual({ read: false, write: false });
    });

    test('5 · Coordinació lee Diners; Direcció y el owner, todo', async () => {
      await grantPreset(adminJwt, 'project', homeProjectId, limitedUserId, 'coordinacio');
      expect(await reachable('diners')).toEqual({ read: true, write: true });
      await grantPreset(adminJwt, 'project', homeProjectId, limitedUserId, 'direccio');
      // Los paquetes se expanden sobre las facetas estándar; las propias del
      // espacio se dan a mano, así que se comparan solo las estándar.
      const standardKeys = (b: Board) => b.threads.map((t) => t.facet_key).filter((k) => k === null || k in facets);
      const all = standardKeys((await board(adminJwt, perfA)).data!);
      expect(standardKeys((await board(limitedJwt, perfA)).data!)).toEqual(all);
      expect(all).toContain('diners');
    });

    test('10 · editar o borrar un mensaje ajeno da el mismo 403 que uno que no existe', async () => {
      await grantPreset(adminJwt, 'project', homeProjectId, limitedUserId, 'minim');
      const theirs = await post(adminJwt, { anchor: boloId, body: `del owner ${RUN}` });
      const mine = await post(limitedJwt, { anchor: boloId, body: `mío ${RUN}` });
      expect(theirs.status).toBe(200);
      expect(mine.status).toBe(200);

      for (const id of [theirs.row!.id, NOWHERE]) {
        expect((await pgRpc('edit_message', limitedJwt, { p_message_id: id, p_body: 'no' })).status).toBe(403);
        expect((await pgRpc('delete_message', limitedJwt, { p_message_id: id })).status).toBe(403);
      }

      const edited = await pgRpc<MessageRow>('edit_message', limitedJwt, { p_message_id: mine.row!.id, p_body: `editado ${RUN}` });
      expect(edited.status).toBe(200);
      expect(one(edited.data)).toMatchObject({ body: `editado ${RUN}` });
      expect(one(edited.data)!.edited_at).toBeTruthy();

      expect((await pgRpc('delete_message', limitedJwt, { p_message_id: mine.row!.id })).status).toBe(204);
      const after = await messagesOf(adminJwt, mine.row!.thread_id);
      expect(after.map((m) => m.id)).not.toContain(mine.row!.id);
      expect((await pgRpc('edit_message', limitedJwt, { p_message_id: mine.row!.id, p_body: 'otra' })).status).toBe(403);
    });

    test('12 · hilo de conversación: lo lee quien lee la conversación, y nadie más si es privada', async () => {
      await grantPreset(adminJwt, 'project', homeProjectId, limitedUserId, 'minim');
      const first = await post(adminJwt, { kind: 'conversation', anchor: conversationId, body: `equipo ${RUN}` });
      expect(first.status, first.error).toBe(200);
      expect(
        (await post(adminJwt, { kind: 'conversation', anchor: conversationId, facet: facets.tecnica })).status,
        'con faceta, rechazado',
      ).toBe(403);

      // Mínim no lee conversaciones.
      expect(await threadsOf(limitedJwt, 'conversation_id', conversationId)).toHaveLength(0);
      expect((await post(limitedJwt, { kind: 'conversation', anchor: conversationId })).status).toBe(403);

      // Coordinació edita Converses: lee y escribe.
      await grantPreset(adminJwt, 'project', homeProjectId, limitedUserId, 'coordinacio');
      expect(await threadsOf(limitedJwt, 'conversation_id', conversationId)).toHaveLength(1);
      expect((await post(limitedJwt, { kind: 'conversation', anchor: conversationId })).status).toBe(200);

      // Privada del owner: desaparece también para Coordinació.
      try {
        await pgPatch('conversation', adminJwt, { private_to: adminUserId }, new URLSearchParams({ id: `eq.${conversationId}` }));
        expect(await threadsOf(limitedJwt, 'conversation_id', conversationId)).toHaveLength(0);
        expect(await messagesOf(limitedJwt, first.row!.thread_id)).toHaveLength(0);
        expect((await post(limitedJwt, { kind: 'conversation', anchor: conversationId })).status).toBe(403);
        expect(await threadsOf(adminJwt, 'conversation_id', conversationId)).toHaveLength(1);
      } finally {
        await pgPatch('conversation', adminJwt, { private_to: null }, new URLSearchParams({ id: `eq.${conversationId}` }));
      }
    });

    test('14 · thread_audience: solo a quien lee el hilo, y cuenta a quien lo lee', async () => {
      const args = { p_anchor_kind: 'bolo', p_anchor_id: boloId, p_facet_id: facets.tecnica };
      await grantPreset(adminJwt, 'project', homeProjectId, limitedUserId, 'minim');
      expect((await pgRpc('thread_audience', limitedJwt, args)).status).toBe(403);
      const without = await pgRpc<Audience>('thread_audience', adminJwt, args);
      expect(without.status, without.error).toBe(200);
      expect(without.data!.reason).toMatchObject({ kind: 'facet', facet_key: 'tecnica' });
      expect(without.data!.count).toBe(without.data!.people.length);
      const ids = (a: Audience) => a.people.map((p) => p.user_id);
      expect(ids(without.data!)).toContain(adminUserId);
      expect(ids(without.data!)).not.toContain(limitedUserId);

      await grantPreset(adminJwt, 'project', homeProjectId, limitedUserId, 'equip');
      const withLimited = await pgRpc<Audience>('thread_audience', limitedJwt, args);
      expect(withLimited.status).toBe(200);
      expect(ids(withLimited.data!)).toEqual(expect.arrayContaining([adminUserId, limitedUserId]));
      expect(withLimited.data!.count).toBe(without.data!.count + 1);

      const general = await pgRpc<Audience>('thread_audience', limitedJwt, { p_anchor_kind: 'bolo', p_anchor_id: boloId });
      expect(general.data!.reason).toMatchObject({ kind: 'container' });
    });

    test('17 · thread_read: no leídos por persona, solo la fila propia', async () => {
      await grantPreset(adminJwt, 'project', homeProjectId, limitedUserId, 'minim');
      const generalOf = (b: Board) => b.threads.find((t) => t.facet_id === null)!;

      const theirs = await post(adminJwt, { anchor: boloId, body: `nuevo ${RUN}` });
      expect(theirs.status).toBe(200);
      const before = generalOf((await board(limitedJwt, perfA)).data!);
      expect(before.unread_count).toBeGreaterThanOrEqual(1);

      const marked = await pgRpc('mark_thread_read', limitedJwt, { p_thread_id: theirs.row!.thread_id });
      expect(marked.status, marked.error).toBe(200);
      expect(generalOf((await board(limitedJwt, perfA)).data!).unread_count).toBe(0);

      const own = await pgGet<{ user_id: string }>('thread_read', limitedJwt, new URLSearchParams({ select: 'user_id' }));
      expect(own.rows.length).toBeGreaterThan(0);
      expect(own.rows.every((r) => r.user_id === limitedUserId)).toBe(true);
      const seenByAdmin = await pgGet('thread_read', adminJwt, new URLSearchParams({ user_id: `eq.${limitedUserId}`, select: 'user_id' }));
      expect(seenByAdmin.rows).toHaveLength(0);

      // Un hilo que ya no lee no se marca.
      const tecnica = await post(adminJwt, { anchor: boloId, facet: facets.tecnica });
      expect((await pgRpc('mark_thread_read', limitedJwt, { p_thread_id: tecnica.row!.thread_id })).status).toBe(403);
    });

    test('17b · nadie escribe thread_read por la API, ni la fila propia ni la ajena', async () => {
      const general = await post(limitedJwt, { anchor: boloId, body: `leído ${RUN}` });
      expect(general.status).toBe(200);
      const threadId = general.row!.thread_id;
      for (const user of [limitedUserId, adminUserId]) {
        const ins = await pgPost('thread_read', limitedJwt, { thread_id: threadId, user_id: user, last_read_at: '2030-01-01T00:00:00Z' });
        expect(ins.status, user).toBeGreaterThanOrEqual(400);
      }
      const patch = await pgPatch(
        'thread_read',
        limitedJwt,
        { last_read_at: '2030-01-01T00:00:00Z' },
        new URLSearchParams({ thread_id: `eq.${threadId}`, user_id: `eq.${limitedUserId}` }),
      );
      expect(patch.status === 200 ? patch.rows.length : 0).toBe(0);
    });

    test('perder el acceso: lo escrito no se lee y no se borra (rebaja de paquete)', async () => {
      await grantPreset(adminJwt, 'project', homeProjectId, limitedUserId, 'equip');
      const mine = await post(limitedJwt, { anchor: boloId, facet: facets.tecnica, body: `de Equip ${RUN}` });
      expect(mine.status).toBe(200);
      await grantPreset(adminJwt, 'project', homeProjectId, limitedUserId, 'minim');
      expect(await messagesOf(limitedJwt, mine.row!.thread_id)).toHaveLength(0);
      expect((await pgRpc('delete_message', limitedJwt, { p_message_id: mine.row!.id })).status).toBe(403);
      expect((await pgRpc('edit_message', limitedJwt, { p_message_id: mine.row!.id, p_body: 'no' })).status).toBe(403);
      // Revocar no es borrar (ADR-085 §7): el mensaje sigue ahí para quien lee el hilo.
      expect((await messagesOf(adminJwt, mine.row!.thread_id)).map((m) => m.id)).toContain(mine.row!.id);
    });

    test('perder el acceso: revoke_membership de una membresía de bolo', async () => {
      // El bolo ajeno: sin membresía de proyecto, solo la de bolo da el acceso.
      const granted = await pgRpc<string>('grant_container_preset', adminJwt, {
        p_level: 'bolo',
        p_container_id: foreignBoloId,
        p_user_id: limitedUserId,
        p_preset: 'equip',
      });
      expect(granted.status, granted.error).toBe(200);
      let revoked = false;
      try {
        const mine = await post(limitedJwt, { anchor: foreignBoloId, facet: facets.tecnica, body: `de bolo ${RUN}` });
        expect(mine.status, mine.error).toBe(200);
        expect(await messagesOf(limitedJwt, mine.row!.thread_id)).toHaveLength(1);

        expect((await pgRpc('revoke_membership', adminJwt, { p_membership_id: granted.data })).status).toBeLessThan(300);
        revoked = true;
        expect(await messagesOf(limitedJwt, mine.row!.thread_id)).toHaveLength(0);
        expect(await threadsOf(limitedJwt, 'bolo_id', foreignBoloId)).toHaveLength(0);
        expect((await pgRpc('delete_message', limitedJwt, { p_message_id: mine.row!.id })).status).toBe(403);
      } finally {
        if (!revoked) await pgRpc('revoke_membership', adminJwt, { p_membership_id: granted.data });
      }
    });

    test('14b · thread_audience de una conversación privada solo cuenta al dueño', async () => {
      await grantPreset(adminJwt, 'project', homeProjectId, limitedUserId, 'coordinacio');
      const args = { p_anchor_kind: 'conversation', p_anchor_id: conversationId };
      const shared = await pgRpc<Audience>('thread_audience', adminJwt, args);
      expect(shared.status, shared.error).toBe(200);
      expect(shared.data!.people.map((p) => p.user_id)).toEqual(expect.arrayContaining([adminUserId, limitedUserId]));
      try {
        await pgPatch('conversation', adminJwt, { private_to: adminUserId }, new URLSearchParams({ id: `eq.${conversationId}` }));
        const privateOne = await pgRpc<Audience>('thread_audience', adminJwt, args);
        expect(privateOne.status).toBe(200);
        expect(privateOne.data).toMatchObject({ count: 1, reason: { kind: 'conversation' } });
        expect(privateOne.data!.people.map((p) => p.user_id)).toEqual([adminUserId]);
        expect((await pgRpc('thread_audience', limitedJwt, args)).status).toBe(403);
      } finally {
        await pgPatch('conversation', adminJwt, { private_to: null }, new URLSearchParams({ id: `eq.${conversationId}` }));
      }
    });
  });
});
