/**
 * Lo que las dos superficies anónimas ganan el 2026-11-02:
 *
 * `get_public_roadsheet` (`20261102150000`, 88 y 80b):
 *   1. `materials`: los de salida de la línea de la función, con enlace, para
 *      cualquier rol.
 *   2. `travel`: los viajes del día y de la víspera del mismo proyecto, con sus
 *      tramos (sin notas), solo para `performer` y `tech_manager`; la vuelta
 *      del día siguiente no entra; `venue` no lleva la clave.
 *
 * `get_public_calendar` y `create_calendar_share` (`20261102160000`, 71b y 90):
 *   3. Las opciones salen con su estado; cada función lleva `schedule`; cada
 *      viaje, `stages` sin localizador; el espacio, `trade`.
 *   4. `scope = 'mine'`: solo lo de la persona de quien creó el enlace (aquí,
 *      una fecha con su «voy»); otro valor, 22023 (400).
 *
 * En `zzz-e2e-collab` (`playwright`), con fechas de 2031 que no chocan con
 * nada. Lo que crea lo revoca y lo borra.
 */

import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { decodeJwt, envReady, login, pgGet, pgRpc, requireEnv } from './_helpers';

const RUN = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const one = <T>(data: T | T[] | null): T | undefined => (Array.isArray(data) ? data[0] : (data ?? undefined));

type Share = { id: string; token: string; scope?: string };
type Trip = { id: string; stages: Array<Record<string, unknown>>; going: string[] };
type Material = { kind: string; url: string; scope: string };

describe.skipIf(!envReady())('RLS — public road sheet and calendar feed (88, 80b, 71b, 90)', () => {
  let jwt: string;
  let workspaceId: string;
  let projectId: string;
  let lineId: string | undefined;
  let perfId: string;
  let myPersonId: string | null = null;
  const dates: string[] = [];
  const assets: string[] = [];
  const roadsheetShares: string[] = [];
  const calendarShares: string[] = [];

  const date = async (args: Record<string, unknown>) => {
    const r = await pgRpc<{ id: string }>('create_date', jwt, { p_project_id: projectId, p_status: 'confirmed', ...args });
    expect(r.status, r.error).toBe(200);
    const id = one(r.data)!.id;
    dates.push(id);
    return id;
  };

  beforeAll(async () => {
    const env = requireEnv();
    jwt = await login(env.email, env.password);
    const me = String(decodeJwt(jwt).sub);
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

    const l = await pgGet<{ id: string }>(
      'line',
      jwt,
      new URLSearchParams({ select: 'id', project_id: `eq.${projectId}`, deleted_at: 'is.null', order: 'id', limit: '1' }),
    );
    lineId = l.rows[0]?.id;

    const perf = await pgRpc<{ id: string }>('create_performance', jwt, {
      p_project_id: projectId,
      p_performed_at: '2031-07-10',
      p_status: 'hold_1',
      p_venue_name: `ZZZ Feeds ${RUN}`,
      ...(lineId ? { p_line_id: lineId } : {}),
    });
    expect(perf.status, perf.error).toBe(200);
    perfId = one(perf.data)!.id;

    const up = await pgGet<{ person_id: string | null }>(
      'user_profile',
      jwt,
      new URLSearchParams({ select: 'person_id', user_id: `eq.${me}` }),
    );
    myPersonId = up.rows[0]?.person_id ?? null;
  });

  afterAll(async () => {
    if (!jwt) return;
    for (const id of roadsheetShares) await pgRpc('revoke_roadsheet_share', jwt, { p_share_id: id });
    for (const id of calendarShares) await pgRpc('revoke_calendar_share', jwt, { p_share_id: id });
    for (const id of assets) await pgRpc('delete_asset_version', jwt, { p_asset_id: id });
    for (const id of dates) await pgRpc('delete_date', jwt, { p_date_id: id });
    if (perfId) await pgRpc('delete_performance', jwt, { p_performance_id: perfId });
  });

  const roadsheetShare = async (role: string) => {
    const r = await pgRpc<Share>('create_roadsheet_share', jwt, { p_performance_id: perfId, p_role: role });
    expect(r.status, r.error).toBe(200);
    const s = one(r.data)!;
    roadsheetShares.push(s.id);
    return s.token;
  };

  test('road sheet: line materials for every role, the trip of the day and its eve for performer only', async () => {
    if (lineId) {
      const a = await pgRpc<{ id: string }>('create_asset_version', jwt, {
        p_line_id: lineId,
        p_kind: 'rider',
        p_url: `https://example.test/rider-${RUN}.pdf`,
      });
      expect(a.status, a.error).toBe(200);
      assets.push(one(a.data)!.id);
    }
    const eve = await date({ p_kind: 'travel_day', p_starts_at: '2031-07-09T07:00:00Z', p_title: `Zzz ida ${RUN}` });
    const after = await date({ p_kind: 'travel_day', p_starts_at: '2031-07-11T09:00:00Z', p_title: `Zzz vuelta ${RUN}` });
    const stage = await pgRpc('create_travel_stage', jwt, {
      p_date_id: eve,
      p_mode: 'train',
      p_from_city: 'Barcelona',
      p_to_city: 'Girona',
      p_depart_at: '2031-07-09T07:00:00Z',
      p_arrive_at: '2031-07-09T08:30:00Z',
      p_reference: 'ZZZ123',
      p_notes: `zzz-secret-${RUN}`,
    });
    expect(stage.status, stage.error).toBe(200);

    const performer = await pgRpc<Record<string, unknown>>('get_public_roadsheet', null, {
      p_token: await roadsheetShare('performer'),
    });
    expect(performer.status, performer.error).toBe(200);
    const travel = performer.data!.travel as Trip[];
    const ids = travel.map((t) => t.id);
    expect(ids).toContain(eve);
    expect(ids).not.toContain(after);
    const trip = travel.find((t) => t.id === eve)!;
    expect(trip.stages).toHaveLength(1);
    expect(trip.stages[0]!.reference).toBe('ZZZ123');
    expect(JSON.stringify(performer.data)).not.toContain('zzz-secret');
    if (lineId) {
      const materials = performer.data!.materials as Material[];
      expect(materials.map((m) => m.url)).toContain(`https://example.test/rider-${RUN}.pdf`);
    }

    const venue = await pgRpc<Record<string, unknown>>('get_public_roadsheet', null, {
      p_token: await roadsheetShare('venue'),
    });
    expect(venue.status, venue.error).toBe(200);
    expect(venue.data).not.toHaveProperty('travel');
    expect(venue.data).toHaveProperty('materials');
  });

  test('calendar: options, running order, stages without reference, trade; mine is only mine', async () => {
    const all = await pgRpc<Share>('create_calendar_share', jwt, { p_workspace_id: workspaceId });
    expect(all.status, all.error).toBe(200);
    calendarShares.push(one(all.data)!.id);
    expect(one(all.data)!.scope).toBe('all');

    const bad = await pgRpc('create_calendar_share', jwt, { p_workspace_id: workspaceId, p_scope: 'everything' });
    expect(bad.status).toBe(400);

    const feed = await pgRpc<{
      workspace: { trade?: string };
      performances: Array<{ id: string; status: string; schedule?: unknown[] }>;
      dates: Array<{ id: string; stages?: unknown[] }>;
    }>('get_public_calendar', null, { p_token: one(all.data)!.token });
    expect(feed.status, feed.error).toBe(200);
    expect(feed.data!.workspace).toHaveProperty('trade');
    const option = feed.data!.performances.find((p) => p.id === perfId);
    expect(option?.status).toBe('hold_1');
    expect(Array.isArray(option?.schedule)).toBe(true);
    for (const d of feed.data!.dates) expect(Array.isArray(d.stages)).toBe(true);
    const raw = JSON.stringify(feed.data);
    expect(raw).not.toContain('reference');
    expect(raw).not.toContain('"notes"');
    expect(raw).not.toContain('zzz-secret');

    if (!myPersonId) {
      const mine = await pgRpc('create_calendar_share', jwt, { p_workspace_id: workspaceId, p_scope: 'mine' });
      expect(mine.status).toBe(400);
      return;
    }
    const going = await date({ p_kind: 'rehearsal', p_starts_at: '2031-07-20T10:00:00Z', p_title: `Zzz mío ${RUN}` });
    const notMine = await date({ p_kind: 'rehearsal', p_starts_at: '2031-07-21T10:00:00Z', p_title: `Zzz ajeno ${RUN}` });
    const said = await pgRpc('set_commitment_person', jwt, {
      p_target_table: 'date',
      p_target_id: going,
      p_person_id: myPersonId,
      p_state: 'going',
    });
    expect(said.status, said.error).toBeLessThan(300);

    const mine = await pgRpc<Share>('create_calendar_share', jwt, { p_workspace_id: workspaceId, p_scope: 'mine' });
    expect(mine.status, mine.error).toBe(200);
    calendarShares.push(one(mine.data)!.id);
    const mineFeed = await pgRpc<{ dates: Array<{ id: string }> }>('get_public_calendar', null, {
      p_token: one(mine.data)!.token,
    });
    const mineIds = mineFeed.data!.dates.map((d) => d.id);
    expect(mineIds).toContain(going);
    expect(mineIds).not.toContain(notMine);
  });
});
