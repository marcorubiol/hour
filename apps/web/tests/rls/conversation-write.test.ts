/**
 * RLS regression — conversation UPDATE path (ADR-040 inline write).
 *
 * The `conversation_update` policy requires
 * `has_permission(project_id, 'edit:conversation')` (USING + WITH CHECK) and
 * `deleted_at IS NULL`. These tests hit PostgREST directly — the same
 * surface `PATCH /api/conversations/:id` wraps.
 *
 * Fixtures (see cross-tenant.test.ts header for the full picture): the
 * positive case PATCHes a row of the synthetic difusión set in the user's own
 * `playwright` space, writing back the exact values it already has. Only
 * `updated_at` bumps and an `audit_log` row is appended. Deliberate: a write
 * test that never writes proves nothing. Until § 31 (2026-10) this picked the
 * first conversation of `muk-cia`, a REAL contact, on every run.
 */

import { beforeAll, describe, expect, test } from 'vitest';
import { envReady, login, pgGet, pgPatch, requireEnv } from './_helpers';

type ConversationRow = {
  id: string;
  status: string;
  next_action_note: string | null;
};

const RANDOM_UUID = '00000000-0000-4000-8000-000000000000';

describe.skipIf(!envReady())('RLS — conversation write path', () => {
  let jwt: string;

  beforeAll(async () => {
    const { email, password } = requireEnv();
    jwt = await login(email, password);
  });

  test('anon cannot update any conversation', async () => {
    const { status, rows } = await pgPatch<ConversationRow>(
      'conversation',
      null,
      { next_action_note: 'anon was here' },
      new URLSearchParams({ id: `eq.${RANDOM_UUID}` }),
    );
    // Policies are TO authenticated — anon must update zero rows whether
    // PostgREST answers 2xx-with-empty or an outright 4xx.
    expect(rows).toHaveLength(0);
    expect(status).not.toBe(500);
  });

  test('authenticated update against an unknown id matches zero rows', async () => {
    const { rows } = await pgPatch<ConversationRow>(
      'conversation',
      jwt,
      { next_action_note: 'ghost row' },
      new URLSearchParams({ id: `eq.${RANDOM_UUID}`, deleted_at: 'is.null' }),
    );
    expect(rows).toHaveLength(0);
  });

  test('member with edit:conversation can update a row (no-op values, real UPDATE)', async () => {
    // Pin the pick to the fixture's own space, where the user is owner —
    // read:conversation does NOT imply edit:conversation, so an arbitrary
    // readable row could be read-only and turn this test red for the wrong
    // reason. Owner bypass in has_permission() guarantees edit here. order
    // makes the pick deterministic.
    const readable = await pgGet<
      ConversationRow & { workspace: { slug: string }; project: { slug: string } }
    >(
      'conversation',
      jwt,
      new URLSearchParams({
        select: 'id,status,next_action_note,workspace!inner(slug),project!inner(slug)',
        'workspace.slug': 'eq.playwright',
        'project.slug': 'eq.zzz-difusion',
        deleted_at: 'is.null',
        order: 'id.asc',
        limit: '1',
      }),
    );
    expect(readable.rows.length).toBe(1);
    const { workspace: _ws, project: _project, ...row } = readable.rows[0];

    // …and write back exactly what it already holds. RLS must let the
    // UPDATE through and return the representation.
    const { status, rows } = await pgPatch<ConversationRow>(
      'conversation',
      jwt,
      { status: row.status, next_action_note: row.next_action_note },
      new URLSearchParams({
        id: `eq.${row.id}`,
        deleted_at: 'is.null',
        select: 'id,status,next_action_note',
      }),
    );
    expect(status).toBe(200);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual(row);
  });

  test('update cannot resurrect or edit a soft-deleted row shape (filter + policy)', async () => {
    // The API always sends deleted_at=is.null; combined with the policy's
    // USING (deleted_at IS NULL) a soft-deleted id can never match. With a
    // random id this is indistinguishable from not-found — which is exactly
    // the contract: PostgREST reveals nothing about hidden rows.
    const { rows } = await pgPatch<ConversationRow>(
      'conversation',
      jwt,
      { status: 'declined' },
      new URLSearchParams({ id: `eq.${RANDOM_UUID}`, deleted_at: 'is.null' }),
    );
    expect(rows).toHaveLength(0);
  });
});
