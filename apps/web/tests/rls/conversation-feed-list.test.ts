/**
 * RLS regression: la lista de Conversaciones lee una sola fuente
 * (`conversation_feed` en modo lista; migración 20261022200000; plan
 * `build/plans/2026-10-22-conversations-list.md` § 9, fase 3).
 *
 * Lo que fija este fichero:
 *   - los ids de la lista, todas sus páginas, son EXACTAMENTE lo que
 *     `conversation` da por PostgREST con el JWT de quien llama (owner y la
 *     limitada en Mínim y Coordinació); una privada ajena no sale, ni filtrando
 *     por su relación ni buscándola, ni en «las que coinciden»;
 *   - cada filtro y cada orden da las mismas filas, en el mismo orden, que las
 *     reglas de `$lib/conversation-overview` sobre la lectura del panel
 *     (`loadOverviewRows`): un bloque y su filtro no cuentan distinto (ADR-118
 *     § 7), aunque la lista lo resuelva en SQL;
 *   - `total`, `more` y la ventana (`p_offset`) cuadran; `p_ids_only` da id y
 *     proyecto;
 *   - lo de la lista sin `p_list`, Equipo en la lista o un valor que no existe
 *     son 400 (22023): el feed de Todas no cambia.
 *
 * El filtro de envío no va aquí (pide un envío con destinatarias, que este
 * fichero no sabe plantar sin enviar): se comparó en local con 2.000
 * conversaciones y un envío de 1.000 destinatarias (ver la migración).
 *
 * Espacio `playwright`, proyecto `zzz-e2e-collab`; nunca toca `muk-cia`.
 * Autolimpiante. Va rojo contra un origen sin 20261022200000.
 */

import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import {
  decodeJwt,
  envReady,
  grantPreset,
  limitedEnvReady,
  login,
  pgGet,
  pgPatch,
  pgRpc,
  projectAccess,
  requireEnv,
  requireLimitedEnv,
  restoreProjectAccess,
  type ProjectAccess,
} from './_helpers';
import { loadOverviewRows } from '$lib/server/conversation-overview';
import { NO_LINE, applyListFilter, dueReason, type ListFilter } from '$lib/conversation-overview';
import { sortByOrder, ORDERS, type Orden } from '$lib/conversation-order';
import { RELATIONS } from '$lib/conversation-relation';

const RUN = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const DAY = 86_400_000;
const ago = (days: number) => new Date(Date.now() - days * DAY).toISOString();

interface ListRow {
  kind: 'conversation';
  id: string;
  project_id: string;
  title: string | null;
  unread_count: number;
  last_at: string | null;
  created_at: string;
  relation: string;
}
interface ListPage {
  items: ListRow[];
  more: boolean;
  total: number;
}

const one = <T>(data: T | T[] | null): T | undefined => (Array.isArray(data) ? data[0] : (data ?? undefined));

describe.skipIf(!envReady())('RLS: la lista desde conversation_feed (plan de la lista, fase 3)', () => {
  let admin: string;
  let adminSub: string;
  let workspaceId: string;
  let projectId: string;
  const created: string[] = [];
  let privateId = '';
  const ORG = (label: string) => `ZZZ RLS List ${label} ${RUN}`;

  async function page(jwt: string, args: Record<string, unknown>): Promise<ListPage> {
    const res = await pgRpc<ListPage>('conversation_feed', jwt, { p_workspace_ids: [workspaceId], p_list: true, ...args });
    expect(res.status, res.error).toBe(200);
    return res.data!;
  }

  /** Todas las páginas de un filtro, en su orden. */
  async function all(jwt: string, args: Record<string, unknown> = {}): Promise<ListRow[]> {
    const out: ListRow[] = [];
    for (let offset = 0; ; offset += 500) {
      const p = await page(jwt, { ...args, p_limit: 500, p_offset: offset });
      out.push(...p.items);
      expect(p.total).toBeGreaterThanOrEqual(out.length);
      if (!p.more) {
        expect(p.total).toBe(out.length);
        return out;
      }
    }
  }

  async function postgrestIds(jwt: string): Promise<string[]> {
    const r = await pgGet<{ id: string }>(
      'conversation',
      jwt,
      new URLSearchParams({ select: 'id', workspace_id: `eq.${workspaceId}`, deleted_at: 'is.null' }),
    );
    expect(r.status).toBe(200);
    return r.rows.map((x) => x.id).sort();
  }

  async function createConversation(label: string): Promise<string> {
    const r = await pgRpc<{ id: string }>('create_conversation', admin, { p_project_id: projectId, p_organization_name: ORG(label) });
    expect(r.status, r.error).toBe(200);
    const id = one(r.data)!.id;
    created.push(id);
    const shared = await pgPatch('conversation', admin, { private_to: null }, new URLSearchParams({ id: `eq.${id}` }));
    expect(shared.status).toBe(200);
    return id;
  }

  async function record(id: string, direction: 'inbound' | 'outbound', daysAgo: number) {
    const r = await pgRpc('record_conversation_event', admin, {
      p_conversation_id: id,
      p_kind: 'email',
      p_direction: direction,
      p_source: 'email',
      p_occurred_at: ago(daysAgo),
      p_metadata: { subject: `RLS list ${RUN}` },
    });
    expect(r.status, r.error).toBe(200);
  }

  async function patch(id: string, body: Record<string, unknown>) {
    const r = await pgPatch('conversation', admin, body, new URLSearchParams({ id: `eq.${id}` }));
    expect(r.status).toBe(200);
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

    // Una de cada: te toca, les toca y se enfría, parada, seguimiento, no esta vez.
    await record(await createConversation('Reply'), 'inbound', 2);
    await record(await createConversation('Cold'), 'outbound', 25);
    const stalled = await createConversation('Stalled');
    await record(stalled, 'inbound', 50);
    await record(stalled, 'outbound', 40);
    await patch(await createConversation('FollowUp'), { next_action_at: ago(1), next_action_note: `RLS ${RUN}` });
    await patch(await createConversation('NotNow'), { not_now_at: new Date().toISOString() });
    privateId = await createConversation('Private');
    await patch(privateId, { private_to: adminSub });
    await record(privateId, 'inbound', 1);
  });

  afterAll(async () => {
    for (const id of created) await pgRpc('delete_conversation', admin, { p_conversation_id: id });
  });

  test('the owner: exactly what PostgREST gives, every page; total, window and ids only', async () => {
    const rows = await all(admin);
    expect(rows.map((r) => r.id).sort()).toEqual(await postgrestIds(admin));
    expect(rows.some((r) => r.id === privateId)).toBe(true);

    const first = await page(admin, { p_limit: 2 });
    const second = await page(admin, { p_limit: 2, p_offset: 2 });
    expect(first.total).toBe(rows.length);
    expect([...first.items, ...second.items].map((r) => r.id)).toEqual(rows.slice(0, 4).map((r) => r.id));
    expect(first.more).toBe(rows.length > 2);

    const ids = await page(admin, { p_ids_only: true });
    expect(ids.total).toBe(rows.length);
    expect(ids.items.slice(0, 5)).toEqual(rows.slice(0, 5).map((r) => ({ id: r.id, project_id: r.project_id })));
  });

  test('every filter and order: the same rows, in the same order, as the rules of the panel', async () => {
    const env = requireEnv();
    const now = new Date();
    const overview = await loadOverviewRows(
      { PUBLIC_SUPABASE_URL: env.url, PUBLIC_SUPABASE_ANON_KEY: env.anon },
      admin,
      { projectIds: [], workspaceIds: [workspaceId] },
    );
    overview.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    const facts = new Map((await all(admin)).map((r) => [r.id, r]));
    expect(overview.map((r) => r.id).sort()).toEqual([...facts.keys()].sort());

    const cases: { args: Record<string, unknown>; filter: ListFilter; orden?: Orden }[] = [
      ...ORDERS.map((orden) => ({ args: { p_order: orden }, filter: {}, orden })),
      ...RELATIONS.map((relacion) => ({ args: { p_relation: relacion }, filter: { relacion } })),
      { args: { p_turn: 'nuestro' }, filter: { turno: 'nuestro' } },
      { args: { p_turn: 'suyo' }, filter: { turno: 'suyo' } },
      ...(['caliente', 'fria', 'ronda', 'parada', 'sin-fecha'] as const).map((temp) => ({ args: { p_temp: temp }, filter: { temp } })),
      { args: { p_season: true }, filter: { temporada: true } },
      { args: { p_season: true, p_line: NO_LINE, p_order: 'nombre' }, filter: { temporada: true, linea: NO_LINE }, orden: 'nombre' },
      { args: { p_turn: 'nuestro', p_season: true }, filter: { turno: 'nuestro', temporada: true } },
    ];
    for (const c of cases) {
      const matched = applyListFilter(overview, c.filter, now);
      const expected =
        c.filter.turno || c.filter.temp
          ? matched.map((r) => r.id)
          : sortByOrder(
              matched.map((r) => {
                const due = dueReason(r, now);
                const f = facts.get(r.id)!;
                return {
                  id: r.id,
                  unread: f.unread_count,
                  due,
                  dueAt: due === 'reply' ? r.last!.occurred_at : due === 'follow_up' ? r.next_action_at : null,
                  lastAt: f.last_at ?? f.created_at,
                  title: f.title ?? '',
                  nextActionAt: r.next_action_at,
                };
              }),
              c.orden ?? 'pide',
            ).map((k) => k.id);
      const got = (await all(admin, c.args)).map((r) => r.id);
      expect(got, JSON.stringify(c.args)).toEqual(expected);
    }
  });

  test('the relation on each row is the one of the panel', async () => {
    const env = requireEnv();
    const now = new Date();
    const overview = await loadOverviewRows(
      { PUBLIC_SUPABASE_URL: env.url, PUBLIC_SUPABASE_ANON_KEY: env.anon },
      admin,
      { projectIds: [projectId], workspaceIds: [] },
    );
    const byId = new Map((await all(admin, {})).map((r) => [r.id, r.relation]));
    for (const r of overview.filter((x) => created.includes(x.id))) {
      const filtered = applyListFilter([r], { relacion: byId.get(r.id) as ListFilter['relacion'] }, now);
      expect(filtered, r.id).toHaveLength(1);
    }
  });

  test('list params without the list, team threads in the list or a value that does not exist: 400', async () => {
    for (const args of [
      { p_relation: 'talking' },
      { p_order: 'nombre' },
      { p_offset: 10 },
      { p_list: true, p_tag: 'team' },
      { p_list: true, p_order: 'random' },
      { p_list: true, p_temp: 'tibia' },
      { p_list: true, p_line: 'linea' },
      { p_list: true, p_mailout_pick: 'todos' },
    ]) {
      const r = await pgRpc('conversation_feed', admin, args);
      expect(r.status, JSON.stringify(args)).toBe(400);
    }
    // Todas, as before: no total, threads included.
    const feed = await pgRpc<{ items: unknown[]; more: boolean; total?: number }>('conversation_feed', admin, {
      p_workspace_ids: [workspaceId],
    });
    expect(feed.status).toBe(200);
    expect(feed.data?.total).toBeUndefined();
  });

  describe.skipIf(!limitedEnvReady())('the limited fixture', () => {
    let limited: string;
    let limitedSub: string;
    let snapshot: ProjectAccess | null = null;

    beforeAll(async () => {
      const lim = requireLimitedEnv();
      limited = await login(lim.email, lim.password);
      limitedSub = String(decodeJwt(limited).sub);
      snapshot = await projectAccess(admin, projectId, limitedSub);
    });

    afterAll(async () => {
      if (snapshot) await restoreProjectAccess(admin, projectId, limitedSub, snapshot);
    });

    for (const preset of ['minim', 'coordinacio'] as const) {
      test(`${preset}: exactly what PostgREST gives; never the private one`, async () => {
        await grantPreset(admin, 'project', projectId, limitedSub, preset);
        const rows = await all(limited);
        expect(rows.map((r) => r.id).sort()).toEqual(await postgrestIds(limited));
        for (const args of [{}, { p_relation: 'talking' }, { p_turn: 'nuestro' }, { p_q: ORG('Private') }, { p_ids_only: true }]) {
          const p = await page(limited, args);
          expect(JSON.stringify(p), JSON.stringify(args)).not.toContain(privateId);
        }
        expect((await page(limited, { p_q: ORG('Private') })).total).toBe(0);
      });
    }
  });
});
