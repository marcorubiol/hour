/**
 * 92 · `venue.organization_id` (`20261102130000_venue_organization`) y
 * 84 · fusionar organizaciones con deshacer (`20261102140000_organization_merge`).
 *
 * 92: la sala apunta a una organización viva de su espacio; una que no existe
 * (FK compuesta) o borrada (guard, 23514) no entra.
 *
 * 84: `preview_organization_merge`, `merge_workspace_organization` y
 * `undo_organization_merge`: solo el admin del espacio; lo que no existe,
 * 42501 (403) sin decir cuál; la misma, 22023 (400). La fusión mueve
 * conversaciones y salas, deja la que desaparece borrada y su slug en
 * `previous_slugs`; deshacer devuelve todo y no se repite; dos conversaciones
 * del mismo proyecto con las dos organizaciones bloquean la fusión (22023);
 * `organization_merge_row` no la lee nadie.
 *
 * Lo que este fichero no monta por PostgREST (facturas y contactos movidos y
 * devueltos) se probó en SQL contra la Supabase local, dentro de una
 * transacción con ROLLBACK, el 2026-11-01.
 *
 * En `zzz-e2e-collab` (`playwright`). Lo que crea lo borra; las filas de
 * `organization_merge` se quedan (no hay borrado: son historia).
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

type Conversation = { id: string; organization_id: string };
type Org = { id: string; slug: string; previous_slugs: string[] };
type Preview = { counts: Record<string, number>; conflicts: Record<string, number> };

const RUN = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const one = <T>(data: T | T[] | null): T | undefined => (Array.isArray(data) ? data[0] : (data ?? undefined));

describe.skipIf(!envReady())('RLS — venue organization (92) and organization merge (84)', () => {
  let jwt: string;
  let workspaceId: string;
  let projectId: string;
  const conversations: string[] = [];
  const venues: string[] = [];
  const orgs = new Set<string>();

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
    const { url, anon } = requireEnv();
    for (const id of venues) {
      await fetch(`${url}/rest/v1/venue?id=eq.${id}`, {
        method: 'DELETE',
        headers: { apikey: anon, Authorization: `Bearer ${jwt}` },
      });
    }
    for (const id of conversations) await pgRpc('delete_conversation', jwt, { p_conversation_id: id });
    for (const id of orgs) await pgRpc('delete_workspace_organization', jwt, { p_organization_id: id });
  });

  /** A conversation with a new organization of that name (the only way to make one). */
  const conversation = async (orgName: string, organizationId?: string) => {
    const r = await pgRpc<Conversation>('create_conversation', jwt, {
      p_project_id: projectId,
      ...(organizationId ? { p_organization_id: organizationId } : { p_organization_name: orgName }),
    });
    expect(r.status, r.error).toBe(200);
    const row = one(r.data)!;
    conversations.push(row.id);
    orgs.add(row.organization_id);
    return row;
  };

  /** An organization with no live conversation: made through one, which then goes. */
  const bareOrg = async (name: string) => {
    const c = await conversation(name);
    const del = await pgRpc('delete_conversation', jwt, { p_conversation_id: c.id });
    expect(del.status).toBeLessThan(300);
    return c.organization_id;
  };

  const venue = async () => {
    const r = await pgRpc<{ id: string }>('create_venue', jwt, {
      p_workspace_id: workspaceId,
      p_name: `ZZZ Sala Org ${RUN} ${venues.length}`,
      p_city: 'Girona',
    });
    expect(r.status, r.error).toBe(200);
    const id = one(r.data)!.id;
    venues.push(id);
    return id;
  };

  const setVenueOrg = (id: string, organizationId: string | null) =>
    pgPatch<{ id: string; organization_id: string | null }>(
      'venue',
      jwt,
      { organization_id: organizationId },
      new URLSearchParams({ id: `eq.${id}`, select: 'id,organization_id' }),
    );

  const orgOf = async (conversationId: string) =>
    (
      await pgGet<Conversation>(
        'conversation',
        jwt,
        new URLSearchParams({ select: 'id,organization_id', id: `eq.${conversationId}` }),
      )
    ).rows[0]?.organization_id;

  test('92: a venue points at a live organization of its space, nothing else', async () => {
    const v = await venue();
    const org = await bareOrg(`Zzz Venue Org ${RUN}`);
    const ok = await setVenueOrg(v, org);
    expect(ok.status).toBe(200);
    expect(ok.rows[0]?.organization_id).toBe(org);

    const ghost = await setVenueOrg(v, crypto.randomUUID());
    expect(ghost.status).toBeGreaterThanOrEqual(400);

    const dead = await bareOrg(`Zzz Dead Org ${RUN}`);
    const gone = await pgRpc('delete_workspace_organization', jwt, { p_organization_id: dead });
    expect(gone.status).toBe(204);
    const refused = await setVenueOrg(v, dead);
    expect(refused.status).toBe(400);

    const cleared = await setVenueOrg(v, null);
    expect(cleared.rows[0]?.organization_id).toBeNull();
  });

  test('84: gates — the same one, one that does not exist', async () => {
    const a = await bareOrg(`Zzz Merge Self ${RUN}`);
    const self = await pgRpc('merge_workspace_organization', jwt, {
      p_workspace_id: workspaceId,
      p_keep_organization_id: a,
      p_drop_organization_id: a,
    });
    expect(self.status).toBe(400);
    const ghost = await pgRpc('merge_workspace_organization', jwt, {
      p_workspace_id: workspaceId,
      p_keep_organization_id: a,
      p_drop_organization_id: crypto.randomUUID(),
    });
    expect(ghost.status).toBe(403);
    const anon = await pgRpc('preview_organization_merge', null, {
      p_workspace_id: workspaceId,
      p_keep_organization_id: a,
      p_drop_organization_id: a,
    });
    expect(anon.status).toBeGreaterThanOrEqual(400);
  });

  test.skipIf(!limitedEnvReady())('84: a member who is not admin cannot preview, merge or undo', async () => {
    const lim = requireLimitedEnv();
    const member = await login(lim.email, lim.password);
    const keep = await bareOrg(`Zzz Merge Keep L ${RUN}`);
    const drop = await bareOrg(`Zzz Merge Drop L ${RUN}`);
    const args = { p_workspace_id: workspaceId, p_keep_organization_id: keep, p_drop_organization_id: drop };
    expect((await pgRpc('preview_organization_merge', member, args)).status).toBe(403);
    expect((await pgRpc('merge_workspace_organization', member, args)).status).toBe(403);
    expect((await pgRpc('undo_organization_merge', member, { p_merge_id: crypto.randomUUID() })).status).toBe(403);
  });

  test('84: merge moves conversations and venues; undo brings them back, once', async () => {
    const keep = await bareOrg(`Zzz Merge Keep ${RUN}`);
    const dropConv = await conversation(`Zzz Merge Drop ${RUN}`);
    const drop = dropConv.organization_id;
    const v = await venue();
    expect((await setVenueOrg(v, drop)).status).toBe(200);
    const args = { p_workspace_id: workspaceId, p_keep_organization_id: keep, p_drop_organization_id: drop };

    const preview = await pgRpc<Preview>('preview_organization_merge', jwt, args);
    expect(preview.status, preview.error).toBe(200);
    expect(preview.data!.counts.conversations).toBe(1);
    expect(preview.data!.counts.venues).toBe(1);
    expect(preview.data!.conflicts.conversations).toBe(0);

    const merged = await pgRpc<{ merge_id: string }>('merge_workspace_organization', jwt, args);
    expect(merged.status, merged.error).toBe(200);
    const mergeId = merged.data!.merge_id;

    expect(await orgOf(dropConv.id)).toBe(keep);
    const kept = await pgGet<Org>(
      'workspace_organization',
      jwt,
      new URLSearchParams({ select: 'id,slug,previous_slugs', id: `in.(${keep},${drop})` }),
    );
    expect(kept.rows.map((o) => o.id)).toEqual([keep]);
    expect(kept.rows[0]!.previous_slugs.length).toBeGreaterThan(0);

    const rows = await pgGet('organization_merge_row', jwt, new URLSearchParams({ select: 'id', limit: '1' }));
    expect(rows.rows).toHaveLength(0);

    const undone = await pgRpc<{ skipped: number }>('undo_organization_merge', jwt, { p_merge_id: mergeId });
    expect(undone.status, undone.error).toBe(200);
    expect(undone.data!.skipped).toBe(0);
    expect(await orgOf(dropConv.id)).toBe(drop);
    const back = await pgGet<{ organization_id: string }>(
      'venue',
      jwt,
      new URLSearchParams({ select: 'organization_id', id: `eq.${v}` }),
    );
    expect(back.rows[0]?.organization_id).toBe(drop);

    const twice = await pgRpc('undo_organization_merge', jwt, { p_merge_id: mergeId });
    expect(twice.status).toBe(400);

    // Clean the venue link so the organization can go in afterAll.
    await setVenueOrg(v, null);
  });

  test('84: two conversations of the same project block the merge', async () => {
    const keepConv = await conversation(`Zzz Conflict Keep ${RUN}`);
    const dropConv = await conversation(`Zzz Conflict Drop ${RUN}`);
    const args = {
      p_workspace_id: workspaceId,
      p_keep_organization_id: keepConv.organization_id,
      p_drop_organization_id: dropConv.organization_id,
    };
    const preview = await pgRpc<Preview>('preview_organization_merge', jwt, args);
    expect(preview.status, preview.error).toBe(200);
    expect(preview.data!.conflicts.conversations).toBe(1);
    const merged = await pgRpc('merge_workspace_organization', jwt, args);
    expect(merged.status).toBe(400);
    expect(await orgOf(dropConv.id)).toBe(dropConv.organization_id);
  });
});
