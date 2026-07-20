/**
 * RLS regression — portable identity + workspace-private dossiers.
 *
 * The same `person_id` may intentionally appear in several workspaces, but
 * each workspace owns a different workspace_person row. Visibility must be
 * bounded by accepted workspace membership; profile sharing is an explicit
 * user action and may only target a workspace the caller belongs to.
 */

import { beforeAll, describe, expect, test } from 'vitest';
import { envReady, login, pgGet, pgPatch, pgRpc, requireEnv } from './_helpers';

type WorkspaceRow = { id: string; slug: string };
type WorkspacePersonRow = {
  workspace_id: string;
  person_id: string;
  full_name: string;
  profile_sync_enabled: boolean;
};

describe.skipIf(!envReady())('RLS — workspace identity boundary', () => {
  let jwt: string;
  let ownWorkspace: WorkspaceRow;

  beforeAll(async () => {
    const { email, password } = requireEnv();
    jwt = await login(email, password);

    const workspaces = await pgGet<WorkspaceRow>(
      'workspace',
      jwt,
      new URLSearchParams({ select: 'id,slug', slug: 'eq.playwright', limit: '1' }),
    );
    expect(workspaces.status).toBe(200);
    expect(workspaces.rows).toHaveLength(1);
    ownWorkspace = workspaces.rows[0];
  });

  test('anonymous callers see neither dossiers nor organizations', async () => {
    const [people, organizations] = await Promise.all([
      pgGet('workspace_person', null),
      pgGet('workspace_organization', null),
    ]);
    expect(people.rows).toHaveLength(0);
    expect(organizations.rows).toHaveLength(0);
  });

  test('every visible dossier belongs to an accepted workspace membership', async () => {
    const [people, memberships] = await Promise.all([
      pgGet<WorkspacePersonRow>(
        'workspace_person',
        jwt,
        new URLSearchParams({ select: 'workspace_id,person_id,full_name,profile_sync_enabled' }),
      ),
      pgGet<{ workspace_id: string }>(
        'workspace_membership',
        jwt,
        new URLSearchParams({ select: 'workspace_id', accepted_at: 'not.is.null' }),
      ),
    ]);
    expect(people.status).toBe(200);
    const allowed = new Set(memberships.rows.map((membership) => membership.workspace_id));
    expect(people.rows.every((person) => allowed.has(person.workspace_id))).toBe(true);
  });

  test('dossiers cannot be edited through direct PostgREST writes', async () => {
    const people = await pgGet<WorkspacePersonRow>(
      'workspace_person',
      jwt,
      new URLSearchParams({
        select: 'workspace_id,person_id,full_name,profile_sync_enabled',
        workspace_id: `eq.${ownWorkspace.id}`,
        limit: '1',
      }),
    );
    expect(people.status).toBe(200);
    expect(people.rows).not.toHaveLength(0);

    const person = people.rows[0];
    const result = await pgPatch(
      'workspace_person',
      jwt,
      { full_name: person.full_name },
      new URLSearchParams({
        workspace_id: `eq.${person.workspace_id}`,
        person_id: `eq.${person.person_id}`,
      }),
    );
    expect(result.status).toBeGreaterThanOrEqual(400);
  });

  test('explicit sharing creates or refreshes the caller dossier', async () => {
    const shared = await pgRpc<WorkspacePersonRow>('share_my_profile_with_workspace', jwt, {
      p_workspace_id: ownWorkspace.id,
      p_fields: ['full_name'],
    });
    expect(shared.status).toBeLessThan(300);
    expect(shared.data?.workspace_id).toBe(ownWorkspace.id);
    expect(shared.data?.profile_sync_enabled).toBe(true);

    const dossier = await pgGet<WorkspacePersonRow>(
      'workspace_person',
      jwt,
      new URLSearchParams({
        select: 'workspace_id,person_id,full_name,profile_sync_enabled',
        workspace_id: `eq.${ownWorkspace.id}`,
        person_id: `eq.${shared.data?.person_id ?? ''}`,
      }),
    );
    expect(dossier.rows).toHaveLength(1);
    expect(dossier.rows[0].profile_sync_enabled).toBe(true);
  });

  test('profile sharing rejects an unknown/non-member workspace', async () => {
    const result = await pgRpc('share_my_profile_with_workspace', jwt, {
      p_workspace_id: '00000000-0000-4000-8000-000000000001',
      p_fields: ['full_name'],
    });
    expect(result.status).toBe(403);
  });
});
