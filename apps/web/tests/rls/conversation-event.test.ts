import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import {
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
 * ADR-098 · `conversation_event`, the history of a conversation (§ 40).
 *
 * Lo que fija este fichero:
 * - la frontera es la de la conversación: se lee si se lee la conversación,
 *   se escribe solo por `record_conversation_event` con `edit:conversation`,
 *   y una conversación borrada se lleva sus eventos de la vista;
 * - el registro es append-only: ni INSERT, ni UPDATE, ni DELETE directos;
 * - la regla de contacto: todo menos una nota sin dirección mueve el último
 *   contacto, al máximo y nunca hacia atrás, y el primero no se toca;
 * - lo que ocurrió no está en el futuro, y `external_ref` es idempotente.
 *
 * Fixture: una conversación propia en `playwright` / `zzz-difusion`, con un
 * email estable (crear una persona por pasada dejaría una global por pasada).
 * Se borra al final; la siguiente pasada la resucita CON sus eventos de antes,
 * así que todo lo que se cuenta aquí se filtra por la marca de esta pasada.
 * Nunca toca `muk-cia`. Va rojo contra un origen sin `20261009100000`.
 */
const RUN = Date.now().toString(36);
const NOWHERE = '00000000-0000-4000-8000-000000000000';
const FIXTURE_EMAIL = 'zzz-rls-event@hour.test';
const FIXTURE_NAME = 'ZZZ RLS Event Fixture';
const DAY = 86_400_000;

interface ConversationRow {
  id: string;
  first_contacted_at: string | null;
  last_contacted_at: string | null;
}

interface EventRow {
  id: string;
  workspace_id: string;
  conversation_id: string;
  occurred_at: string;
  recorded_at: string;
  kind: string;
  source: string;
  direction: string | null;
  body: string | null;
  external_ref: string | null;
  created_by: string | null;
}

/** `RETURNS <row>` sale por PostgREST como objeto; por si acaso, también array. */
const one = <T>(data: T | T[] | null): T | undefined =>
  Array.isArray(data) ? data[0] : (data ?? undefined);

describe.skipIf(!envReady())('conversation_event (ADR-098)', () => {
  let jwt: string;
  let conversationId: string;
  let workspaceId: string;

  const stamps = async (): Promise<ConversationRow> => {
    const r = await pgGet<ConversationRow>(
      'conversation',
      jwt,
      new URLSearchParams({
        select: 'id,first_contacted_at,last_contacted_at',
        id: `eq.${conversationId}`,
      }),
    );
    expect(r.rows).toHaveLength(1);
    return r.rows[0]!;
  };

  const record = (args: Record<string, unknown>, as: string | null = jwt) =>
    pgRpc<EventRow>('record_conversation_event', as, {
      p_conversation_id: conversationId,
      ...args,
    });

  beforeAll(async () => {
    const env = requireEnv();
    jwt = await login(env.email, env.password);

    const p = await pgGet<{ id: string; workspace_id: string }>(
      'project',
      jwt,
      new URLSearchParams({
        select: 'id,workspace_id,workspace:workspace_id!inner(slug)',
        'workspace.slug': 'eq.playwright',
        slug: 'eq.zzz-difusion',
        deleted_at: 'is.null',
        limit: '1',
      }),
    );
    if (p.rows.length === 0) throw new Error('zzz-difusion missing in playwright');
    const projectId = p.rows[0]!.id;
    workspaceId = p.rows[0]!.workspace_id;

    // Una pasada muerta a medias deja la conversación viva: se recoge.
    const stale = await pgGet<{ id: string }>(
      'conversation',
      jwt,
      new URLSearchParams({
        select: 'id,person:person_id!inner(email)',
        'person.email': `eq.${FIXTURE_EMAIL}`,
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
    });
    expect(created.status).toBe(200);
    conversationId = one(created.data)!.id;
  });

  afterAll(async () => {
    if (conversationId) {
      await pgRpc('delete_conversation', jwt, { p_conversation_id: conversationId });
    }
  });

  test('anon can neither record nor read', async () => {
    const r = await record({ p_kind: 'call' }, null);
    expect(r.status).toBeGreaterThanOrEqual(400);
    const read = await pgGet('conversation_event', null, new URLSearchParams({ select: 'id' }));
    expect(read.rows).toHaveLength(0);
  });

  test('an unknown conversation answers 403, not 404 (no existence oracle)', async () => {
    const r = await pgRpc('record_conversation_event', jwt, {
      p_conversation_id: NOWHERE,
      p_kind: 'call',
    });
    expect(r.status).toBe(403);
  });

  test('the server derives the workspace and stamps now when no instant is sent', async () => {
    const before = Date.now();
    const r = await record({ p_kind: 'call', p_direction: 'outbound', p_body: `ZZZ ${RUN} call` });
    expect(r.status).toBe(200);
    const ev = one(r.data)!;
    expect(ev.workspace_id).toBe(workspaceId);
    expect(ev.conversation_id).toBe(conversationId);
    expect(ev.source).toBe('manual');
    expect(ev.created_by).toBeTruthy();
    expect(Math.abs(Date.parse(ev.occurred_at) - before)).toBeLessThan(60_000);

    const s = await stamps();
    expect(s.last_contacted_at).toBeTruthy();
    expect(Date.parse(s.last_contacted_at!)).toBeGreaterThanOrEqual(Date.parse(ev.occurred_at) - 1);
  });

  test('a note without direction is not a contact; with one, it is', async () => {
    const before = await stamps();
    const silent = await record({ p_kind: 'note', p_body: `ZZZ ${RUN} internal` });
    expect(silent.status).toBe(200);
    expect(await stamps()).toEqual(before);

    const spoken = await record({
      p_kind: 'note',
      p_direction: 'inbound',
      p_body: `ZZZ ${RUN} said in the corridor`,
    });
    expect(spoken.status).toBe(200);
    const after = await stamps();
    expect(Date.parse(after.last_contacted_at!)).toBeGreaterThanOrEqual(
      Date.parse(before.last_contacted_at!),
    );
    expect(after.first_contacted_at).toBe(before.first_contacted_at);
  });

  test('backfilling an old contact never moves the last contact back', async () => {
    const before = await stamps();
    const r = await record({
      p_kind: 'meeting',
      p_occurred_at: new Date(Date.now() - 30 * DAY).toISOString(),
      p_body: `ZZZ ${RUN} old meeting`,
    });
    expect(r.status).toBe(200);
    expect(await stamps()).toEqual(before);
  });

  test('what happened cannot be in the future', async () => {
    const r = await record({
      p_kind: 'email',
      p_occurred_at: new Date(Date.now() + DAY).toISOString(),
    });
    expect(r.status).toBe(400);
  });

  test('an external reference records once', async () => {
    const ref = `zzz-rls-${RUN}`;
    const a = await record({ p_kind: 'email', p_source: 'email', p_external_ref: ref });
    const b = await record({
      p_kind: 'email',
      p_source: 'email',
      p_external_ref: ref,
      p_body: 'a second copy',
    });
    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
    expect(one(b.data)!.id).toBe(one(a.data)!.id);
    const rows = await pgGet<EventRow>(
      'conversation_event',
      jwt,
      new URLSearchParams({ select: 'id', external_ref: `eq.${ref}` }),
    );
    expect(rows.rows).toHaveLength(1);
  });

  test('the timeline reads back, most recent first', async () => {
    const r = await pgGet<EventRow>(
      'conversation_event',
      jwt,
      new URLSearchParams({
        select: 'id,occurred_at,body',
        conversation_id: `eq.${conversationId}`,
        body: `like.ZZZ ${RUN}*`,
        order: 'occurred_at.desc,recorded_at.desc',
      }),
    );
    expect(r.status).toBe(200);
    expect(r.rows.map((e) => e.body)).toEqual([
      `ZZZ ${RUN} said in the corridor`,
      `ZZZ ${RUN} internal`,
      `ZZZ ${RUN} call`,
      `ZZZ ${RUN} old meeting`,
    ]);
  });

  test('append-only: no direct insert, update or delete', async () => {
    const ins = await pgPost('conversation_event', jwt, {
      workspace_id: workspaceId,
      conversation_id: conversationId,
      occurred_at: new Date().toISOString(),
      kind: 'note',
    });
    expect(ins.status).toBeGreaterThanOrEqual(400);

    const upd = await pgPatch<EventRow>(
      'conversation_event',
      jwt,
      { body: 'rewritten' },
      new URLSearchParams({ conversation_id: `eq.${conversationId}` }),
    );
    expect(upd.status).toBeGreaterThanOrEqual(400);
    expect(upd.rows).toHaveLength(0);

    const { url, anon } = requireEnv();
    const del = await fetch(
      `${url}/rest/v1/conversation_event?conversation_id=eq.${conversationId}`,
      { method: 'DELETE', headers: { apikey: anon, Authorization: `Bearer ${jwt}` } },
    );
    expect(del.status).toBeGreaterThanOrEqual(400);
  });

  test.skipIf(!limitedEnvReady())(
    'a member without read:conversation sees no events and cannot record',
    async () => {
      const limited = requireLimitedEnv();
      const limitedJwt = await login(limited.email, limited.password);
      const read = await pgGet<EventRow>(
        'conversation_event',
        limitedJwt,
        new URLSearchParams({ select: 'id', conversation_id: `eq.${conversationId}` }),
      );
      expect(read.status).toBe(200);
      expect(read.rows).toHaveLength(0);
      const r = await record({ p_kind: 'call' }, limitedJwt);
      expect(r.status).toBe(403);
    },
  );

  test('a deleted conversation takes its events out of view and takes no more', async () => {
    const del = await pgRpc('delete_conversation', jwt, { p_conversation_id: conversationId });
    expect(del.status).toBeLessThan(300);
    const read = await pgGet<EventRow>(
      'conversation_event',
      jwt,
      new URLSearchParams({ select: 'id', conversation_id: `eq.${conversationId}` }),
    );
    expect(read.rows).toHaveLength(0);
    const r = await record({ p_kind: 'call' });
    expect(r.status).toBe(403);
  });
});
