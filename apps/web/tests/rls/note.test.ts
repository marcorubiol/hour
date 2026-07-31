/**
 * RLS regression — `note`, the private post-it (ADR-093).
 *
 * The one law this file exists to hold: **a note is private, full stop**. Not
 * "private unless shared", not "private to the project" — the author, and
 * nobody else, ever. What the team sees is comms (ADR-083), which does not
 * exist yet. If a future migration widens `note_select` by one clause, the
 * `sees nothing` assertions below are the only thing standing between a
 * post-it and a broadcast.
 *
 * Also pinned here, because each one broke or nearly broke while building it:
 *   · Soft delete goes through `delete_note` and CANNOT be done by a client.
 *     Postgres enforces the SELECT policy against the NEW row of an UPDATE, so
 *     setting `deleted_at` fails the `deleted_at IS NULL` clause. Verified the
 *     hard way on 2026-07-31 — a `WITH CHECK (true)` on `note_update` did not
 *     help, only removing the clause from `note_select` did. Somebody will
 *     eventually "simplify" the RPC away; this test is why they can't.
 *   · A person anchor needs a dossier in that workspace (ADR-085's consent
 *     boundary): no dossier, no note.
 *   · The bug ADR-093 §5 killed: `person_note_select` demanded
 *     `read:person_note_private` over SOME project to read YOUR OWN private
 *     note. The limited fixture has no such grant and must still read its own.
 *
 * NOTE: this file goes red until `20260731120000_note_absorbs_person_note` is
 * applied to production — the RLS suite runs against live `hour-phase0`.
 *
 * Fixture discipline (ADR-052): everything lives in the caller's own
 * `playwright` workspace, is `ZZZ`-prefixed and is soft-deleted in cleanup.
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

const RANDOM_UUID = '00000000-0000-4000-8000-000000000000';
const RUN_TAG = Date.now().toString(36);
const BODY = `ZZZ RLS Note ${RUN_TAG}`;
const TODAY = new Date().toISOString().slice(0, 10);

interface NoteRow {
  id: string;
  workspace_id: string;
  author_id: string;
  project_id: string | null;
  person_id: string | null;
  on_day: string;
  visibility: string;
  body: string;
  deleted_at: string | null;
}

interface WorkspaceRow {
  id: string;
  slug: string;
}

describe.skipIf(!envReady())('note RLS (ADR-093)', () => {
  let jwt: string;
  let playwrightWsId: string;
  let noteId: string | null = null;

  // Prefix-wide sweep (no run tag): a crashed run never reaches afterAll, and
  // every later run carries a different tag — same convention as task.test.ts.
  async function sweepLeftovers() {
    const { rows } = await pgGet<NoteRow>(
      'note',
      jwt,
      new URLSearchParams({
        select: 'id',
        body: 'like.ZZZ RLS Note%',
        deleted_at: 'is.null',
      }),
    );
    for (const row of rows) await pgRpc('delete_note', jwt, { p_note_id: row.id });
  }

  beforeAll(async () => {
    const { email, password } = requireEnv();
    jwt = await login(email, password);

    const { rows } = await pgGet<WorkspaceRow>(
      'workspace',
      jwt,
      new URLSearchParams({ select: 'id,slug', slug: 'eq.playwright' }),
    );
    expect(rows.length, 'playwright workspace must be reachable').toBe(1);
    playwrightWsId = rows[0].id;

    await sweepLeftovers();
  });

  afterAll(async () => {
    if (!jwt) return;
    await sweepLeftovers();
  });

  test('create_note writes a private note with no anchor (the company)', async () => {
    const res = await pgRpc<NoteRow>('create_note', jwt, {
      p_body: BODY,
      p_on_day: TODAY,
      p_workspace_id: playwrightWsId,
    });
    expect(res.status, res.error).toBe(200);
    expect(res.data).toBeTruthy();
    noteId = res.data!.id;

    expect(res.data!.workspace_id).toBe(playwrightWsId);
    expect(res.data!.on_day).toBe(TODAY);
    // The default, and in v1 the only reachable value.
    expect(res.data!.visibility).toBe('private');
    expect(res.data!.project_id).toBeNull();
    expect(res.data!.person_id).toBeNull();
  });

  test('the author reads it back', async () => {
    const { rows } = await pgGet<NoteRow>(
      'note',
      jwt,
      new URLSearchParams({ select: 'id,body', id: `eq.${noteId}` }),
    );
    expect(rows.map((r) => r.body)).toEqual([BODY]);
  });

  test('two anchors are rejected', async () => {
    const { rows: projects } = await pgGet<{ id: string }>(
      'project',
      jwt,
      new URLSearchParams({
        select: 'id',
        workspace_id: `eq.${playwrightWsId}`,
        deleted_at: 'is.null',
        limit: '1',
      }),
    );
    if (projects.length === 0) return; // no project in the fixture: nothing to assert
    const res = await pgRpc('create_note', jwt, {
      p_body: `${BODY} two-anchors`,
      p_on_day: TODAY,
      p_project_id: projects[0].id,
      p_line_id: projects[0].id, // shape is what matters, not that it resolves
    });
    expect(res.status).toBe(400);
  });

  test('a workspace the caller is not in collapses to 42501 (no existence oracle)', async () => {
    const res = await pgRpc('create_note', jwt, {
      p_body: `${BODY} foreign`,
      p_on_day: TODAY,
      p_workspace_id: RANDOM_UUID,
    });
    expect(res.status).toBe(403);
  });

  test('a person with no dossier here cannot be written about (ADR-085)', async () => {
    const res = await pgRpc('create_note', jwt, {
      p_body: `${BODY} no-dossier`,
      p_on_day: TODAY,
      p_workspace_id: playwrightWsId,
      p_person_id: RANDOM_UUID,
    });
    expect(res.status).toBe(403);
  });

  test('a client CANNOT soft-delete: the SELECT policy guards the new row', async () => {
    const res = await pgPatch<NoteRow>(
      'note',
      jwt,
      { deleted_at: new Date().toISOString() },
      new URLSearchParams({ id: `eq.${noteId}` }),
    );
    // 403 from the WITH CHECK path. If this ever returns 200, `delete_note`
    // has become removable — and the whole reason it exists has evaporated.
    expect(res.status).toBe(403);

    const { rows } = await pgGet<NoteRow>(
      'note',
      jwt,
      new URLSearchParams({ select: 'id', id: `eq.${noteId}`, deleted_at: 'is.null' }),
    );
    expect(rows.length, 'the note survived the illegal delete').toBe(1);
  });

  test('the anchor is immutable', async () => {
    const res = await pgPatch<NoteRow>(
      'note',
      jwt,
      { project_id: RANDOM_UUID },
      new URLSearchParams({ id: `eq.${noteId}` }),
    );
    expect(res.status).toBeGreaterThanOrEqual(400);
  });

  test('the body can be rewritten', async () => {
    const res = await pgPatch<NoteRow>(
      'note',
      jwt,
      { body: `${BODY} rewritten` },
      new URLSearchParams({ id: `eq.${noteId}` }),
    );
    expect(res.status).toBe(200);
    expect(res.rows[0]?.body).toBe(`${BODY} rewritten`);
  });

  test('person_note is gone — table and both RPCs', async () => {
    const table = await pgGet('person_note', jwt, new URLSearchParams({ select: 'id', limit: '1' }));
    expect(table.status, 'person_note must not resolve').toBeGreaterThanOrEqual(400);

    const create = await pgRpc('create_person_note', jwt, {});
    expect(create.status).toBeGreaterThanOrEqual(400);

    const del = await pgRpc('delete_person_note', jwt, { p_note_id: RANDOM_UUID });
    expect(del.status).toBeGreaterThanOrEqual(400);
  });

  describe.skipIf(!limitedEnvReady())('a second member of the same workspace', () => {
    let limitedJwt: string;

    beforeAll(async () => {
      const { email, password } = requireLimitedEnv();
      limitedJwt = await login(email, password);
    });

    test('sees NOTHING of the other member notes — this is the law', async () => {
      const { rows } = await pgGet<NoteRow>(
        'note',
        limitedJwt,
        new URLSearchParams({ select: 'id,body', body: 'like.ZZZ RLS Note%' }),
      );
      expect(rows, 'a note is private, full stop').toEqual([]);
    });

    test('cannot rewrite them either', async () => {
      const res = await pgPatch<NoteRow>(
        'note',
        limitedJwt,
        { body: 'hijacked' },
        new URLSearchParams({ id: `eq.${noteId}` }),
      );
      // Zero rows on a 2xx = RLS matched nothing, which is the same wall.
      expect(res.rows.length).toBe(0);
    });

    test('cannot delete them', async () => {
      const res = await pgRpc('delete_note', limitedJwt, { p_note_id: noteId });
      expect(res.status).toBe(403);
    });

    test('reads its OWN note without read:person_note_private (ADR-093 §5)', async () => {
      const { rows: ws } = await pgGet<WorkspaceRow>(
        'workspace',
        limitedJwt,
        new URLSearchParams({ select: 'id,slug', slug: 'eq.playwright' }),
      );
      expect(ws.length, 'the limited fixture is a member of playwright').toBe(1);

      const created = await pgRpc<NoteRow>('create_note', limitedJwt, {
        p_body: `${BODY} limited`,
        p_on_day: TODAY,
        p_workspace_id: ws[0].id,
      });
      expect(created.status, created.error).toBe(200);

      const { rows } = await pgGet<NoteRow>(
        'note',
        limitedJwt,
        new URLSearchParams({ select: 'id,body', id: `eq.${created.data!.id}` }),
      );
      expect(rows.length, 'a member with no project grants reads its own note').toBe(1);

      await pgRpc('delete_note', limitedJwt, { p_note_id: created.data!.id });
    });
  });
});
