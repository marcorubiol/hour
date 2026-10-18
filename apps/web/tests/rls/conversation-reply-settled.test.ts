/**
 * RLS — «No pide respuesta» (ADR-126 § 1, migración
 * 20261018140000_conversation_reply_settled). `reply_settled_at` is a new
 * column on a table with column-level UPDATE grants: without its grant every
 * PATCH that names it is a 403 (permission denied for column). The policy is
 * the conversation's own: edit:conversation in the project.
 *
 * Writes on the fixture's own `playwright` space and puts the value back.
 */

import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { envReady, limitedEnvReady, login, pgGet, pgPatch, requireEnv, requireLimitedEnv } from './_helpers';

type Row = { id: string; reply_settled_at: string | null };

describe.skipIf(!envReady())('RLS — reply_settled_at', () => {
  let jwt: string;
  let row: Row;

  beforeAll(async () => {
    const { email, password } = requireEnv();
    jwt = await login(email, password);
    const picked = await pgGet<Row & { workspace: { slug: string }; project: { slug: string } }>(
      'conversation',
      jwt,
      new URLSearchParams({
        select: 'id,reply_settled_at,workspace!inner(slug),project!inner(slug)',
        'workspace.slug': 'eq.playwright',
        'project.slug': 'eq.zzz-difusion',
        deleted_at: 'is.null',
        order: 'id.asc',
        limit: '1',
      }),
    );
    expect(picked.rows).toHaveLength(1);
    row = { id: picked.rows[0].id, reply_settled_at: picked.rows[0].reply_settled_at };
  });

  afterAll(async () => {
    if (row) {
      await pgPatch('conversation', jwt, { reply_settled_at: row.reply_settled_at }, new URLSearchParams({ id: `eq.${row.id}` }));
    }
  });

  test('who edits the conversation can mark a reply as settled, and clear it', async () => {
    const at = '2026-10-17T14:00:00.000Z';
    const set = await pgPatch<Row>(
      'conversation',
      jwt,
      { reply_settled_at: at },
      new URLSearchParams({ id: `eq.${row.id}`, deleted_at: 'is.null', select: 'id,reply_settled_at' }),
    );
    expect(set.status).toBe(200);
    expect(Date.parse(set.rows[0].reply_settled_at!)).toBe(Date.parse(at));

    const cleared = await pgPatch<Row>(
      'conversation',
      jwt,
      { reply_settled_at: null },
      new URLSearchParams({ id: `eq.${row.id}`, select: 'id,reply_settled_at' }),
    );
    expect(cleared.status).toBe(200);
    expect(cleared.rows[0].reply_settled_at).toBeNull();
  });

  test.skipIf(!limitedEnvReady())('without Converses it touches nothing', async () => {
    const { email, password } = requireLimitedEnv();
    const limited = await login(email, password);
    const { rows } = await pgPatch<Row>(
      'conversation',
      limited,
      { reply_settled_at: '2026-10-17T14:00:00.000Z' },
      new URLSearchParams({ id: `eq.${row.id}`, select: 'id,reply_settled_at' }),
    );
    expect(rows).toHaveLength(0);
  });
});
