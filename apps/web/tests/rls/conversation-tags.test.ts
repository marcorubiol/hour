import { readdirSync, readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import {
  decodeJwt,
  envReady,
  externalEnvReady,
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
  setFacets,
  type ProjectAccess,
} from './_helpers';

/**
 * ADR-138 · etiquetas, fase 1 (20261020160000_conversation_tags).
 *
 * Lo que fija este fichero (plan `2026-10-19-conversations-tags.md` § 5):
 * - la etiqueta nunca decide permisos: ninguna política de otra tabla ni
 *   ninguna función `private.*` nombra las tablas de etiquetas (comprobado
 *   sobre las migraciones, porque PostgREST no expone el catálogo; la propia
 *   migración hace la misma comprobación contra la base y aborta si falla);
 * - poner y quitar etiquetas no cambia qué conversaciones ve nadie;
 * - las etiquetas de una privada ajena no se ven (0 filas), y sin Converses
 *   tampoco las de una compartida;
 * - el vocabulario lo lee cualquier miembro, con o sin Converses;
 * - `set_conversation_tags` con una etiqueta de otro espacio: 42501; quien no
 *   edita la conversación no etiqueta; no hay escritura directa;
 * - `mark_conversation_read`: solo quien lee la conversación, fila propia.
 *
 * Fixture: `playwright`, proyecto `zzz-e2e-collab`. Nunca toca `muk-cia`.
 * Autolimpiante: borra sus conversaciones y deja el acceso del limitado y el
 * ajuste del espacio como estaban. La etiqueta propia del espacio externo se
 * reutiliza entre pasadas (no hay DELETE de etiquetas). Va rojo contra un
 * origen sin `20261020160000`.
 */
const RUN = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const STANDARD = ['coproduction', 'distribution', 'press', 'sales'];
const TAG_TABLES = ['conversation_tag', 'conversation_tagging', 'workspace_conversation_tag_setting', 'conversation_read'];

interface Row {
  id: string;
}
interface Tag {
  id: string;
  key: string;
  workspace_id: string | null;
}

const one = <T>(data: T | T[] | null): T | undefined => (Array.isArray(data) ? data[0] : (data ?? undefined));

describe('a tag never decides access (migrations)', () => {
  const dir = new URL('../../../../supabase/migrations/', import.meta.url);
  const sql = readdirSync(dir)
    .filter((f) => f.endsWith('.sql'))
    .sort()
    .map((f) => ({ file: f, text: readFileSync(new URL(f, dir), 'utf8') }));

  test('the migration exists', () => {
    expect(sql.some((m) => m.file === '20261020160000_conversation_tags.sql')).toBe(true);
  });

  test('no policy of another table names the tag tables', () => {
    const offenders: string[] = [];
    for (const { file, text } of sql) {
      for (const m of text.matchAll(/CREATE POLICY\s+("[^"]+"|\w+)\s+ON\s+(?:"?public"?\.)?"?(\w+)"?[\s\S]*?;/gi)) {
        const table = m[2]!;
        if (TAG_TABLES.includes(table)) continue;
        if (/conversation_tag/i.test(m[0])) offenders.push(`${file}: ${m[1]} ON ${table}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  test('no private.* function names the tag tables', () => {
    const offenders: string[] = [];
    for (const { file, text } of sql) {
      for (const m of text.matchAll(/CREATE (?:OR REPLACE )?FUNCTION\s+"?private"?\."?(\w+)"?[\s\S]*?\$(\w*)\$[\s\S]*?\$\2\$/gi)) {
        if (/conversation_tag/i.test(m[0])) offenders.push(`${file}: private.${m[1]}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});

describe.skipIf(!envReady() || !limitedEnvReady())('conversation tags (ADR-138 phase 1)', () => {
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
  let mine = '';

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
      p_organization_name: `ZZZ RLS Tags ${label} ${RUN}`,
    });
    expect(r.status, r.error).toBe(200);
    return one(r.data)!.id;
  }

  async function setTags(jwt: string, conversationId: string, keysOrIds: string[]) {
    return pgRpc<string[]>('set_conversation_tags', jwt, {
      p_conversation_id: conversationId,
      p_tag_ids: keysOrIds.map((k) => tags[k] ?? k),
    });
  }

  async function taggingsOf(jwt: string, conversationId: string): Promise<string[]> {
    const r = await pgGet<{ tag_id: string }>(
      'conversation_tagging',
      jwt,
      new URLSearchParams({ conversation_id: `eq.${conversationId}`, select: 'tag_id' }),
    );
    expect(r.status).toBe(200);
    return r.rows.map((row) => row.tag_id).sort();
  }

  async function visibleConversations(jwt: string): Promise<string[]> {
    const r = await pgGet<Row>(
      'conversation',
      jwt,
      new URLSearchParams({ project_id: `eq.${projectId}`, select: 'id', order: 'id' }),
    );
    expect(r.status).toBe(200);
    return r.rows.map((row) => row.id);
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

    const vocab = await pgGet<Tag>(
      'conversation_tag',
      admin,
      new URLSearchParams({ workspace_id: 'is.null', select: 'id,key,workspace_id' }),
    );
    tags = Object.fromEntries(vocab.rows.map((t) => [t.key, t.id]));

    await setSetting(false);
    shared = await createConversation('Shared');
    mine = await createConversation('Mine');
    const priv = await pgPatch<Row>('conversation', admin, { private_to: adminSub }, new URLSearchParams({ id: `eq.${mine}` }));
    expect(priv.rows).toHaveLength(1);
    expect((await setTags(admin, shared, ['sales'])).status).toBe(200);
    expect((await setTags(admin, mine, ['sales', 'press'])).status).toBe(200);
  });

  afterAll(async () => {
    for (const id of [shared, mine]) {
      if (id) await pgRpc('delete_conversation', admin, { p_conversation_id: id }).catch(() => undefined);
    }
    if (originalSetting !== undefined) await setSetting(originalSetting);
    if (snapshot) await restoreProjectAccess(admin, projectId, limitedSub, snapshot);
  });

  test('the standard vocabulary is read by any member, with or without Converses', async () => {
    expect(Object.keys(tags).sort()).toEqual(STANDARD);
    await setFacets(admin, snapshot.membershipId, { converses: null });
    const r = await pgGet<Tag>('conversation_tag', limited, new URLSearchParams({ workspace_id: 'is.null', select: 'key' }));
    expect(r.rows.map((t) => t.key).sort()).toEqual(STANDARD);
  });

  test('without Converses: no tags of a shared conversation', async () => {
    await setFacets(admin, snapshot.membershipId, { converses: null });
    expect(await taggingsOf(admin, shared)).toEqual([tags.sales]);
    expect(await taggingsOf(limited, shared)).toEqual([]);
  });

  test('with Converses: the shared one\'s tags; someone else\'s private one: 0 rows', async () => {
    await setFacets(admin, snapshot.membershipId, { converses: 'view' });
    expect(await taggingsOf(limited, shared)).toEqual([tags.sales]);
    expect(await taggingsOf(limited, mine)).toEqual([]);
    expect(await taggingsOf(admin, mine)).toEqual([tags.press, tags.sales].sort());
  });

  test('who reads but does not edit cannot tag; nobody writes the table directly', async () => {
    await setFacets(admin, snapshot.membershipId, { converses: 'view' });
    expect((await setTags(limited, shared, ['press'])).status).toBe(403);
    expect((await setTags(limited, mine, ['press'])).status).toBe(403);
    expect(await taggingsOf(admin, shared)).toEqual([tags.sales]);

    const direct = await pgPost('conversation_tagging', admin, {
      conversation_id: shared,
      tag_id: tags.press,
      workspace_id: workspaceId,
    });
    expect(direct.status).toBeGreaterThanOrEqual(400);
  });

  test('who edits sets and clears tags; the result is the set, without duplicates', async () => {
    await setFacets(admin, snapshot.membershipId, { converses: 'edit' });
    const set = await setTags(limited, shared, ['press', 'coproduction', 'press']);
    expect(set.status, set.error).toBe(200);
    expect([...(set.data ?? [])].sort()).toEqual([tags.coproduction, tags.press].sort());
    expect((await setTags(limited, mine, ['press'])).status).toBe(403);
    expect((await setTags(limited, shared, ['sales'])).data).toEqual([tags.sales]);
  });

  test('setting and clearing tags changes what nobody sees', async () => {
    await setFacets(admin, snapshot.membershipId, { converses: 'view' });
    const before = { admin: await visibleConversations(admin), limited: await visibleConversations(limited) };
    expect(before.admin).toEqual(expect.arrayContaining([shared, mine]));
    expect(before.limited).toContain(shared);
    expect(before.limited).not.toContain(mine);

    for (const next of [['press'], [], ['sales', 'distribution'], ['sales']]) {
      expect((await setTags(admin, shared, next)).status).toBe(200);
      expect((await setTags(admin, mine, next)).status).toBe(200);
      expect(await visibleConversations(admin)).toEqual(before.admin);
      expect(await visibleConversations(limited)).toEqual(before.limited);
    }
  });

  test('an unknown tag is 42501', async () => {
    const r = await setTags(admin, shared, ['00000000-0000-4000-8000-000000000000']);
    expect(r.status).toBe(403);
  });

  test.skipIf(!externalEnvReady())('a tag of another workspace is 42501 and is not readable', async () => {
    const ext = requireExternalEnv();
    const external = await login(ext.email, ext.password);
    const externalSub = String(decodeJwt(external).sub);
    const own = await pgGet<{ workspace_id: string }>(
      'membership',
      external,
      new URLSearchParams({
        level: 'eq.workspace',
        user_id: `eq.${externalSub}`,
        workspace_role: 'in.(owner,admin)',
        workspace_id: `neq.${workspaceId}`,
        select: 'workspace_id',
        limit: '1',
      }),
    );
    expect(own.rows, 'the external fixture administers a workspace of its own').toHaveLength(1);
    const otherWs = own.rows[0]!.workspace_id;

    // Reutilizada entre pasadas: no hay DELETE de etiquetas.
    const key = 'zzz_rls_foreign';
    let foreign = (
      await pgGet<Tag>(
        'conversation_tag',
        external,
        new URLSearchParams({ workspace_id: `eq.${otherWs}`, key: `eq.${key}`, select: 'id,key,workspace_id' }),
      )
    ).rows[0];
    if (!foreign) {
      const made = await pgPost<Tag>('conversation_tag', external, {
        workspace_id: otherWs,
        key,
        label: 'ZZZ RLS foreign',
        created_by: externalSub,
      });
      expect(made.status).toBe(201);
      foreign = made.rows[0]!;
    }

    const seen = await pgGet<Tag>('conversation_tag', admin, new URLSearchParams({ id: `eq.${foreign.id}`, select: 'id' }));
    expect(seen.rows).toEqual([]);
    expect((await setTags(admin, shared, [foreign.id])).status).toBe(403);
    expect((await setTags(admin, shared, ['sales', foreign.id])).status).toBe(403);
    expect(await taggingsOf(admin, shared)).toEqual([tags.sales]);
    // Y desde fuera, la conversación de playwright no se etiqueta.
    expect((await setTags(external, shared, [foreign.id])).status).toBe(403);
  });

  test('a member that is not admin creates no workspace tag', async () => {
    const r = await pgPost('conversation_tag', limited, {
      workspace_id: workspaceId,
      key: `zzz_${RUN}`.slice(0, 32),
      label: 'nope',
      created_by: limitedSub,
    });
    expect(r.status).toBeGreaterThanOrEqual(400);
  });

  test('mark_conversation_read: only who reads it, and only the own row is visible', async () => {
    await setFacets(admin, snapshot.membershipId, { converses: 'view' });
    expect((await pgRpc('mark_conversation_read', limited, { p_conversation_id: mine })).status).toBe(403);
    const ok = await pgRpc<string>('mark_conversation_read', limited, { p_conversation_id: shared });
    expect(ok.status, ok.error).toBe(200);
    const again = await pgRpc<string>('mark_conversation_read', admin, { p_conversation_id: shared });
    expect(again.status, again.error).toBe(200);

    const rows = await pgGet<{ user_id: string }>(
      'conversation_read',
      limited,
      new URLSearchParams({ conversation_id: `eq.${shared}`, select: 'user_id' }),
    );
    expect(rows.rows.map((r) => r.user_id)).toEqual([limitedSub]);
  });
});
