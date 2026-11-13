/**
 * RLS: the public road sheet and the invitation preview say their space's
 * trade (tarea 143, `20261113110000_public_trade`; ADR-129 § 7).
 *
 * Both screens live outside the shell, with no feed of spaces to take the
 * trade from, so the RPC brings it: `get_public_roadsheet` as a `trade` key of
 * its jsonb, `preview_workspace_invitation` as a `workspace_trade` column. The
 * value is the space's `workspace.trade`, and nothing else of either answer
 * changes: the same keys or columns as before, plus that one.
 *
 * In `playwright`, on a 2031 performance of `zzz-e2e-collab` it creates, and
 * an invitation to the external fixture it never accepts. Revokes and deletes
 * what it creates. It does not change the space's trade: other suites read it.
 */

import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { envReady, externalEnvReady, login, pgGet, pgRpc, requireEnv, requireExternalEnv } from './_helpers';

const RUN = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const one = <T>(data: T | T[] | null): T | undefined => (Array.isArray(data) ? data[0] : (data ?? undefined));

describe.skipIf(!envReady())('RLS: public road sheet says the trade (143)', () => {
  let jwt: string;
  let perfId: string;
  let trade: string;
  const shares: string[] = [];

  beforeAll(async () => {
    const env = requireEnv();
    jwt = await login(env.email, env.password);
    const ws = await pgGet<{ id: string; trade: string }>(
      'workspace',
      jwt,
      new URLSearchParams({ slug: 'eq.playwright', select: 'id,trade' }),
    );
    if (ws.rows.length === 0) throw new Error('playwright missing');
    trade = ws.rows[0]!.trade;
    const p = await pgGet<{ id: string }>(
      'project',
      jwt,
      new URLSearchParams({
        select: 'id',
        workspace_id: `eq.${ws.rows[0]!.id}`,
        slug: 'eq.zzz-e2e-collab',
        deleted_at: 'is.null',
        limit: '1',
      }),
    );
    if (p.rows.length === 0) throw new Error('zzz-e2e-collab missing in playwright');
    const perf = await pgRpc<{ id: string }>('create_performance', jwt, {
      p_project_id: p.rows[0]!.id,
      p_performed_at: '2031-08-13',
      p_status: 'hold_1',
      p_venue_name: `ZZZ Trade ${RUN}`,
    });
    expect(perf.status, perf.error).toBe(200);
    perfId = one(perf.data)!.id;
  });

  afterAll(async () => {
    if (!jwt) return;
    for (const id of shares) await pgRpc('revoke_roadsheet_share', jwt, { p_share_id: id });
    if (perfId) await pgRpc('delete_performance', jwt, { p_performance_id: perfId });
  });

  test('a role link carries the space trade, and only that key is new', async () => {
    const s = await pgRpc<{ id: string; token: string }>('create_roadsheet_share', jwt, {
      p_performance_id: perfId,
      p_role: 'performer',
    });
    expect(s.status, s.error).toBe(200);
    const share = one(s.data)!;
    shares.push(share.id);

    const pub = await pgRpc<Record<string, unknown>>('get_public_roadsheet', null, { p_token: share.token });
    expect(pub.status, pub.error).toBe(200);
    const b = one<Record<string, unknown>>(pub.data)!;
    expect(b.trade).toBe(trade);
    expect(['stage', 'music']).toContain(b.trade);
    // Lo que una hoja de papel devolvía antes (20261106100000), más `trade`.
    expect(Object.keys(b).sort()).toEqual(
      [
        'assets',
        'cast',
        'cast_overrides',
        'crew',
        'late_moves',
        'materials',
        'performance',
        'project',
        'role',
        'trade',
        'travel',
        'venue',
      ].sort(),
    );
  });

  test('a revoked link still returns nothing, trade or not', async () => {
    const s = await pgRpc<{ id: string; token: string }>('create_roadsheet_share', jwt, {
      p_performance_id: perfId,
      p_role: 'venue',
    });
    expect(s.status, s.error).toBe(200);
    const share = one(s.data)!;
    await pgRpc('revoke_roadsheet_share', jwt, { p_share_id: share.id });
    const pub = await pgRpc<unknown>('get_public_roadsheet', null, { p_token: share.token });
    expect(pub.status, pub.error).toBe(200);
    expect(pub.data).toBeNull();
  });
});

describe.skipIf(!envReady() || !externalEnvReady())('RLS: invitation preview says the trade (143)', () => {
  let adminJwt: string;
  let externalJwt: string;
  let workspaceId: string;
  let trade: string;
  let invitationId: string | null = null;
  let token: string;

  beforeAll(async () => {
    const admin = requireEnv();
    const external = requireExternalEnv();
    adminJwt = await login(admin.email, admin.password);
    externalJwt = await login(external.email, external.password);
    const ws = await pgGet<{ id: string; trade: string }>(
      'workspace',
      adminJwt,
      new URLSearchParams({ slug: 'eq.playwright', select: 'id,trade' }),
    );
    workspaceId = ws.rows[0]!.id;
    trade = ws.rows[0]!.trade;
    const projects = await pgGet<{ id: string }>(
      'project',
      adminJwt,
      new URLSearchParams({ workspace_id: `eq.${workspaceId}`, slug: 'eq.zzz-e2e-collab', select: 'id' }),
    );
    const created = await pgRpc<Array<{ id: string; token: string }>>('create_workspace_invitation', adminJwt, {
      p_workspace_id: workspaceId,
      p_email: external.email,
      p_role: 'guest',
      p_project_id: projects.rows[0]!.id,
      p_project_role_code: 'performer',
      p_expires_days: 7,
      p_project_preset: 'minim',
    });
    expect(created.status, created.error).toBe(200);
    invitationId = created.data![0]!.id;
    token = created.data![0]!.token;
  });

  afterAll(async () => {
    if (invitationId) await pgRpc('revoke_workspace_invitation', adminJwt, { p_invitation_id: invitationId });
  });

  test('the invitee reads the space trade as `workspace_trade`, and only that column is new', async () => {
    const preview = await pgRpc<Array<Record<string, unknown>>>('preview_workspace_invitation', externalJwt, {
      p_token: token,
    });
    expect(preview.status, preview.error).toBe(200);
    expect(preview.data).toHaveLength(1);
    const row = preview.data![0]!;
    expect(row.workspace_id).toBe(workspaceId);
    expect(row.workspace_trade).toBe(trade);
    // Las columnas de 20261022150100, más `workspace_trade`.
    expect(Object.keys(row).sort()).toEqual(
      [
        'bolo_access_last_day',
        'bolo_id',
        'bolo_label',
        'bolo_preset',
        'email',
        'expires_at',
        'landing_performance_id',
        'landing_performed_at',
        'project_id',
        'project_name',
        'project_role_code',
        'role',
        'workspace_id',
        'workspace_name',
        'workspace_slug',
        'workspace_trade',
      ].sort(),
    );
  });

  test('anon still cannot preview (the grants came back as they were)', async () => {
    const anon = await pgRpc<unknown>('preview_workspace_invitation', null, { p_token: token });
    expect(anon.status).not.toBe(200);
  });
});
