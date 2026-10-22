import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { bulkPg, runConversationBulk } from '$lib/server/conversation-bulk';
import type { BulkRequest } from '$lib/conversation-bulk';
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
 * Acciones en bloque de la lista (plan `2026-10-22-conversations-list.md`
 * § 6.2, fase 2; `POST /api/conversations/bulk`). Sin migración: el lote es
 * `$lib/server/conversation-bulk` con el JWT de quien llama, y aquí se corre
 * el mismo módulo contra la base, como lo corre el Worker.
 *
 * Lo que fija:
 * - una privada ajena vuelve `not_found` y no cambia; quien lee sin editar,
 *   `forbidden` y no cambia; el lote no se aborta por ellas;
 * - nunca se escribe una conversación que no se pidió;
 * - etiquetar en bloque pone o quita una sin tocar las demás, y el deshacer
 *   deja lo de antes;
 * - el deshacer de «no esta vez» con los permisos de quien llama: tampoco
 *   devuelve nada a una que no edita.
 *
 * Fixture: `playwright`, proyecto `zzz-e2e-collab`. Nunca toca `muk-cia`.
 * Autolimpiante: borra sus conversaciones y deja el acceso del limitado y el
 * ajuste del espacio como estaban.
 */
const RUN = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

interface Row {
  id: string;
  not_now_at: string | null;
  next_action_note: string | null;
}

const one = <T>(data: T | T[] | null): T | undefined => (Array.isArray(data) ? data[0] : (data ?? undefined));

describe.skipIf(!envReady() || !limitedEnvReady())('conversation bulk actions (list plan § 6.2)', () => {
  let admin: string;
  let adminSub: string;
  let limited: string;
  let limitedSub: string;
  let workspaceId: string;
  let projectId: string;
  let snapshot: ProjectAccess;
  let originalSetting: boolean | undefined;
  let tags: Record<string, string> = {};
  let shared = '';
  let other = '';
  let mine = '';

  const env = () => {
    const e = requireEnv();
    return { PUBLIC_SUPABASE_URL: e.url, PUBLIC_SUPABASE_ANON_KEY: e.anon };
  };
  const bulk = (jwt: string, req: BulkRequest) => runConversationBulk(bulkPg(env(), jwt), req);

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
    const r = await pgRpc<{ id: string }>('create_conversation', admin, {
      p_project_id: projectId,
      p_organization_name: `ZZZ RLS Bulk ${label} ${RUN}`,
    });
    expect(r.status, r.error).toBe(200);
    return one(r.data)!.id;
  }

  async function read(id: string): Promise<Row> {
    const r = await pgGet<Row>(
      'conversation',
      admin,
      new URLSearchParams({ id: `eq.${id}`, select: 'id,not_now_at,next_action_note' }),
    );
    expect(r.rows).toHaveLength(1);
    return r.rows[0]!;
  }

  async function taggingsOf(id: string): Promise<string[]> {
    const r = await pgGet<{ tag_id: string }>(
      'conversation_tagging',
      admin,
      new URLSearchParams({ conversation_id: `eq.${id}`, select: 'tag_id' }),
    );
    return r.rows.map((x) => x.tag_id).sort();
  }

  beforeAll(async () => {
    const e = requireEnv();
    admin = await login(e.email, e.password);
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
    const vocab = await pgGet<{ id: string; key: string }>(
      'conversation_tag',
      admin,
      new URLSearchParams({ workspace_id: 'is.null', select: 'id,key' }),
    );
    tags = Object.fromEntries(vocab.rows.map((t) => [t.key, t.id]));

    await setSetting(false);
    shared = await createConversation('Shared');
    other = await createConversation('Other');
    mine = await createConversation('Mine');
    const priv = await pgPatch('conversation', admin, { private_to: adminSub }, new URLSearchParams({ id: `eq.${mine}` }));
    expect(priv.rows).toHaveLength(1);
    for (const id of [shared, other, mine]) {
      expect((await pgRpc('set_conversation_tags', admin, { p_conversation_id: id, p_tag_ids: [tags.sales] })).status).toBe(200);
    }
  });

  afterAll(async () => {
    for (const id of [shared, other, mine]) {
      if (id) await pgRpc('delete_conversation', admin, { p_conversation_id: id }).catch(() => undefined);
    }
    if (originalSetting !== undefined) await setSetting(originalSetting);
    if (snapshot) await restoreProjectAccess(admin, projectId, limitedSub, snapshot);
  });

  test('who reads without editing: forbidden for the shared one, not_found for a private one; nothing changes', async () => {
    await setFacets(admin, snapshot.membershipId, { converses: 'view' });
    const r = await bulk(limited, { action: 'not_now', ids: [shared, mine], until: null });
    expect(r.done).toEqual([]);
    expect(r.failed).toEqual([
      { id: shared, reason: 'forbidden' },
      { id: mine, reason: 'not_found' },
    ]);
    expect((await read(shared)).not_now_at).toBeNull();
    expect((await read(mine)).not_now_at).toBeNull();
  });

  test('who edits: the shared one changes, the private one does not, the lot is not aborted', async () => {
    await setFacets(admin, snapshot.membershipId, { converses: 'edit' });
    const r = await bulk(limited, { action: 'next_step', ids: [mine, shared], next_action_at: '2026-11-05', next_action_note: `bulk ${RUN}` });
    expect(r.done).toEqual([shared]);
    expect(r.failed).toEqual([{ id: mine, reason: 'not_found' }]);
    expect((await read(shared)).next_action_note).toBe(`bulk ${RUN}`);
    expect((await read(mine)).next_action_note).toBeNull();
    // Never one that was not asked for.
    expect((await read(other)).next_action_note).toBeNull();
    // And its undo puts back what there was.
    const back = await bulk(limited, { action: 'restore', items: r.undo });
    expect(back.done).toEqual([shared]);
    expect((await read(shared)).next_action_note).toBeNull();
  });

  test('«no esta vez» and its undo; the undo of a row not yours to edit does nothing', async () => {
    await setFacets(admin, snapshot.membershipId, { converses: 'edit' });
    const r = await bulk(admin, { action: 'not_now', ids: [shared, other], until: '2026-12-01' });
    expect(r.done.sort()).toEqual([shared, other].sort());
    expect((await read(shared)).not_now_at).not.toBeNull();

    // The limited user replays the undo of a private one it cannot read: not_found, untouched.
    const set = await bulk(admin, { action: 'not_now', ids: [mine], until: null });
    expect(set.done).toEqual([mine]);
    const sneak = await bulk(limited, { action: 'restore', items: set.undo });
    expect(sneak.done).toEqual([]);
    expect((await read(mine)).not_now_at).not.toBeNull();

    const back = await bulk(admin, { action: 'restore', items: [...r.undo, ...set.undo] });
    expect(back.failed).toEqual([]);
    for (const id of [shared, other, mine]) expect((await read(id)).not_now_at).toBeNull();
  });

  test('tagging puts or takes one tag and keeps the others; the undo leaves what there was', async () => {
    await setFacets(admin, snapshot.membershipId, { converses: 'edit' });
    const add = await bulk(limited, { action: 'tag', ids: [shared, mine], key: 'press', op: 'add' });
    expect(add.done).toEqual([shared]);
    expect(add.failed).toEqual([{ id: mine, reason: 'not_found' }]);
    expect(await taggingsOf(shared)).toEqual([tags.press, tags.sales].sort());
    expect(await taggingsOf(mine)).toEqual([tags.sales]);

    const remove = await bulk(limited, { action: 'tag', ids: [shared], key: 'sales', op: 'remove' });
    expect(remove.done).toEqual([shared]);
    expect(await taggingsOf(shared)).toEqual([tags.press]);
    // The last one stays.
    const last = await bulk(limited, { action: 'tag', ids: [shared], key: 'press', op: 'remove' });
    expect(last.failed).toEqual([{ id: shared, reason: 'last_tag' }]);

    await bulk(limited, { action: 'restore', items: remove.undo });
    await bulk(limited, { action: 'restore', items: add.undo });
    expect(await taggingsOf(shared)).toEqual([tags.sales]);
  });

  test('without Converses: not_found for all, nothing written', async () => {
    await setFacets(admin, snapshot.membershipId, { converses: null });
    const r = await bulk(limited, { action: 'tag', ids: [shared, other], key: 'press', op: 'add' });
    expect(r.done).toEqual([]);
    expect(r.failed.map((f) => f.reason)).toEqual(['not_found', 'not_found']);
    expect(await taggingsOf(shared)).toEqual([tags.sales]);
  });
});
