/**
 * RLS regression — conversation + performance write-path RPCs (ADR-051/052).
 *
 * Exercises the SECURITY DEFINER RPCs create_conversation /
 * delete_conversation / delete_performance against the live project, as the
 * fixture user and as anon. Lifecycle fixtures are created in the
 * `playwright` workspace (project `zzz-e2e-collab`) and soft-deleted
 * before the file ends — cross-tenant.test.ts asserts membership-bounded
 * visibility, so a transient fixture here can't break it.
 *
 * PostgREST status mapping under test: RAISE 42501 → 403, 22023 → 400,
 * unique_violation 23505 → 409, 23503 → 409. Grants: anon has NO EXECUTE
 * on any of the three functions (the ADR-043 PUBLIC-grant lesson).
 */

import { beforeAll, describe, expect, test } from 'vitest';
import { envReady, login, pgGet, pgPatch, pgRpc, requireEnv } from './_helpers';

type ConversationRow = {
  id: string;
  slug: string;
  status: string;
  person_id: string;
  project_id: string;
  workspace_id: string;
  first_contacted_at: string | null;
  last_contacted_at: string | null;
};

type PerformanceRow = { id: string; slug: string | null; status: string };

const RANDOM_UUID = '00000000-0000-4000-8000-000000000000';
// STABLE fixture email (the person find-or-create path dedupes on it, so
// a fresh email per run would leak a new global person every run). The
// conversation is soft-deleted in each test's `finally`; a run killed
// between create and cleanup would leave the triple live, so beforeAll
// recovers it (see below). RUN_TAG only disambiguates the throwaway gig.
const RUN_TAG = `${Date.now().toString(36)}`;
const FIXTURE_EMAIL = `zzz-rls-lifecycle@hour.test`;
const FIXTURE_NAME = 'ZZZ RLS Lifecycle Fixture';

describe.skipIf(!envReady())('RLS — ADR-051/052 write-path RPCs', () => {
  let jwt: string;
  let projectId: string;

  beforeAll(async () => {
    const { email, password } = requireEnv();
    jwt = await login(email, password);

    // Fixture project: the e2e project inside the `playwright` workspace.
    const projects = await pgGet<{ id: string; workspace: { slug: string } }>(
      'project',
      jwt,
      new URLSearchParams({
        select: 'id,workspace:workspace_id!inner(slug)',
        'workspace.slug': 'eq.playwright',
        deleted_at: 'is.null',
        order: 'id.asc',
        limit: '1',
      }),
    );
    if (projects.rows.length === 0) {
      throw new Error('No live project in the playwright workspace — fixtures missing');
    }
    projectId = projects.rows[0].id;

    // Crash recovery: a prior run killed mid-test may have left the
    // fixture conversation LIVE, which would 23505 → 409 the first create
    // below and wedge the suite red forever. Soft-delete any leftover.
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
    for (const row of stale.rows) {
      await pgRpc('delete_conversation', jwt, { p_conversation_id: row.id });
    }
  });

  test('anon cannot execute create_conversation (no grant)', async () => {
    const { status } = await pgRpc('create_conversation', null, {
      p_project_id: RANDOM_UUID,
      p_full_name: 'anon was here',
    });
    expect(status).toBeGreaterThanOrEqual(400);
  });

  test('anon cannot execute delete_conversation / delete_performance (no grant)', async () => {
    const eng = await pgRpc('delete_conversation', null, { p_conversation_id: RANDOM_UUID });
    expect(eng.status).toBeGreaterThanOrEqual(400);
    const perf = await pgRpc('delete_performance', null, { p_performance_id: RANDOM_UUID });
    expect(perf.status).toBeGreaterThanOrEqual(400);
  });

  test('create_conversation against an unknown project → 403 (no existence oracle)', async () => {
    const { status } = await pgRpc('create_conversation', jwt, {
      p_project_id: RANDOM_UUID,
      p_full_name: FIXTURE_NAME,
    });
    expect(status).toBe(403);
  });

  test('create_conversation without person_id nor full_name → 400', async () => {
    const { status } = await pgRpc('create_conversation', jwt, {
      p_project_id: projectId,
    });
    expect(status).toBe(400);
  });

  test('full lifecycle: create (inline person) → duplicate 409 → delete → resurrect → delete', async () => {
    // 1. Create with inline person. Email may match a soft-deleted person
    //    from a previous run — the RPC resurrects it (same outcome).
    const created = await pgRpc<ConversationRow>('create_conversation', jwt, {
      p_project_id: projectId,
      p_full_name: FIXTURE_NAME,
      p_email: FIXTURE_EMAIL,
      p_organization_name: `RLS run ${RUN_TAG}`,
      p_status: 'contacted',
    });
    expect(created.status).toBe(200);
    expect(created.data).not.toBeNull();
    const conversation = created.data as ConversationRow;
    expect(conversation.project_id).toBe(projectId);
    expect(conversation.status).toBe('contacted');
    expect(conversation.first_contacted_at).toBeTruthy();
    expect(conversation.last_contacted_at).toBeTruthy();

    try {
      // 2. A genuine status transition stamps last contact while the first
      // contact remains write-once. This is the DB invariant behind both the
      // API status menu and future trusted conversation-event ingress.
      const firstContact = conversation.first_contacted_at;
      const beforeLast = Date.parse(conversation.last_contacted_at!);
      const touched = await pgPatch<ConversationRow>(
        'conversation',
        jwt,
        { status: 'hold' },
        new URLSearchParams({
          id: `eq.${conversation.id}`,
          deleted_at: 'is.null',
          select: 'id,status,first_contacted_at,last_contacted_at',
        }),
      );
      expect(touched.status).toBe(200);
      expect(touched.rows).toHaveLength(1);
      expect(touched.rows[0].status).toBe('hold');
      expect(touched.rows[0].first_contacted_at).toBe(firstContact);
      expect(Date.parse(touched.rows[0].last_contacted_at!)).toBeGreaterThanOrEqual(beforeLast);

      // 3. Same person × project again → 23505 → 409 (no silent merge).
      const dup = await pgRpc('create_conversation', jwt, {
        p_project_id: projectId,
        p_full_name: FIXTURE_NAME,
        p_email: FIXTURE_EMAIL,
      });
      expect(dup.status).toBe(409);

      // 4. Soft-delete via RPC…
      const del = await pgRpc('delete_conversation', jwt, {
        p_conversation_id: conversation.id,
      });
      expect(del.status).toBeLessThan(300);

      // …and the row is gone from the live surface.
      const after = await pgGet<ConversationRow>(
        'conversation',
        jwt,
        new URLSearchParams({
          select: 'id',
          id: `eq.${conversation.id}`,
          deleted_at: 'is.null',
        }),
      );
      expect(after.rows).toHaveLength(0);

      // 5. Re-adding the same person resurrects the soft-deleted row —
      //    the FULL unique constraint must never dead-end the triple.
      const again = await pgRpc<ConversationRow>('create_conversation', jwt, {
        p_project_id: projectId,
        p_full_name: FIXTURE_NAME,
        p_email: FIXTURE_EMAIL,
        p_status: 'in_conversation',
      });
      expect(again.status).toBe(200);
      const resurrected = again.data as ConversationRow;
      expect(resurrected.id).toBe(conversation.id);
      expect(resurrected.status).toBe('in_conversation');
    } finally {
      // 6. Always leave the live surface clean.
      await pgRpc('delete_conversation', jwt, { p_conversation_id: conversation.id });
    }
  });

  test('delete_conversation against an unknown id → 403 (no existence oracle)', async () => {
    const { status } = await pgRpc('delete_conversation', jwt, {
      p_conversation_id: RANDOM_UUID,
    });
    expect(status).toBe(403);
  });

  test('performance lifecycle: create → delete → gone', async () => {
    const created = await pgRpc<PerformanceRow>('create_performance', jwt, {
      p_project_id: projectId,
      p_performed_at: '2099-12-31',
      p_venue_name: `zzz-rls-delete-${RUN_TAG}`,
      p_status: 'proposed',
    });
    expect(created.status).toBe(200);
    const perf = created.data as PerformanceRow;

    const del = await pgRpc('delete_performance', jwt, {
      p_performance_id: perf.id,
    });
    expect(del.status).toBeLessThan(300);

    const after = await pgGet<PerformanceRow>(
      'performance',
      jwt,
      new URLSearchParams({
        select: 'id',
        id: `eq.${perf.id}`,
        deleted_at: 'is.null',
      }),
    );
    expect(after.rows).toHaveLength(0);
  });

  test('delete_performance against an unknown id → 403 (no existence oracle)', async () => {
    const { status } = await pgRpc('delete_performance', jwt, {
      p_performance_id: RANDOM_UUID,
    });
    expect(status).toBe(403);
  });
});
