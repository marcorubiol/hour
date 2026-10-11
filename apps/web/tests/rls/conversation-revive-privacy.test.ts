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
 * ADR-099 · recuperar una conversación borrada no se salta la privacidad
 * (20261011500000_conversation_revive_privacy).
 *
 * `create_conversation`, si ya hay en el proyecto una conversación borrada con
 * esa persona, la recupera. Lo que fija este fichero:
 * - una borrada privada de OTRA persona no se recupera: quien crea recibe una
 *   conversación suya, nunca la otra;
 * - al recuperar, `private_to` lo decide el ajuste del espacio para quien
 *   crea, como al nacer.
 *
 * Fixture: `playwright`, proyecto `zzz-e2e-collab`, personas `zzz-rls-revive-*`.
 * Cada pasada deja las filas como las encontró (borradas), así que la
 * siguiente también recupera. Va rojo contra un origen sin `20261011500000`.
 */
const OTHER_EMAIL = 'zzz-rls-revive-other@hour.test';
const SETTING_EMAIL = 'zzz-rls-revive-setting@hour.test';

interface ConversationRow {
  id: string;
  private_to: string | null;
}

interface ProjectMembershipRow {
  id: string;
  roles: string[];
  permission_grants: string[];
  permission_revokes: string[];
}

const one = <T>(data: T | T[] | null): T | undefined =>
  Array.isArray(data) ? data[0] : (data ?? undefined);

describe.skipIf(!envReady())('reviving a deleted conversation keeps privacy (ADR-099)', () => {
  let jwt: string;
  let me: string;
  let workspaceId: string;
  let projectId: string;
  let originalSetting: boolean | undefined;
  const live: { id: string; jwt: () => string }[] = [];

  async function setSetting(value: boolean) {
    const r = await pgPatch<{ new_conversations_private: boolean }>(
      'workspace',
      jwt,
      { new_conversations_private: value },
      new URLSearchParams({ id: `eq.${workspaceId}` }),
    );
    expect(r.rows[0]?.new_conversations_private).toBe(value);
  }

  async function create(as: string, fullName: string, email: string): Promise<ConversationRow> {
    const r = await pgRpc<ConversationRow>('create_conversation', as, {
      p_project_id: projectId,
      p_full_name: fullName,
      p_email: email,
    });
    expect(r.status, r.error).toBe(200);
    const row = one(r.data)!;
    live.push({ id: row.id, jwt: () => as });
    return row;
  }

  async function remove(as: string, id: string) {
    const r = await pgRpc('delete_conversation', as, { p_conversation_id: id });
    expect(r.status, r.error).toBeLessThan(300);
    const i = live.findIndex((c) => c.id === id);
    if (i >= 0) live.splice(i, 1);
  }

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
    const ws = await pgGet<{ new_conversations_private: boolean }>(
      'workspace',
      jwt,
      new URLSearchParams({ id: `eq.${workspaceId}`, select: 'new_conversations_private' }),
    );
    originalSetting = ws.rows[0]?.new_conversations_private;
  });

  afterAll(async () => {
    for (const c of [...live]) await remove(c.jwt(), c.id).catch(() => undefined);
    if (originalSetting !== undefined) await setSetting(originalSetting);
  });

  test('the space setting decides private_to when a deleted conversation comes back', async () => {
    await setSetting(false);
    const shared = await create(jwt, 'ZZZ RLS Revive Setting', SETTING_EMAIL);
    expect(shared.private_to).toBeNull();
    await remove(jwt, shared.id);

    await setSetting(true);
    const revived = await create(jwt, 'ZZZ RLS Revive Setting', SETTING_EMAIL);
    expect(revived.id).toBe(shared.id);
    expect(revived.private_to).toBe(me);
    await remove(jwt, revived.id);

    await setSetting(false);
    const back = await create(jwt, 'ZZZ RLS Revive Setting', SETTING_EMAIL);
    expect(back.id).toBe(shared.id);
    expect(back.private_to).toBeNull();
    await remove(jwt, back.id);
  });

  test.skipIf(!limitedEnvReady())(
    "someone else's deleted private conversation is never revived for me",
    async () => {
      const limited = requireLimitedEnv();
      const other = await login(limited.email, limited.password);
      const otherSub = String(decodeJwt(other).sub);
      const m = await pgGet<ProjectMembershipRow>(
        'project_membership',
        jwt,
        new URLSearchParams({
          project_id: `eq.${projectId}`,
          user_id: `eq.${otherSub}`,
          select: 'id,roles,permission_grants,permission_revokes',
        }),
      );
      expect(m.rows).toHaveLength(1);
      const membership = m.rows[0]!;
      try {
        const granted = await pgPatch(
          'project_membership',
          jwt,
          {
            permission_grants: [
              ...new Set([...membership.permission_grants, 'read:conversation', 'edit:conversation']),
            ],
            permission_revokes: membership.permission_revokes.filter(
              (p) => p !== 'read:conversation' && p !== 'edit:conversation',
            ),
          },
          new URLSearchParams({ id: `eq.${membership.id}` }),
        );
        expect(granted.rows).toHaveLength(1);

        await setSetting(true);
        const mine = await create(jwt, 'ZZZ RLS Revive Other', OTHER_EMAIL);
        expect(mine.private_to).toBe(me);
        await remove(jwt, mine.id);

        const theirs = await create(other, 'ZZZ RLS Revive Other', OTHER_EMAIL);
        expect(theirs.id).not.toBe(mine.id);
        expect(theirs.private_to).toBe(otherSub);

        // La mía sigue siendo invisible para la otra persona.
        const peek = await pgGet('conversation', other, new URLSearchParams({ id: `eq.${mine.id}`, select: 'id' }));
        expect(peek.rows).toHaveLength(0);

        // Se borra privada suya: la próxima pasada, cada uno recupera la suya.
        await remove(other, theirs.id);
      } finally {
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
      }
    },
  );
});
