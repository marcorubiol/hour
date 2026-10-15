/**
 * RLS regression: «de qué se habla» (ADR-116; migración
 * 20261017100000_thread_feed; plan build/plans/2026-10-14-comms-threads.md,
 * fase 4).
 *
 * `thread_feed` lee los hilos con mensajes que el que llama puede leer, con la
 * misma regla que la política de `thread` (`private.thread_readable`). Lo que
 * prueba:
 *   - nunca sale un hilo que no lees: Mínim ve el General y no Técnica ni
 *     Diners; Equip, Técnica y no Diners; Coordinació, Diners y la
 *     conversación; un login de otro espacio, nada;
 *   - los que tienen nuevos van arriba, y leerlos los baja;
 *   - cada fila dice qué ficha abre (la próxima función del bolo, o la
 *     conversación) y nunca lleva dinero;
 *   - el alcance de la barra lateral (proyectos ∪ espacios) acota;
 *   - un hilo sin mensajes vivos no sale; anon no llama.
 *
 * Espacio `playwright`, entre sus dos proyectos. Cada fichero es dueño de sus
 * filas; el acceso de la fixture limitada se restaura como estaba.
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
  standardFacetIds,
  type ProjectAccess,
} from './_helpers';

const RUN = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

interface FeedRow {
  thread_id: string;
  workspace_id: string;
  project_id: string;
  anchor_kind: 'bolo' | 'conversation';
  anchor_id: string;
  facet_id: string | null;
  facet_key: string | null;
  message_count: number;
  unread_count: number;
  last_message_at: string;
  last_message: { author_id: string | null; body: string; created_at: string };
  bolo: {
    venue_name: string | null;
    first_day: string | null;
    last_day: string | null;
    performance_slug: string | null;
    performance_id: string | null;
  } | null;
  conversation: { title: string | null } | null;
}

const one = <T>(data: T | T[] | null): T | undefined => (Array.isArray(data) ? data[0] : (data ?? undefined));

describe.skipIf(!envReady())('RLS: «de qué se habla», thread_feed (ADR-116)', () => {
  let adminJwt: string;
  let workspaceId: string;
  let homeProjectId: string;
  let foreignProjectId: string;
  let facets: Record<string, string> = {};
  let boloId: string;
  let foreignBoloId: string;
  let pastPerf: string;
  let nextPerf: string;
  let laterPerf: string;
  let foreignPerf: string;
  let conversationId: string;
  const created: { id: string; jwt: () => string }[] = [];
  let limitedJwtRef = '';

  /** Un mensaje, y el hilo donde cayó. */
  async function post(jwt: string, anchor: string, facet: string | null = null, kind = 'bolo') {
    const res = await pgRpc<{ id: string; thread_id: string }>('post_message', jwt, {
      p_anchor_kind: kind,
      p_anchor_id: anchor,
      p_body: `RLS feed ${facet ?? 'general'} ${RUN}`,
      p_facet_id: facet,
    });
    expect(res.status, res.error).toBe(200);
    const row = one(res.data)!;
    created.push({ id: row.id, jwt: () => (jwt === adminJwt ? adminJwt : limitedJwtRef) });
    return row;
  }

  /** El feed del que llama, solo con los hilos de este fichero. */
  async function feed(jwt: string, args: Record<string, unknown> = {}) {
    const res = await pgRpc<FeedRow[]>('thread_feed', jwt, args);
    expect(res.status, res.error).toBe(200);
    const mine = new Set([boloId, foreignBoloId, conversationId]);
    return (res.data ?? []).filter((r) => mine.has(r.anchor_id));
  }

  const keyOf = (r: FeedRow) => `${r.anchor_kind}:${r.anchor_id === boloId ? 'home' : r.anchor_id === foreignBoloId ? 'foreign' : 'conv'}:${r.facet_key ?? 'general'}`;

  beforeAll(async () => {
    const admin = requireEnv();
    adminJwt = await login(admin.email, admin.password);

    const projects = await pgGet<{ id: string; slug: string; workspace_id: string }>(
      'project',
      adminJwt,
      new URLSearchParams({ slug: 'in.(zzz-e2e-collab,zzz-rls-foreign-project)', select: 'id,slug,workspace_id' }),
    );
    homeProjectId = projects.rows.find((p) => p.slug === 'zzz-e2e-collab')!.id;
    foreignProjectId = projects.rows.find((p) => p.slug === 'zzz-rls-foreign-project')!.id;
    workspaceId = projects.rows.find((p) => p.slug === 'zzz-e2e-collab')!.workspace_id;
    facets = await standardFacetIds(adminJwt);

    const bolo = async (projectId: string, label: string) => {
      const res = await pgRpc<{ id: string }>('create_bolo', adminJwt, {
        p_project_id: projectId,
        p_venue_name: `RLS feed ${label} ${RUN}`,
        p_fee_amount: 4321,
        p_status: 'proposed',
      });
      expect(res.status, res.error).toBe(200);
      return one(res.data)!.id;
    };
    const performance = async (projectId: string, date: string, boloRef: string) => {
      const res = await pgRpc<{ id: string }>('create_performance', adminJwt, {
        p_project_id: projectId,
        p_performed_at: date,
        p_venue_name: `RLS feed ${RUN}`,
        p_bolo_id: boloRef,
      });
      expect(res.status, res.error).toBe(200);
      return one(res.data)!.id;
    };

    boloId = await bolo(homeProjectId, 'home');
    foreignBoloId = await bolo(foreignProjectId, 'foreign');
    pastPerf = await performance(homeProjectId, '2020-05-02', boloId);
    nextPerf = await performance(homeProjectId, '2099-05-02', boloId);
    laterPerf = await performance(homeProjectId, '2099-05-03', boloId);
    foreignPerf = await performance(foreignProjectId, '2099-06-01', foreignBoloId);

    const conv = await pgRpc<{ id: string }>('create_conversation', adminJwt, {
      p_project_id: homeProjectId,
      p_full_name: `RLS Feed ${RUN}`,
      p_email: `rls-feed-${RUN}@example.test`,
    });
    expect(conv.status, conv.error).toBe(200);
    conversationId = one(conv.data)!.id;
    await pgPatch('conversation', adminJwt, { private_to: null }, new URLSearchParams({ id: `eq.${conversationId}` }));

    await post(adminJwt, boloId);
    await post(adminJwt, boloId, facets.tecnica);
    await post(adminJwt, boloId, facets.diners);
    await post(adminJwt, foreignBoloId);
    await post(adminJwt, conversationId, null, 'conversation');
  });

  afterAll(async () => {
    for (const m of created) await pgRpc('delete_message', m.jwt(), { p_message_id: m.id });
    for (const id of [pastPerf, nextPerf, laterPerf, foreignPerf]) {
      if (id) await pgRpc('delete_performance', adminJwt, { p_performance_id: id });
    }
    for (const id of [boloId, foreignBoloId]) if (id) await pgRpc('delete_bolo', adminJwt, { p_bolo_id: id });
    if (conversationId) await pgRpc('delete_conversation', adminJwt, { p_conversation_id: conversationId });
  });

  test('el owner ve sus cinco hilos; cada fila dice qué ficha abre, y nunca dinero', async () => {
    const rows = await feed(adminJwt);
    expect(rows.map(keyOf).sort()).toEqual(
      [
        'bolo:foreign:general',
        'bolo:home:diners',
        'bolo:home:general',
        'bolo:home:tecnica',
        'conversation:conv:general',
      ].sort(),
    );
    const home = rows.find((r) => keyOf(r) === 'bolo:home:general')!;
    expect(home).toMatchObject({ workspace_id: workspaceId, project_id: homeProjectId, message_count: 1, unread_count: 0 });
    expect(home.bolo).toMatchObject({ first_day: '2020-05-02', last_day: '2099-05-03', performance_id: nextPerf });
    expect(home.bolo?.performance_slug, 'la próxima función, no la pasada').toBeTruthy();
    expect(home.last_message.body).toBe(`RLS feed general ${RUN}`);

    const conv = rows.find((r) => r.anchor_kind === 'conversation')!;
    expect(conv).toMatchObject({ project_id: homeProjectId, bolo: null });
    expect(conv.conversation?.title).toBeTruthy();

    const raw = JSON.stringify(rows);
    for (const money of ['fee_amount', 'fee_currency', '4321', '"status"', 'payer']) expect(raw, money).not.toContain(money);
  });

  test('el alcance acota por proyecto o por espacio', async () => {
    const foreign = await feed(adminJwt, { p_project_ids: [foreignProjectId] });
    expect(foreign.map(keyOf)).toEqual(['bolo:foreign:general']);

    const space = await feed(adminJwt, { p_workspace_ids: [workspaceId] });
    expect(space).toHaveLength(5);

    const elsewhere = await feed(adminJwt, { p_workspace_ids: ['00000000-0000-4000-8000-000000000000'] });
    expect(elsewhere).toHaveLength(0);
  });

  test('anon no llama', async () => {
    const env = requireEnv();
    const res = await fetch(`${env.url}/rest/v1/rpc/thread_feed`, {
      method: 'POST',
      headers: { apikey: env.anon, Authorization: `Bearer ${env.anon}`, 'content-type': 'application/json' },
      body: '{}',
    });
    expect(res.status).toBeGreaterThanOrEqual(400);
  });

  describe.skipIf(!externalEnvReady())('un login de otro espacio', () => {
    test('no ve ningún hilo de playwright', async () => {
      const ext = requireExternalEnv();
      const jwt = await login(ext.email, ext.password);
      expect(await feed(jwt)).toHaveLength(0);
      expect(await feed(jwt, { p_workspace_ids: [workspaceId] })).toHaveLength(0);
    });
  });

  describe.skipIf(!limitedEnvReady())('fixture limitada', () => {
    let limitedJwt: string;
    let limitedUserId: string;
    let snapshot: ProjectAccess | null = null;

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

    test('Mínim: el General del bolo, ni Técnica ni Diners ni la conversación ni el bolo ajeno', async () => {
      await grantPreset(adminJwt, 'project', homeProjectId, limitedUserId, 'minim');
      expect((await feed(limitedJwt)).map(keyOf)).toEqual(['bolo:home:general']);
    });

    test('Equip: Técnica sí, Diners no', async () => {
      await grantPreset(adminJwt, 'project', homeProjectId, limitedUserId, 'equip');
      const keys = (await feed(limitedJwt)).map(keyOf);
      expect(keys).toContain('bolo:home:tecnica');
      expect(keys).not.toContain('bolo:home:diners');
      expect(keys).not.toContain('bolo:foreign:general');
    });

    test('Coordinació: Diners y la conversación', async () => {
      await grantPreset(adminJwt, 'project', homeProjectId, limitedUserId, 'coordinacio');
      const keys = (await feed(limitedJwt)).map(keyOf);
      expect(keys).toContain('bolo:home:diners');
      expect(keys).toContain('conversation:conv:general');
      expect(keys).not.toContain('bolo:foreign:general');
    });

    test('lo nuevo va arriba, y leerlo lo baja', async () => {
      await grantPreset(adminJwt, 'project', homeProjectId, limitedUserId, 'minim');
      // El owner escribió todo antes: el último que escribió fue la conversación.
      const before = await feed(adminJwt);
      expect(before.every((r) => r.unread_count === 0)).toBe(true);
      expect(keyOf(before[0])).toBe('conversation:conv:general');

      // La limitada escribe en el General del bolo: para el owner es nuevo y sube.
      const msg = await post(limitedJwt, boloId);
      const fresh = await feed(adminJwt);
      expect(keyOf(fresh[0])).toBe('bolo:home:general');
      expect(fresh[0]).toMatchObject({ unread_count: 1, message_count: 2 });
      expect(fresh[0].last_message.author_id).toBe(limitedUserId);

      // Para la que lo escribió no es nuevo.
      expect((await feed(limitedJwt))[0].unread_count).toBe(0);

      // Leído, sigue arriba por ser el último mensaje, sin nuevos.
      const read = await pgRpc('mark_thread_read', adminJwt, { p_thread_id: msg.thread_id });
      expect(read.status, read.error).toBe(200);
      const after = await feed(adminJwt);
      expect(after.every((r) => r.unread_count === 0)).toBe(true);
      expect(keyOf(after[0])).toBe('bolo:home:general');

      // Una novedad en un hilo más viejo pasa por delante del más reciente.
      await post(adminJwt, boloId, facets.tecnica);
      await grantPreset(adminJwt, 'project', homeProjectId, limitedUserId, 'equip');
      const forLimited = await feed(limitedJwt);
      expect(keyOf(forLimited[0])).toBe('bolo:home:tecnica');
      expect(forLimited[0].unread_count).toBeGreaterThanOrEqual(1);
    });
  });

  test('un hilo sin mensajes vivos no sale', async () => {
    const lone = await post(adminJwt, foreignBoloId, facets.tecnica);
    expect((await feed(adminJwt)).map(keyOf)).toContain('bolo:foreign:tecnica');
    const del = await pgRpc('delete_message', adminJwt, { p_message_id: lone.id });
    expect(del.status, del.error).toBe(204);
    expect((await feed(adminJwt)).map(keyOf)).not.toContain('bolo:foreign:tecnica');
  });
});
