import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { envReady, limitedEnvReady, login, pgGet, pgRpc, requireEnv, requireLimitedEnv, serviceDelete } from './_helpers';

/**
 * ADR-189 · Importar un chat de WhatsApp (tarea 128), sobre el núcleo del
 * ADR-188 (`channel_chat`, `channel_message`, `message_placement`).
 *
 * Lo que fija este fichero:
 * - sólo escribe la RPC: ni INSERT ni UPDATE directos en las tablas nuevas;
 * - `import_whatsapp_chat` pide ser owner, admin o member del espacio, y
 *   colocar en una conversación pide `edit:conversation` (403 si no, sin
 *   oráculo de existencia);
 * - el mensaje se guarda una vez: su colocación es un `conversation_event`
 *   `source='whatsapp'` sin cuerpo que apunta al mensaje; reimportar no
 *   duplica (huella única por espacio);
 * - la dirección la dice quién es quién, no el cliente;
 * - lo leen quien lo importó y la audiencia de la conversación; un miembro
 *   sin Converses no ve ni el mensaje ni el chat;
 * - lo que no tiene sitio sólo lo ve quien lo importó;
 * - un chat 1 a 1 con alguien del equipo no entra, y nada en el futuro.
 *
 * Fixture: una conversación propia en `playwright` / `zzz-difusion`, que se
 * borra al final. La API no borra chats ni mensajes (fase 1): con la clave de
 * servicio, el final borra los eventos de la fixture y los chats de la pasada
 * (con sus mensajes y colocaciones), para que no se acumulen en `playwright`.
 * Las huellas son nuevas cada pasada. Nunca toca `muk-cia`.
 * Va rojo contra un origen sin `20261108100000`.
 */
const RUN = Date.now().toString(36);
const NOWHERE = '00000000-0000-4000-8000-000000000000';
const FIXTURE_EMAIL = 'zzz-rls-whatsapp@hour.test';
const FIXTURE_NAME = 'ZZZ RLS WhatsApp Fixture';

/** Una huella de 32 hex, distinta por pasada y por número. */
const fp = (n: number) =>
  Array.from(`${RUN}-${n}-wa-import-fingerprint`)
    .map((c) => c.charCodeAt(0).toString(16))
    .join('')
    .padEnd(32, '0')
    .slice(0, 32);

interface ImportResult {
  chat_id: string;
  created: number;
  skipped: number;
  placed: number;
}

const one = <T>(data: T | T[] | null): T | undefined => (Array.isArray(data) ? data[0] : (data ?? undefined));

describe.skipIf(!envReady())('WhatsApp import (ADR-189)', () => {
  let jwt: string;
  let conversationId: string;
  let workspaceId: string;
  let personId: string;
  let chatId: string;

  const members = () => [
    { label: 'ZZZ Elena', person_id: personId, name: FIXTURE_NAME, is_self: false },
    { label: 'ZZZ Yo', name: 'ZZZ Yo', is_self: true },
  ];

  const importChat = (messages: unknown[], as: string | null = jwt, chat: Record<string, unknown> = {}) =>
    pgRpc<ImportResult>('import_whatsapp_chat', as, {
      p_workspace_id: workspaceId,
      p_chat: { kind: 'direct', title: `ZZZ RLS ${RUN}`, ...chat },
      p_members: members(),
      p_messages: messages,
    });

  const msg = (n: number, label: string, placements: unknown[], extra: Record<string, unknown> = {}) => ({
    fp: fp(n),
    at: new Date(Date.now() - (10 - n) * 60_000).toISOString(),
    label,
    body: `ZZZ ${RUN} message ${n}`,
    placements,
    ...extra,
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
    for (const row of stale.rows) await pgRpc('delete_conversation', jwt, { p_conversation_id: row.id });

    const created = await pgRpc<{ id: string; person_id: string }>('create_conversation', jwt, {
      p_project_id: projectId,
      p_full_name: FIXTURE_NAME,
      p_email: FIXTURE_EMAIL,
    });
    expect(created.status).toBe(200);
    conversationId = one(created.data)!.id;
    const contact = await pgGet<{ person_id: string }>(
      'conversation_contact',
      jwt,
      new URLSearchParams({ select: 'person_id', conversation_id: `eq.${conversationId}`, is_primary: 'is.true' }),
    );
    personId = contact.rows[0]!.person_id;
  });

  afterAll(async () => {
    if (conversationId) {
      await pgRpc('delete_conversation', jwt, { p_conversation_id: conversationId });
      await serviceDelete('conversation_event', new URLSearchParams({ conversation_id: `eq.${conversationId}`, source: 'eq.whatsapp' }));
    }
    // El chat se lleva sus miembros, mensajes y colocaciones (ON DELETE CASCADE).
    await serviceDelete('channel_chat', new URLSearchParams({ workspace_id: `eq.${workspaceId}`, title: `like.ZZZ RLS*${RUN}` }));
  });

  test('anon can neither look up nor import', async () => {
    const l = await pgRpc('whatsapp_import_lookup', null, { p_workspace_id: workspaceId, p_fingerprints: [] });
    expect(l.status).toBeGreaterThanOrEqual(400);
    const r = await importChat([msg(0, 'ZZZ Elena', [])], null);
    expect(r.status).toBeGreaterThanOrEqual(400);
  });

  test('a workspace that is not yours answers 403', async () => {
    const l = await pgRpc('whatsapp_import_lookup', jwt, { p_workspace_id: NOWHERE, p_fingerprints: [] });
    expect(l.status).toBe(403);
  });

  test('imports once: the event has no body and points at the message; direction comes from who is who', async () => {
    const r = await importChat([
      msg(1, 'ZZZ Elena', [{ surface: 'conversation', conversation_id: conversationId, state: 'placed', reason: 'single_candidate' }]),
      msg(2, 'ZZZ Yo', [{ surface: 'conversation', conversation_id: conversationId, state: 'guess', reason: 'most_recent', candidates: [conversationId] }]),
      msg(3, 'ZZZ Elena', []),
    ]);
    expect(r.status).toBe(200);
    const res = one(r.data)!;
    expect(res).toMatchObject({ created: 3, skipped: 0, placed: 2 });
    chatId = res.chat_id;

    const ev = await pgGet<{ source: string; direction: string; body: string | null; channel_message_id: string; cm: { body: string } }>(
      'conversation_event',
      jwt,
      new URLSearchParams({
        select: 'source,direction,body,channel_message_id,cm:channel_message(body)',
        conversation_id: `eq.${conversationId}`,
        source: 'eq.whatsapp',
        order: 'occurred_at.asc',
      }),
    );
    expect(ev.rows).toHaveLength(2);
    expect(ev.rows[0]).toMatchObject({ source: 'whatsapp', direction: 'inbound', body: null, cm: { body: `ZZZ ${RUN} message 1` } });
    expect(ev.rows[1]!.direction).toBe('outbound');

    const placements = await pgGet<{ state: string; reason: string }>(
      'message_placement',
      jwt,
      new URLSearchParams({ select: 'state,reason', conversation_id: `eq.${conversationId}`, order: 'placed_at.asc' }),
    );
    expect(placements.rows.map((p) => p.state).sort()).toEqual(['guess', 'placed']);
  });

  test('importing the same chat again writes nothing new', async () => {
    const r = await importChat(
      [msg(1, 'ZZZ Elena', [{ surface: 'conversation', conversation_id: conversationId, state: 'placed', reason: 'single_candidate' }])],
      jwt,
      { id: chatId },
    );
    expect(r.status).toBe(200);
    expect(one(r.data)).toMatchObject({ chat_id: chatId, created: 0, skipped: 1, placed: 0 });
    const look = await pgRpc<{ known: string[]; chats: { id: string }[] }>('whatsapp_import_lookup', jwt, {
      p_workspace_id: workspaceId,
      p_fingerprints: [fp(1), fp(2), fp(99)],
    });
    expect(look.status).toBe(200);
    const l = one(look.data)!;
    expect(l.known.sort()).toEqual([fp(1), fp(2)].sort());
    expect(l.chats.map((c) => c.id)).toContain(chatId);
  });

  test('no direct writes on the new tables', async () => {
    const { url, anon } = requireEnv();
    for (const table of ['channel_chat', 'channel_message', 'message_placement', 'channel_chat_member']) {
      const ins = await fetch(`${url}/rest/v1/${table}`, {
        method: 'POST',
        headers: { apikey: anon, Authorization: `Bearer ${jwt}`, 'content-type': 'application/json' },
        body: JSON.stringify({ workspace_id: workspaceId }),
      });
      expect(ins.status, table).toBeGreaterThanOrEqual(400);
    }
    const upd = await fetch(`${url}/rest/v1/channel_message?chat_id=eq.${chatId}`, {
      method: 'PATCH',
      headers: { apikey: anon, Authorization: `Bearer ${jwt}`, 'content-type': 'application/json', Prefer: 'return=representation' },
      body: JSON.stringify({ body: 'changed' }),
    });
    expect(upd.status).toBeGreaterThanOrEqual(400);
  });

  test('placing in a conversation that does not exist answers 403', async () => {
    const r = await importChat([msg(4, 'ZZZ Elena', [{ surface: 'conversation', conversation_id: NOWHERE, state: 'placed', reason: 'person_choice' }])], jwt, { id: chatId });
    expect(r.status).toBe(403);
  });

  test('nothing in the future', async () => {
    const r = await importChat([{ ...msg(5, 'ZZZ Elena', []), at: new Date(Date.now() + 86_400_000).toISOString() }], jwt, { id: chatId });
    expect(r.status).toBe(400);
  });

  test('a direct chat with someone of your own team is refused', async () => {
    const look = await pgRpc<{ team: string[] }>('whatsapp_import_lookup', jwt, { p_workspace_id: workspaceId, p_fingerprints: [] });
    const teammate = one(look.data)?.team[0];
    if (!teammate) return; // Sin nadie del equipo enlazado a su dossier no hay caso.
    const r = await pgRpc('import_whatsapp_chat', jwt, {
      p_workspace_id: workspaceId,
      p_chat: { kind: 'direct', title: `ZZZ RLS team ${RUN}` },
      p_members: [
        { label: 'ZZZ Compañera', person_id: teammate, name: 'ZZZ Compañera', is_self: false },
        { label: 'ZZZ Yo', name: 'ZZZ Yo', is_self: true },
      ],
      p_messages: [msg(6, 'ZZZ Compañera', [])],
    });
    expect(r.status).toBe(400);
  });

  test.skipIf(!limitedEnvReady())('a member without Converses sees neither the messages nor the chat', async () => {
    const limited = requireLimitedEnv();
    const limitedJwt = await login(limited.email, limited.password);
    const m = await pgGet('channel_message', limitedJwt, new URLSearchParams({ select: 'id', chat_id: `eq.${chatId}` }));
    expect(m.status).toBe(200);
    expect(m.rows).toHaveLength(0);
    const c = await pgGet('channel_chat', limitedJwt, new URLSearchParams({ select: 'id', id: `eq.${chatId}` }));
    expect(c.rows).toHaveLength(0);
    const p = await pgGet('message_placement', limitedJwt, new URLSearchParams({ select: 'id', conversation_id: `eq.${conversationId}` }));
    expect(p.rows).toHaveLength(0);
    const r = await pgRpc('import_whatsapp_chat', limitedJwt, {
      p_workspace_id: workspaceId,
      p_chat: { kind: 'direct' },
      p_members: members(),
      p_messages: [msg(7, 'ZZZ Elena', [{ surface: 'conversation', conversation_id: conversationId, state: 'placed', reason: 'person_choice' }])],
    });
    expect(r.status).toBe(403);
  });

  test('a deleted conversation takes the placed messages out of view, but not out of the importer’s', async () => {
    const del = await pgRpc('delete_conversation', jwt, { p_conversation_id: conversationId });
    expect(del.status).toBeLessThan(300);
    const ev = await pgGet('conversation_event', jwt, new URLSearchParams({ select: 'id', conversation_id: `eq.${conversationId}` }));
    expect(ev.rows).toHaveLength(0);
    // Quien lo importó sigue viendo sus mensajes (sin sitio vivo, como dueño).
    const m = await pgGet('channel_message', jwt, new URLSearchParams({ select: 'id', chat_id: `eq.${chatId}` }));
    expect(m.rows.length).toBeGreaterThanOrEqual(3);
  });
});
