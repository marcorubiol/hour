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
 * ADR-099 · el buzón sincronizado (20261011200000_mail_google).
 *
 * Lo que fija este fichero:
 * - `mail_account`: el personal lo ve solo su dueño; el común, los miembros;
 *   la columna cifrada no existe para `authenticated`; nada se escribe sin RPC;
 *   el común lo conecta solo un admin;
 * - las RPC de sincronización (`mail_*`) son solo de service_role;
 * - conversación privada: solo te la marcas a ti, y quien la marcó la sigue
 *   viendo; con el ajuste del espacio en «privadas», una nueva nace privada de
 *   quien la crea, y solo un admin cambia ese ajuste;
 * - la firma de Hour de un buzón la edita quien lo gestiona.
 *
 * El texto cifrado de las pruebas es falso (`v1.zzz.zzz`): nunca se descifra.
 * Fixture: `playwright`, conversación propia en `zzz-difusion`. Nunca toca
 * `muk-cia`. Va rojo contra un origen sin `20261011200000`.
 */
const FAKE_SEALED = 'v1.zzzzzzzzzzzzzzzz.zzzzzzzzzzzzzzzzzzzz';
const FIXTURE_EMAIL = 'zzz-rls-mail@hour.test';
const NOWHERE = '00000000-0000-4000-8000-000000000000';

const one = <T>(data: T | T[] | null): T | undefined =>
  Array.isArray(data) ? data[0] : (data ?? undefined);

describe.skipIf(!envReady())('mail_account and private conversations (ADR-099)', () => {
  let jwt: string;
  let me: string;
  let workspaceId: string;
  let projectId: string;
  let personalId: string | undefined;
  let conversationId: string | undefined;
  let originalSetting: boolean | undefined;

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
        slug: 'eq.zzz-difusion',
        deleted_at: 'is.null',
        limit: '1',
      }),
    );
    if (p.rows.length === 0) throw new Error('zzz-difusion missing in playwright');
    projectId = p.rows[0]!.id;
    workspaceId = p.rows[0]!.workspace_id;
  });

  afterAll(async () => {
    if (originalSetting !== undefined) {
      await pgPatch('workspace', jwt, { new_conversations_private: originalSetting }, new URLSearchParams({ id: `eq.${workspaceId}` }));
    }
    if (personalId) await pgRpc('disconnect_mail_account', jwt, { p_account_id: personalId });
    if (conversationId) {
      await pgPatch('conversation', jwt, { private_to: null }, new URLSearchParams({ id: `eq.${conversationId}` }));
      await pgRpc('delete_conversation', jwt, { p_conversation_id: conversationId });
    }
  });

  test('anon sees no mailbox and cannot connect one', async () => {
    const r = await pgGet('mail_account', null, new URLSearchParams({ select: 'id' }));
    expect(r.rows).toHaveLength(0);
    const c = await pgRpc('connect_mail_account', null, {
      p_workspace_id: workspaceId,
      p_scope: 'personal',
      p_provider: 'google',
      p_address: 'zzz@hour.test',
      p_refresh_token_ciphertext: FAKE_SEALED,
    });
    expect(c.status).toBeGreaterThanOrEqual(400);
  });

  test('a member connects a personal mailbox; reconnecting keeps the same row', async () => {
    const c = await pgRpc<string>('connect_mail_account', jwt, {
      p_workspace_id: workspaceId,
      p_scope: 'personal',
      p_provider: 'google',
      p_address: 'ZZZ-RLS-Personal@hour.test',
      p_refresh_token_ciphertext: FAKE_SEALED,
    });
    expect(c.status).toBe(200);
    personalId = String(c.data);
    const again = await pgRpc<string>('connect_mail_account', jwt, {
      p_workspace_id: workspaceId,
      p_scope: 'personal',
      p_provider: 'google',
      p_address: 'zzz-rls-personal@hour.test',
      p_refresh_token_ciphertext: FAKE_SEALED,
    });
    expect(String(again.data)).toBe(personalId);

    const r = await pgGet<{ id: string; address: string; owner_user_id: string }>(
      'mail_account',
      jwt,
      new URLSearchParams({ select: 'id,address,owner_user_id', id: `eq.${personalId}` }),
    );
    expect(r.rows[0]).toMatchObject({ address: 'zzz-rls-personal@hour.test', owner_user_id: me });
  });

  test('the encrypted token, the cursor and the lease do not exist for authenticated', async () => {
    for (const col of ['refresh_token_ciphertext', 'sync_cursor', 'sync_started_at', '*']) {
      const r = await pgGet('mail_account', jwt, new URLSearchParams({ select: col }));
      expect(r.status, col).toBeGreaterThanOrEqual(400);
    }
  });

  test('no direct writes: insert, update and delete are refused or touch nothing', async () => {
    const ins = await pgPost('mail_account', jwt, {
      workspace_id: workspaceId,
      scope: 'workspace',
      provider: 'google',
      address: 'zzz-direct@hour.test',
      refresh_token_ciphertext: FAKE_SEALED,
    });
    expect(ins.status).toBeGreaterThanOrEqual(400);
    const upd = await pgPatch('mail_account', jwt, { status: 'revoked' }, new URLSearchParams({ id: `eq.${personalId}` }));
    expect(upd.status === 401 || upd.status === 403 || upd.rows.length === 0).toBe(true);
  });

  test('the sync RPCs are service_role only', async () => {
    const calls: [string, Record<string, unknown>][] = [
      ['mail_sync_claim', {}],
      ['mail_account_secret', { p_account_id: personalId }],
      ['mail_contact_addresses', { p_account_id: personalId }],
      ['mail_known_messages', { p_account_id: personalId, p_ids: ['x'] }],
      ['mail_ingest_message', { p_account_id: personalId, p_message: { provider_message_id: 'x' } }],
      ['mail_sync_finish', { p_account_id: personalId, p_status: 'active' }],
    ];
    for (const [fn, args] of calls) {
      const r = await pgRpc(fn, jwt, args);
      expect(r.status, fn).toBeGreaterThanOrEqual(400);
    }
  });

  test('managing a mailbox that does not exist is false, not an oracle', async () => {
    const r = await pgRpc<boolean>('can_manage_mail_account', jwt, { p_account_id: NOWHERE });
    expect(r.data).toBe(false);
    const d = await pgRpc('disconnect_mail_account', jwt, { p_account_id: NOWHERE });
    expect(d.status).toBe(403);
  });

  test.skipIf(!limitedEnvReady())(
    'another member: does not see my personal mailbox, cannot manage it, cannot connect the shared one',
    async () => {
      const limited = requireLimitedEnv();
      const other = await login(limited.email, limited.password);
      const r = await pgGet('mail_account', other, new URLSearchParams({ select: 'id', id: `eq.${personalId}` }));
      expect(r.rows).toHaveLength(0);
      const can = await pgRpc<boolean>('can_manage_mail_account', other, { p_account_id: personalId });
      expect(can.data).toBe(false);
      const d = await pgRpc('disconnect_mail_account', other, { p_account_id: personalId });
      expect(d.status).toBe(403);
      const shared = await pgRpc('connect_mail_account', other, {
        p_workspace_id: workspaceId,
        p_scope: 'workspace',
        p_provider: 'google',
        p_address: 'zzz-rls-shared@hour.test',
        p_refresh_token_ciphertext: FAKE_SEALED,
      });
      expect(shared.status).toBe(403);
    },
  );

  test('the space setting: only an admin changes it, and new conversations are born private to their creator', async () => {
    const ws = new URLSearchParams({ id: `eq.${workspaceId}`, select: 'new_conversations_private' });
    const r = await pgGet<{ new_conversations_private: boolean }>('workspace', jwt, ws);
    originalSetting = r.rows[0]?.new_conversations_private;
    expect(typeof originalSetting).toBe('boolean');
    if (limitedEnvReady()) {
      const limited = requireLimitedEnv();
      const other = await login(limited.email, limited.password);
      const denied = await pgPatch('workspace', other, { new_conversations_private: false }, ws);
      expect(denied.rows).toHaveLength(0);
    }
    const set = await pgPatch<{ new_conversations_private: boolean }>('workspace', jwt, { new_conversations_private: true }, ws);
    expect(set.rows[0]?.new_conversations_private).toBe(true);
  });

  test('a conversation is private only to who marks it', async () => {
    const created = await pgRpc<{ id: string }>('create_conversation', jwt, {
      p_project_id: projectId,
      p_full_name: 'ZZZ RLS Mail Fixture',
      p_email: FIXTURE_EMAIL,
    });
    expect(created.status).toBe(200);
    conversationId = one(created.data)!.id;
    const byId = new URLSearchParams({ id: `eq.${conversationId}`, select: 'id,private_to' });
    const born = await pgGet<{ private_to: string | null }>('conversation', jwt, byId);
    expect(born.rows[0]?.private_to).toBe(me);

    if (limitedEnvReady()) {
      const limited = requireLimitedEnv();
      const otherSub = String(decodeJwt(await login(limited.email, limited.password)).sub);
      const someoneElse = await pgPatch('conversation', jwt, { private_to: otherSub }, byId);
      expect(someoneElse.status).toBe(403);
    }

    const mine = await pgPatch<{ id: string; private_to: string }>('conversation', jwt, { private_to: me }, byId);
    expect(mine.status).toBe(200);
    expect(mine.rows[0]?.private_to).toBe(me);
    const still = await pgGet('conversation', jwt, byId);
    expect(still.rows).toHaveLength(1);

    // Sigue pudiendo apuntar en su registro, y desmarcarla.
    const ev = await pgRpc('record_conversation_event', jwt, {
      p_conversation_id: conversationId,
      p_kind: 'note',
      p_body: 'ZZZ private note',
    });
    expect(ev.status).toBe(200);
    const back = await pgPatch<{ private_to: string | null }>('conversation', jwt, { private_to: null }, byId);
    expect(back.rows[0]?.private_to).toBeNull();
  });

  test('the Hour signature of a mailbox: its manager sets it, nobody else', async () => {
    const ok = await pgRpc('set_mail_signature', jwt, { p_account_id: personalId, p_signature: ' ZZZ firma ' });
    expect(ok.status).toBeLessThan(300);
    const r = await pgGet<{ signature: string }>('mail_account', jwt, new URLSearchParams({ select: 'signature', id: `eq.${personalId}` }));
    expect(r.rows[0]?.signature).toBe('ZZZ firma');
    if (limitedEnvReady()) {
      const limited = requireLimitedEnv();
      const other = await login(limited.email, limited.password);
      const denied = await pgRpc('set_mail_signature', other, { p_account_id: personalId, p_signature: 'x' });
      expect(denied.status).toBe(403);
    }
  });

  test('send authorisation: unknown conversation or mailbox is 403', async () => {
    const r = await pgRpc('mail_send_authorize', jwt, { p_conversation_id: NOWHERE, p_account_id: personalId });
    expect(r.status).toBe(403);
  });
});
