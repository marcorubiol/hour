/**
 * 138: importar contactos desde una hoja (`20261113100000_contact_import`).
 * Rojo hasta aplicar esa migración: la tabla y las tres funciones no existen
 * antes.
 *
 * `import_contacts`: owner, admin o member que lee Conversaciones en el
 * espacio (`private.can_import_contacts`); guarda personas, organizaciones y
 * el vínculo, nunca conversaciones; mismo correo, la misma persona, y sólo se
 * rellena lo vacío; la fila que falla no para el resto; una tanda reenviada no
 * duplica. Lo importado es directorio, no equipo: quien no lee Conversaciones
 * no lo ve (`person_is_team` redefinida). `contact_import_lookup`:
 * sólo lo que quien llama lee. `undo_contact_import`: quien importó o el
 * owner/admin, una vez, 7 días. `contact_import`: la lee quien la hizo y el
 * owner/admin; nadie la escribe por PostgREST; `filled` no existe para
 * PostgREST. La nota importada es privada de quien importa (ADR-093).
 *
 * Todo en `playwright`, con correos de example.org; lo que crea lo deshace o
 * lo borra. La fixture limitada pasa a guest un momento y vuelve a su rol.
 */

import { beforeAll, describe, expect, test } from 'vitest';
import {
  decodeJwt,
  envReady,
  projectAccess,
  restoreProjectAccess,
  setFacets,
  type ProjectAccess,
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

type ImportResult = {
  import_id: string;
  persons_created: number;
  persons_filled: number;
  organizations_created: number;
  organizations_filled: number;
  notes_created: number;
  failed: { line: number; reason: string }[];
  warnings: { line: number; reason: string }[];
};
type Undo = { persons_removed: number; organizations_removed: number; notes_removed: number; notes_kept: number; fields_restored: number };
type Dossier = { person_id: string; full_name: string; email: string | null; phone: string | null; organization_id: string | null };

const tail = () => Math.random().toString(16).slice(2, 10);

describe.skipIf(!envReady())('RLS — contact_import / import_contacts / undo_contact_import', () => {
  let jwt: string;
  let workspaceId: string;

  beforeAll(async () => {
    const env = requireEnv();
    jwt = await login(env.email, env.password);
    const ws = await pgGet<{ id: string }>('workspace', jwt, new URLSearchParams({ slug: 'eq.playwright', select: 'id' }));
    if (!ws.rows[0]) throw new Error('playwright workspace missing');
    workspaceId = ws.rows[0].id;
  });

  const importRows = (who: string, rows: unknown[], importId: string = crypto.randomUUID(), rowCount = rows.length, last = true, batch = 0) =>
    pgRpc<ImportResult & { repeated: boolean }>('import_contacts', who, {
      p_workspace_id: workspaceId,
      p_import_id: importId,
      p_batch: batch,
      p_filename: 'zzz-rls.csv',
      p_row_count: rowCount,
      p_rows: rows,
      p_last: last,
    });
  const undo = (who: string, id: string) => pgRpc<Undo>('undo_contact_import', who, { p_import_id: id });
  const dossiers = (name: string) =>
    pgGet<Dossier>(
      'workspace_person',
      jwt,
      new URLSearchParams({ select: 'person_id,full_name,email,phone,organization_id', workspace_id: `eq.${workspaceId}`, full_name: `eq.${name}` }),
    );

  test('a member imports persons and organizations, never a conversation; a bad row does not stop the rest; undo removes it all', async () => {
    const t = tail();
    const person = `Zzz Persona ${t}`;
    const org = `Zzz Sala ${t}`;
    const solo = `Zzz Ayuntamiento ${t}`;
    const res = await importRows(jwt, [
      { line: 2, person: { full_name: person, email: `zzz-${t}@example.org`, title: 'Programación' }, organization: { name: org, kind: 'theatre' }, note: 'Zona: Catalunya' },
      { line: 3, organization: { name: solo, kind: 'institution', email: `cultura-${t}@example.org`, city: 'Lleida' } },
      { line: 4, person: { full_name: '   ' } },
      { line: 5, organization: { name: `Zzz Mala ${t}`, kind: 'bar' } },
    ]);
    expect(res.status, res.error).toBe(200);
    const r = res.data!;
    try {
      expect(r).toMatchObject({ persons_created: 1, organizations_created: 2, notes_created: 1 });
      expect(r.failed).toEqual([
        { line: 4, reason: 'no_name' },
        { line: 5, reason: 'invalid' },
      ]);

      const [d] = (await dossiers(person)).rows;
      expect(d).toBeTruthy();
      expect(d.organization_id).not.toBeNull();
      // Ninguna conversación con la organización nueva.
      const conv = await pgGet('conversation', jwt, new URLSearchParams({ select: 'id', organization_id: `eq.${d.organization_id}` }));
      expect(conv.rows).toHaveLength(0);
      // La nota es de quien importa, privada, de la persona.
      const notes = await pgGet<{ body: string; visibility: string }>(
        'note',
        jwt,
        new URLSearchParams({ select: 'body,visibility', person_id: `eq.${d.person_id}`, deleted_at: 'is.null' }),
      );
      expect(notes.rows).toEqual([{ body: 'Zona: Catalunya', visibility: 'private' }]);

      const row = await pgGet<{ status: string; rows_done: number; rows_failed: number }>(
        'contact_import',
        jwt,
        new URLSearchParams({ select: 'status,rows_done,rows_failed', id: `eq.${r.import_id}` }),
      );
      expect(row.rows).toEqual([{ status: 'done', rows_done: 4, rows_failed: 2 }]);
      // Lo completado para deshacer no existe para PostgREST.
      const filled = await pgGet('contact_import', jwt, new URLSearchParams({ select: 'filled', id: `eq.${r.import_id}` }));
      expect(filled.status).toBeGreaterThanOrEqual(400);
    } finally {
      const u = await undo(jwt, r.import_id);
      expect(u.status, u.error).toBe(200);
      expect(u.data).toMatchObject({ persons_removed: 1, organizations_removed: 2, notes_removed: 1 });
    }
    expect((await dossiers(person)).rows).toHaveLength(0);
    const again = await undo(jwt, r.import_id);
    expect(again.status).toBe(400);
    expect(again.error).toContain('already undone');
  });

  test('same email is the same person: only the empty fields are filled, and undo empties them again', async () => {
    const t = tail();
    const email = `zzz-fill-${t}@example.org`;
    const made = await pgRpc<Dossier>('create_workspace_person', jwt, { p_workspace_id: workspaceId, p_full_name: `Zzz Ya ${t}`, p_email: email, p_title: 'Dirección' });
    expect(made.status, made.error).toBe(200);
    const id = made.data!.person_id;
    try {
      const lookup = await pgRpc<{ persons: { person_id: string }[] }>('contact_import_lookup', jwt, {
        p_workspace_id: workspaceId,
        p_emails: [email.toUpperCase()],
        p_names: [],
        p_organizations: [],
      });
      expect(lookup.status, lookup.error).toBe(200);
      expect(lookup.data!.persons.map((p) => p.person_id)).toEqual([id]);

      const res = await importRows(jwt, [{ line: 2, person: { full_name: 'Otro nombre', email, title: 'Producción', phone: '+34 600 000 101' } }]);
      expect(res.status, res.error).toBe(200);
      expect(res.data).toMatchObject({ persons_created: 0, persons_filled: 1 });
      const after = await pgGet<Dossier & { title: string }>(
        'workspace_person',
        jwt,
        new URLSearchParams({ select: 'full_name,phone,title', workspace_id: `eq.${workspaceId}`, person_id: `eq.${id}` }),
      );
      expect(after.rows[0]).toMatchObject({ full_name: `Zzz Ya ${t}`, phone: '+34 600 000 101', title: 'Dirección' });

      const u = await undo(jwt, res.data!.import_id);
      expect(u.status, u.error).toBe(200);
      expect(u.data!.fields_restored).toBe(1);
      const back = await pgGet<Dossier>(
        'workspace_person',
        jwt,
        new URLSearchParams({ select: 'phone', workspace_id: `eq.${workspaceId}`, person_id: `eq.${id}` }),
      );
      expect(back.rows[0].phone).toBeNull();
    } finally {
      await pgRpc('delete_workspace_person', jwt, { p_workspace_id: workspaceId, p_person_id: id });
    }
  });

  test('limits: more than 500 rows a call, or more rows than announced, is 22023', async () => {
    const many = Array.from({ length: 501 }, (_, i) => ({ line: i + 2, organization: { name: `Zzz ${i}` } }));
    const big = await importRows(jwt, many);
    expect(big.status).toBe(400);
    expect(big.error).toContain('22023');
    const over = await importRows(jwt, [{ line: 2, person: { full_name: 'Zzz' } }], undefined, 2001);
    expect(over.status).toBe(400);
  });

  test('nobody writes contact_import through PostgREST, nor note.import_id', async () => {
    const res = await pgPost('contact_import', jwt, { workspace_id: workspaceId, row_count: 1 });
    expect(res.status).toBeGreaterThanOrEqual(400);
    const t = tail();
    const made = await importRows(jwt, [{ line: 2, person: { full_name: `Zzz Nota ${t}` } }]);
    expect(made.status, made.error).toBe(200);
    try {
      // Una nota propia, por la puerta de siempre; ponerle import_id por PATCH es 42501.
      const note = await pgRpc<{ id: string }>('create_note', jwt, { p_body: 'Zzz forjada', p_on_day: '2031-01-01', p_workspace_id: workspaceId });
      expect(note.status, note.error).toBe(200);
      const id = (Array.isArray(note.data) ? note.data[0] : note.data)!.id;
      try {
        const forged = await pgPatch('note', jwt, { import_id: made.data!.import_id }, new URLSearchParams({ id: `eq.${id}` }));
        expect(forged.status).toBe(403);
      } finally {
        await pgRpc('delete_note', jwt, { p_note_id: id });
      }
    } finally {
      await undo(jwt, made.data!.import_id);
    }
  });

  test('the same batch sent twice writes once', async () => {
    const t = tail();
    const id = crypto.randomUUID();
    const rows = [{ line: 2, person: { full_name: `Zzz Dos Veces ${t}` } }];
    const first = await importRows(jwt, rows, id, 2, false, 0);
    expect(first.status, first.error).toBe(200);
    try {
      const again = await importRows(jwt, rows, id, 2, false, 0);
      expect(again.status, again.error).toBe(200);
      expect(again.data!.repeated).toBe(true);
      expect((await dossiers(`Zzz Dos Veces ${t}`)).rows).toHaveLength(1);
    } finally {
      await undo(jwt, id);
    }
  });

  test.skipIf(!externalEnvReady())('someone outside the space gets 42501 and nothing is made', async () => {
    const external = requireExternalEnv();
    const ext = await login(external.email, external.password);
    const name = `Zzz Ext ${tail()}`;
    const res = await importRows(ext, [{ line: 2, person: { full_name: name } }]);
    expect(res.status).toBe(403);
    expect(res.error).not.toContain(name);
    expect(res.error).toContain('42501');
    const look = await pgRpc('contact_import_lookup', ext, { p_workspace_id: workspaceId, p_emails: [], p_names: [name], p_organizations: [] });
    expect(look.status).toBe(403);
    expect((await dossiers(name)).rows).toHaveLength(0);
  });

  describe.skipIf(!limitedEnvReady())('with the limited fixture (a member of playwright)', () => {
    let limitedJwt: string;
    let membership: { id: string; workspace_role: string };
    let projectId: string;
    let limitedSub: string;
    let snapshot: ProjectAccess;

    async function asRole<T>(role: string, run: () => Promise<T>): Promise<T> {
      const changed = await pgRpc('update_workspace_member_role', jwt, { p_membership_id: membership.id, p_role: role });
      expect(changed.status, changed.error).toBe(204);
      try {
        return await run();
      } finally {
        await pgRpc('update_workspace_member_role', jwt, { p_membership_id: membership.id, p_role: membership.workspace_role });
      }
    }

    beforeAll(async () => {
      const limited = requireLimitedEnv();
      limitedJwt = await login(limited.email, limited.password);
      const userId = String(decodeJwt(limitedJwt).sub);
      limitedSub = userId;
      const p = await pgGet<{ id: string }>(
        'project',
        jwt,
        new URLSearchParams({ select: 'id', workspace_id: `eq.${workspaceId}`, slug: 'eq.zzz-e2e-collab', deleted_at: 'is.null', limit: '1' }),
      );
      projectId = p.rows[0]!.id;
      snapshot = await projectAccess(jwt, projectId, limitedSub);
      const m = await pgGet<{ id: string; workspace_role: string }>(
        'membership',
        jwt,
        new URLSearchParams({ level: 'eq.workspace', workspace_id: `eq.${workspaceId}`, user_id: `eq.${userId}`, select: 'id,workspace_role' }),
      );
      membership = m.rows[0]!;
      // Si una pasada anterior cayó a mitad, la fixture podría haberse quedado en guest.
      expect(membership.workspace_role).not.toBe('guest');
    });

    test('without Converses a member imports nothing and does not see what was imported; with it, does', async () => {
      const t = tail();
      const name = `Zzz Directorio ${t}`;
      const mine = await importRows(jwt, [{ line: 2, person: { full_name: name }, organization: { name: `Zzz Sala Dir ${t}` } }]);
      expect(mine.status, mine.error).toBe(200);
      try {
        const [d] = (await dossiers(name)).rows;
        const sees = async () =>
          (await pgGet('workspace_person', limitedJwt, new URLSearchParams({ select: 'person_id', workspace_id: `eq.${workspaceId}`, person_id: `eq.${d.person_id}` }))).rows.length;
        const seesOrg = async () =>
          (await pgGet('workspace_organization', limitedJwt, new URLSearchParams({ select: 'id', id: `eq.${d.organization_id}` }))).rows.length;

        await setFacets(jwt, snapshot.membershipId, { converses: null });
        expect(await sees()).toBe(0);
        expect(await seesOrg()).toBe(0);
        const refused = await importRows(limitedJwt, [{ line: 2, person: { full_name: `Zzz No ${t}` } }]);
        expect(refused.status).toBe(403);
        const look = await pgRpc('contact_import_lookup', limitedJwt, { p_workspace_id: workspaceId, p_emails: [], p_names: [name], p_organizations: [] });
        expect(look.status).toBe(403);

        await setFacets(jwt, snapshot.membershipId, { converses: 'view' });
        if (membership.workspace_role === 'member') {
          expect(await sees()).toBe(1);
          const allowed = await importRows(limitedJwt, [{ line: 2, organization: { name: `Zzz Sí ${t}` } }]);
          expect(allowed.status, allowed.error).toBe(200);
          await undo(limitedJwt, allowed.data!.import_id);
        }

        // Un viewer no importa, lea o no Conversaciones.
        await asRole('viewer', async () => {
          const res = await importRows(limitedJwt, [{ line: 2, person: { full_name: `Zzz Viewer ${t}` } }]);
          expect(res.status).toBe(403);
        });
        await setFacets(jwt, snapshot.membershipId, { converses: null });
        await asRole('viewer', async () => {
          expect(await sees()).toBe(0);
        });
      } finally {
        await restoreProjectAccess(jwt, projectId, limitedSub, snapshot);
        await undo(jwt, mine.data!.import_id);
      }
    });

    test('another member sees neither the import nor its note, and cannot undo it; the admin sees the member’s', async () => {
      await setFacets(jwt, snapshot.membershipId, { converses: 'view' });
      const t = tail();
      const mine = await importRows(jwt, [{ line: 2, person: { full_name: `Zzz Admin ${t}` }, note: 'Privada' }]);
      expect(mine.status, mine.error).toBe(200);
      const theirs = await importRows(limitedJwt, [{ line: 2, organization: { name: `Zzz Del Miembro ${t}` } }]);
      try {
        if (membership.workspace_role === 'member') {
          expect(theirs.status, theirs.error).toBe(200);
          const seen = await pgGet('contact_import', jwt, new URLSearchParams({ select: 'id', id: `eq.${theirs.data!.import_id}` }));
          expect(seen.rows).toHaveLength(1);
        }
        const hidden = await pgGet('contact_import', limitedJwt, new URLSearchParams({ select: 'id', id: `eq.${mine.data!.import_id}` }));
        expect(hidden.rows).toHaveLength(0);
        const note = await pgGet('note', limitedJwt, new URLSearchParams({ select: 'id', body: 'eq.Privada', import_id: `eq.${mine.data!.import_id}` }));
        expect(note.rows).toHaveLength(0);
        const refused = await undo(limitedJwt, mine.data!.import_id);
        expect(refused.status).toBe(403);
      } finally {
        await undo(jwt, mine.data!.import_id);
        if (theirs.status === 200) await undo(limitedJwt, theirs.data!.import_id);
        await restoreProjectAccess(jwt, projectId, limitedSub, snapshot);
      }
    });

    test('an admin undoing a member’s import leaves the member’s private notes', async () => {
      await setFacets(jwt, snapshot.membershipId, { converses: 'view' });
      try {
        if (membership.workspace_role !== 'member') return;
        const t = tail();
        const theirs = await importRows(limitedJwt, [{ line: 2, person: { full_name: `Zzz Notas ${t}` }, note: 'De la autora' }]);
        expect(theirs.status, theirs.error).toBe(200);
        const u = await undo(jwt, theirs.data!.import_id);
        expect(u.status, u.error).toBe(200);
        expect(u.data).toMatchObject({ notes_removed: 0, notes_kept: 1, persons_removed: 1 });
        const left = await pgGet<{ id: string }>('note', limitedJwt, new URLSearchParams({ select: 'id', import_id: `eq.${theirs.data!.import_id}` }));
        expect(left.rows).toHaveLength(1);
        await pgRpc('delete_note', limitedJwt, { p_note_id: left.rows[0].id });
      } finally {
        await restoreProjectAccess(jwt, projectId, limitedSub, snapshot);
      }
    });

    test('a guest imports nothing, looks nothing up and reads no import', async () => {
      const changed = await pgRpc('update_workspace_member_role', jwt, { p_membership_id: membership.id, p_role: 'guest' });
      expect(changed.status, changed.error).toBe(204);
      try {
        const res = await importRows(limitedJwt, [{ line: 2, person: { full_name: `Zzz Guest ${tail()}` } }]);
        expect(res.status).toBe(403);
        const look = await pgRpc('contact_import_lookup', limitedJwt, { p_workspace_id: workspaceId, p_emails: [], p_names: ['x'], p_organizations: [] });
        expect(look.status).toBe(403);
        const read = await pgGet('contact_import', limitedJwt, new URLSearchParams({ select: 'id', workspace_id: `eq.${workspaceId}` }));
        expect(read.rows).toHaveLength(0);
      } finally {
        await pgRpc('update_workspace_member_role', jwt, { p_membership_id: membership.id, p_role: membership.workspace_role });
      }
    });
  });
});
