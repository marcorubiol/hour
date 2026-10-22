/**
 * Fusión de dossiers, fase 1 (`20261022130000_person_merge`,
 * `build/plans/2026-10-22-person-merge.md`).
 *
 * `preview_person_merge`, `merge_workspace_person` y `undo_person_merge`: solo
 * el admin del espacio; lo que no existe o no es suyo, 42501 (403) sin decir
 * cuál; un choque de unicidad deja una fila; el guard de la nota sigue
 * cerrado por PostgREST; `person_merge_row` no la lee nadie; deshacer devuelve
 * lo movido y no se repite.
 *
 * Lo que este fichero no puede montar por PostgREST (los dos son cuentas, keep
 * sin dossier en el espacio, otro espacio intacto, el plazo de 30 días) se
 * probó en SQL contra la Supabase local, dentro de una transacción con
 * ROLLBACK, el 2026-10-22.
 *
 * Todo en `playwright`, sobre `zzz-e2e-collab`, y lo que crea lo borra.
 */

import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import {
  envReady,
  limitedEnvReady,
  login,
  pgGet,
  pgPatch,
  pgRpc,
  requireEnv,
  requireLimitedEnv,
} from './_helpers';

type Dossier = { workspace_id: string; person_id: string; slug: string };
type MergeResult = { merge_id: string; keep_person_id: string; drop_person_id: string; swapped: boolean };
type Preview = {
  keep_person_id: string;
  drop_person_id: string;
  counts: Record<string, number>;
  conflicts: Record<string, number>;
};

const tail = () => Math.random().toString(16).slice(2, 10);
const one = <T>(data: T | T[] | null): T | undefined => (Array.isArray(data) ? data[0] : (data ?? undefined));

describe.skipIf(!envReady())('RLS — person merge', () => {
  let jwt: string;
  let projectId: string;
  let workspaceId: string;
  const people: string[] = [];
  const castRows: string[] = [];
  const notes: string[] = [];

  beforeAll(async () => {
    const env = requireEnv();
    jwt = await login(env.email, env.password);
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
  });

  afterAll(async () => {
    if (!jwt) return;
    for (const id of notes) await pgRpc('delete_note', jwt, { p_note_id: id });
    for (const id of castRows) await pgRpc('remove_cast_member', jwt, { p_cast_member_id: id });
    for (const id of people) await pgRpc('delete_workspace_person', jwt, { p_workspace_id: workspaceId, p_person_id: id });
  });

  const dossier = async (name: string) => {
    const r = await pgRpc<Dossier>('create_workspace_person', jwt, {
      p_workspace_id: workspaceId,
      p_full_name: name,
    });
    expect(r.status, r.error).toBe(200);
    people.push(r.data!.person_id);
    return r.data!;
  };

  const live = async (personId: string) =>
    (
      await pgGet<{ person_id: string }>(
        'workspace_person',
        jwt,
        new URLSearchParams({
          select: 'person_id',
          workspace_id: `eq.${workspaceId}`,
          person_id: `eq.${personId}`,
          deleted_at: 'is.null',
        }),
      )
    ).rows.length > 0;

  const castOf = async (personId: string) =>
    (
      await pgGet<{ id: string; role: string }>(
        'cast_member',
        jwt,
        new URLSearchParams({
          select: 'id,role',
          project_id: `eq.${projectId}`,
          person_id: `eq.${personId}`,
          deleted_at: 'is.null',
        }),
      )
    ).rows;

  const merge = (keep: string, drop: string, as = jwt, fields: Record<string, string> = {}) =>
    pgRpc<MergeResult>('merge_workspace_person', as, {
      p_workspace_id: workspaceId,
      p_keep_person_id: keep,
      p_drop_person_id: drop,
      p_fields: fields,
    });

  test('the same person, or one that does not exist, is refused', async () => {
    const a = await dossier(`Zzz Merge Self ${tail()}`);
    const self = await merge(a.person_id, a.person_id);
    expect(self.status).toBe(400);
    expect(self.error).toContain('22023');
    const ghost = await merge(a.person_id, crypto.randomUUID());
    expect(ghost.status).toBe(403);
    expect(ghost.error).toContain('42501');
  });

  test.skipIf(!limitedEnvReady())('a member who is not admin cannot preview, merge or undo', async () => {
    const lim = requireLimitedEnv();
    const limitedJwt = await login(lim.email, lim.password);
    const a = await dossier(`Zzz Merge Member A ${tail()}`);
    const b = await dossier(`Zzz Merge Member B ${tail()}`);
    const preview = await pgRpc('preview_person_merge', limitedJwt, {
      p_workspace_id: workspaceId,
      p_keep_person_id: a.person_id,
      p_drop_person_id: b.person_id,
    });
    expect(preview.status).toBe(403);
    const m = await merge(a.person_id, b.person_id, limitedJwt);
    expect(m.status).toBe(403);
    expect(m.error).toContain('42501');
    expect(await live(b.person_id)).toBe(true);
  });

  test('merge moves cast and notes, resolves a collision, and undo puts it all back once', async () => {
    const role = `ZZZ Merge ${tail()}`;
    const keep = await dossier(`Zzz Merge Keep ${tail()}`);
    const drop = await dossier(`Zzz Merge Drop ${tail()}`);

    for (const [person, r] of [
      [keep.person_id, role],
      [drop.person_id, role],
      [drop.person_id, `${role} solo`],
    ] as const) {
      const add = await pgRpc<{ id: string }>('add_cast_member', jwt, {
        p_project_id: projectId,
        p_person_id: person,
        p_role: r,
      });
      expect(add.status, add.error).toBe(200);
      castRows.push(one(add.data)!.id);
    }
    const note = await pgRpc<{ id: string }>('create_note', jwt, {
      p_body: `zzz merge ${tail()}`,
      p_on_day: new Date().toISOString().slice(0, 10),
      p_workspace_id: workspaceId,
      p_person_id: drop.person_id,
    });
    expect(note.status, note.error).toBe(200);
    notes.push(note.data!.id);

    const preview = await pgRpc<Preview>('preview_person_merge', jwt, {
      p_workspace_id: workspaceId,
      p_keep_person_id: keep.person_id,
      p_drop_person_id: drop.person_id,
    });
    expect(preview.status, preview.error).toBe(200);
    expect(preview.data!.counts.cast).toBe(2);
    expect(preview.data!.conflicts.cast).toBe(1);
    expect(preview.data!.counts.my_notes).toBe(1);

    // El guard de la nota sigue cerrado por PostgREST.
    const patch = await pgPatch('note', jwt, { person_id: keep.person_id }, new URLSearchParams({ id: `eq.${note.data!.id}` }));
    expect(patch.status).toBe(403);

    const m = await merge(keep.person_id, drop.person_id);
    expect(m.status, m.error).toBe(200);
    expect(m.data!.keep_person_id).toBe(keep.person_id);
    expect(m.data!.swapped).toBe(false);

    expect(await live(drop.person_id)).toBe(false);
    expect(await castOf(drop.person_id)).toHaveLength(0);
    expect((await castOf(keep.person_id)).map((c) => c.role).sort()).toEqual([role, `${role} solo`].sort());
    const moved = await pgGet<{ person_id: string }>(
      'note',
      jwt,
      new URLSearchParams({ select: 'person_id', id: `eq.${note.data!.id}` }),
    );
    expect(moved.rows[0]?.person_id).toBe(keep.person_id);
    const slugs = await pgGet<{ previous_slugs: string[] }>(
      'workspace_person',
      jwt,
      new URLSearchParams({ select: 'previous_slugs', workspace_id: `eq.${workspaceId}`, person_id: `eq.${keep.person_id}` }),
    );
    expect(slugs.rows[0]?.previous_slugs).toContain(drop.slug);

    // El admin ve la fusión; la lista de lo movido no la lee nadie.
    const log = await pgGet<{ id: string }>('person_merge', jwt, new URLSearchParams({ select: 'id', id: `eq.${m.data!.merge_id}` }));
    expect(log.rows).toHaveLength(1);
    const rows = await pgGet('person_merge_row', jwt, new URLSearchParams({ select: 'id', limit: '1' }));
    expect(rows.status).toBeGreaterThanOrEqual(401);

    const undo = await pgRpc<{ skipped: number }>('undo_person_merge', jwt, { p_merge_id: m.data!.merge_id });
    expect(undo.status, undo.error).toBe(200);
    expect(undo.data!.skipped).toBe(0);
    expect(await live(drop.person_id)).toBe(true);
    expect((await castOf(drop.person_id)).map((c) => c.role).sort()).toEqual([role, `${role} solo`].sort());
    expect((await castOf(keep.person_id)).map((c) => c.role)).toEqual([role]);
    const back = await pgGet<{ person_id: string }>(
      'note',
      jwt,
      new URLSearchParams({ select: 'person_id', id: `eq.${note.data!.id}` }),
    );
    expect(back.rows[0]?.person_id).toBe(drop.person_id);

    const again = await pgRpc('undo_person_merge', jwt, { p_merge_id: m.data!.merge_id });
    expect(again.status).toBe(400);
    expect(again.error).toContain('22023');
  });
});
