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
  requireEnv,
  requireExternalEnv,
  requireLimitedEnv,
} from './_helpers';

/**
 * ADR-138 · etiquetas, fase 4: las etiquetas del espacio en Ajustes. Sin
 * migración: fija lo que ya da 20261020160000 a la pantalla nueva.
 *
 * - el admin crea una propia, la renombra, renombra una estándar en su
 *   espacio (y vuelve al nombre de Hour), desactiva y reactiva, y ordena;
 * - desactivar no borra las asignaciones, y no deja ponerla;
 * - quien no es admin no crea, no renombra ni toca los ajustes;
 * - una propia de otro espacio no se ve ni se toca, ni con un ajuste del
 *   espacio propio que la apunte.
 *
 * `all` y `team` como clave no los para la base (el CHECK solo pide la
 * forma): los paran la pantalla y el endpoint, con test unitario.
 *
 * Fixture: `playwright`, proyecto `zzz-e2e-collab`. Nunca toca `muk-cia`. La
 * etiqueta propia `zzz_rls_settings` se reutiliza entre pasadas (no hay
 * DELETE) y queda activa; el ajuste de `press` vuelve a como estaba.
 */
const KEY = 'zzz_rls_settings';
const RUN = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

interface Tag {
  id: string;
  key: string;
  workspace_id: string | null;
  label: string | null;
}
interface Setting {
  workspace_id: string;
  tag_id: string;
  label: string | null;
  active: boolean;
  sort: number | null;
}

const one = <T>(data: T | T[] | null): T | undefined => (Array.isArray(data) ? data[0] : (data ?? undefined));

describe.skipIf(!envReady() || !limitedEnvReady())('conversation tags in settings (ADR-138 phase 4)', () => {
  let admin: string;
  let adminSub: string;
  let limited: string;
  let limitedSub: string;
  let workspaceId: string;
  let projectId: string;
  let press: string;
  let sales: string;
  let own: Tag;
  let pressBefore: Setting | undefined;
  let ownBefore: Setting | undefined;
  let conversation = '';

  async function settingOf(jwt: string, tagId: string): Promise<Setting | undefined> {
    const r = await pgGet<Setting>(
      'workspace_conversation_tag_setting',
      jwt,
      new URLSearchParams({ workspace_id: `eq.${workspaceId}`, tag_id: `eq.${tagId}`, select: 'workspace_id,tag_id,label,active,sort' }),
    );
    return r.rows[0];
  }

  /** The way the endpoint writes it: patch the setting if it exists, insert it if not. */
  async function writeSetting(jwt: string, tagId: string, patch: Partial<Omit<Setting, 'workspace_id' | 'tag_id'>>) {
    if (await settingOf(admin, tagId)) {
      return pgPatch<Setting>(
        'workspace_conversation_tag_setting',
        jwt,
        patch,
        new URLSearchParams({ workspace_id: `eq.${workspaceId}`, tag_id: `eq.${tagId}` }),
      );
    }
    return pgPost<Setting>('workspace_conversation_tag_setting', jwt, { workspace_id: workspaceId, tag_id: tagId, ...patch });
  }

  async function taggingsOf(conversationId: string): Promise<string[]> {
    const r = await pgGet<{ tag_id: string }>(
      'conversation_tagging',
      admin,
      new URLSearchParams({ conversation_id: `eq.${conversationId}`, select: 'tag_id' }),
    );
    return r.rows.map((row) => row.tag_id).sort();
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

    const std = await pgGet<Tag>('conversation_tag', admin, new URLSearchParams({ workspace_id: 'is.null', select: 'id,key' }));
    press = std.rows.find((x) => x.key === 'press')!.id;
    sales = std.rows.find((x) => x.key === 'sales')!.id;
    pressBefore = await settingOf(admin, press);

    own = (
      await pgGet<Tag>(
        'conversation_tag',
        admin,
        new URLSearchParams({ workspace_id: `eq.${workspaceId}`, key: `eq.${KEY}`, select: 'id,key,workspace_id,label' }),
      )
    ).rows[0]!;
    if (!own) {
      const made = await pgPost<Tag>('conversation_tag', admin, {
        workspace_id: workspaceId,
        key: KEY,
        label: 'ZZZ RLS settings',
        created_by: adminSub,
        sort: 900,
      });
      expect(made.status).toBe(201);
      own = made.rows[0]!;
    }
    ownBefore = await settingOf(admin, own.id);
    if (ownBefore && !ownBefore.active) await writeSetting(admin, own.id, { active: true });

    const c = await pgRpc<{ id: string }>('create_conversation', admin, {
      p_project_id: projectId,
      p_organization_name: `ZZZ RLS Tag settings ${RUN}`,
    });
    expect(c.status, c.error).toBe(200);
    conversation = one(c.data)!.id;
  });

  afterAll(async () => {
    if (conversation) await pgRpc('delete_conversation', admin, { p_conversation_id: conversation }).catch(() => undefined);
    if (own) {
      await pgPatch('conversation_tag', admin, { label: 'ZZZ RLS settings' }, new URLSearchParams({ id: `eq.${own.id}` }));
      await writeSetting(admin, own.id, { active: true }).catch(() => undefined);
    }
    if (press) {
      const back = pressBefore
        ? { label: pressBefore.label, active: pressBefore.active, sort: pressBefore.sort }
        : { label: null, active: true, sort: null };
      await writeSetting(admin, press, back).catch(() => undefined);
    }
  });

  test('the admin creates an own tag and renames it in its row', async () => {
    expect(own.workspace_id).toBe(workspaceId);
    const r = await pgPatch<Tag>('conversation_tag', admin, { label: `ZZZ RLS ${RUN}` }, new URLSearchParams({ id: `eq.${own.id}` }));
    expect(r.rows.map((x) => x.label)).toEqual([`ZZZ RLS ${RUN}`]);
    // The key never changes: the chips and the translations use it.
    const k = await pgPatch('conversation_tag', admin, { key: 'zzz_other' }, new URLSearchParams({ id: `eq.${own.id}` }));
    expect(k.status).toBeGreaterThanOrEqual(400);
  });

  test('the admin renames a standard tag in the space, orders it and goes back to Hour’s name', async () => {
    const renamed = await writeSetting(admin, press, { label: 'Medios', sort: 5 });
    expect(renamed.status).toBeLessThan(300);
    expect(await settingOf(admin, press)).toMatchObject({ label: 'Medios', sort: 5 });
    // A member reads it (the chips do).
    expect((await settingOf(limited, press))?.label).toBe('Medios');
    // The standard row itself is Hour’s: nobody renames it.
    const std = await pgPatch<Tag>('conversation_tag', admin, { label: 'Nope' }, new URLSearchParams({ id: `eq.${press}` }));
    expect(std.rows).toEqual([]);

    await writeSetting(admin, press, { label: null });
    expect((await settingOf(admin, press))?.label).toBeNull();
  });

  test('turned off, a tag cannot be set; the conversations that carry it keep it', async () => {
    const setTags = (ids: string[]) => pgRpc<string[]>('set_conversation_tags', admin, { p_conversation_id: conversation, p_tag_ids: ids });

    // Off, it cannot be put on a conversation that does not carry it.
    expect((await setTags([sales])).status).toBe(200);
    expect((await writeSetting(admin, own.id, { active: false })).status).toBeLessThan(300);
    expect((await settingOf(admin, own.id))?.active).toBe(false);
    expect((await setTags([sales, own.id])).status).toBe(403);
    expect(await taggingsOf(conversation)).toEqual([sales]);
    expect((await writeSetting(admin, own.id, { active: true })).status).toBeLessThan(300);

    // On, it is set; off again, the screen sends only the active ones and it stays.
    expect((await setTags([sales, own.id])).status).toBe(200);
    expect((await writeSetting(admin, own.id, { active: false })).status).toBeLessThan(300);
    expect((await setTags([sales])).status).toBe(200);
    expect(await taggingsOf(conversation)).toEqual([sales, own.id].sort());

    // Back on, it is there again, and can be taken off.
    expect((await writeSetting(admin, own.id, { active: true })).status).toBeLessThan(300);
    expect((await settingOf(admin, own.id))?.active).toBe(true);
    expect((await setTags([sales])).data).toEqual([sales]);
  });

  test('a member that is not admin creates, renames and configures nothing', async () => {
    const made = await pgPost('conversation_tag', limited, {
      workspace_id: workspaceId,
      key: `zzz_${RUN}`.slice(0, 32),
      label: 'nope',
      created_by: limitedSub,
    });
    expect(made.status).toBeGreaterThanOrEqual(400);

    const renamed = await pgPatch<Tag>('conversation_tag', limited, { label: 'nope' }, new URLSearchParams({ id: `eq.${own.id}` }));
    expect(renamed.rows).toEqual([]);

    const before = await settingOf(admin, own.id);
    if (before) {
      const off = await pgPatch<Setting>(
        'workspace_conversation_tag_setting',
        limited,
        { active: false, label: 'nope' },
        new URLSearchParams({ workspace_id: `eq.${workspaceId}`, tag_id: `eq.${own.id}` }),
      );
      expect(off.rows).toEqual([]);
    }
    const inserted = await pgPost('workspace_conversation_tag_setting', limited, {
      workspace_id: workspaceId,
      tag_id: sales,
      active: false,
    });
    expect(inserted.status).toBeGreaterThanOrEqual(400);
    expect(await settingOf(admin, own.id)).toEqual(before);
    // Nobody deletes a tag: turning it off is the way.
    const del = await fetch(`${requireEnv().url}/rest/v1/conversation_tag?id=eq.${own.id}`, {
      method: 'DELETE',
      headers: { apikey: requireEnv().anon, Authorization: `Bearer ${admin}` },
    });
    expect(del.status).toBeGreaterThanOrEqual(400);
  });

  test.skipIf(!externalEnvReady())('an own tag of another space is neither seen nor touched', async () => {
    const ext = requireExternalEnv();
    const external = await login(ext.email, ext.password);
    const seen = await pgGet<Tag>('conversation_tag', external, new URLSearchParams({ id: `eq.${own.id}`, select: 'id' }));
    expect(seen.rows).toEqual([]);
    const renamed = await pgPatch<Tag>('conversation_tag', external, { label: 'nope' }, new URLSearchParams({ id: `eq.${own.id}` }));
    expect(renamed.rows).toEqual([]);
    const settings = await pgGet<Setting>(
      'workspace_conversation_tag_setting',
      external,
      new URLSearchParams({ workspace_id: `eq.${workspaceId}`, select: 'tag_id' }),
    );
    expect(settings.rows).toEqual([]);
    const into = await pgPost('workspace_conversation_tag_setting', external, { workspace_id: workspaceId, tag_id: own.id, active: false });
    expect(into.status).toBeGreaterThanOrEqual(400);

    // A setting of its own space that points at playwright's tag: the guard says no.
    const externalSub = String(decodeJwt(external).sub);
    const mine = await pgGet<{ workspace_id: string }>(
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
    expect(mine.rows, 'the external fixture administers a workspace of its own').toHaveLength(1);
    const cross = await pgPost('workspace_conversation_tag_setting', external, {
      workspace_id: mine.rows[0]!.workspace_id,
      tag_id: own.id,
      label: 'nope',
    });
    expect(cross.status).toBeGreaterThanOrEqual(400);
    expect(await settingOf(admin, own.id)).toMatchObject({ active: true });
  });
});
