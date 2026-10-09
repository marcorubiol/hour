import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  envReady,
  limitedEnvReady,
  login,
  pgGet,
  pgPost,
  pgRpc,
  requireEnv,
  requireLimitedEnv,
} from './_helpers';

/**
 * ADR-089 P1: un viaje es un trayecto. Origen → destino en `date`, y tramos.
 *
 * Lo que fija este fichero:
 * - los extremos solo existen en un `travel_day`, y `create_date` los acepta
 *   SIN romper la llamada que hace hoy el Worker desplegado (la base puede ir
 *   por delante de él);
 * - un tramo solo cuelga de un viaje, se escribe solo por RPC, y sus
 *   posiciones son siempre 1..N: al añadir, al reordenar y al borrar;
 * - la puerta es la del viaje: se lee con `read:performance`, se escribe con
 *   `edit:performance`, y un viaje borrado se lleva sus tramos de la vista.
 *
 * Va rojo contra un origen sin `20260926100000`. Autolimpiante: todo lo que
 * crea vive en `zzz-e2e-collab` con el prefijo ZZZ y se borra al final.
 */
const RUN = Date.now().toString(36);
const NOWHERE = '00000000-0000-4000-8000-000000000000';

interface DateRow {
  id: string;
  kind: string;
  origin_city: string | null;
  origin_country: string | null;
  destination_city: string | null;
  destination_country: string | null;
}

interface StageRow {
  id: string;
  date_id: string;
  position: number;
  mode: string;
  from_place: string | null;
  to_country: string | null;
  reference: string | null;
}

/** `RETURNS SETOF` sale como array por PostgREST; una fila sola, como objeto. */
const one = <T>(data: T | T[] | null): T | undefined =>
  Array.isArray(data) ? data[0] : (data ?? undefined);

describe.skipIf(!envReady())('travel stages (ADR-089 P1)', () => {
  let jwt: string;
  let projectId: string;
  const dates: string[] = [];

  beforeAll(async () => {
    const env = requireEnv();
    jwt = await login(env.email, env.password);
    const p = await pgGet<{ id: string }>('project?select=id&slug=eq.zzz-e2e-collab', jwt);
    expect(p.status).toBe(200);
    projectId = p.rows[0]!.id;
  });

  afterAll(async () => {
    for (const id of dates) await pgRpc('delete_date', jwt, { p_date_id: id });
  });

  const trip = async (extra: Record<string, unknown> = {}) => {
    const r = await pgRpc<DateRow>('create_date', jwt, {
      p_project_id: projectId,
      p_kind: 'travel_day',
      p_starts_at: '2031-03-02T08:00:00Z',
      p_all_day: true,
      p_title: `ZZZ RLS Trip ${RUN}`,
      p_travel_direction: 'outbound',
      ...extra,
    });
    expect(r.status, r.error).toBe(200);
    const row = one(r.data)!;
    dates.push(row.id);
    return row;
  };

  const rehearsal = async (day: string) => {
    const r = await pgRpc<DateRow>('create_date', jwt, {
      p_project_id: projectId,
      p_kind: 'rehearsal',
      p_starts_at: `${day}T10:00:00Z`,
      p_title: `ZZZ RLS Trip ${RUN} rehearsal`,
    });
    expect(r.status, r.error).toBe(200);
    const row = one(r.data)!;
    dates.push(row.id);
    return row;
  };

  const stage = (dateId: string, args: Record<string, unknown> = {}) =>
    pgRpc<StageRow>('create_travel_stage', jwt, { p_date_id: dateId, ...args });

  const stagesOf = async (dateId: string) =>
    (
      await pgGet<StageRow>(
        'travel_stage',
        jwt,
        new URLSearchParams({
          date_id: `eq.${dateId}`,
          select: 'id,position,mode',
          order: 'position',
        }),
      )
    ).rows;

  it('a trip keeps its two ends, countries normalised', async () => {
    const t = await trip({
      p_origin_city: ' Barcelona ',
      p_origin_country: 'es',
      p_destination_city: 'Sevilla',
      p_destination_country: 'ES',
    });
    expect(t).toMatchObject({
      origin_city: 'Barcelona',
      origin_country: 'ES',
      destination_city: 'Sevilla',
      destination_country: 'ES',
    });
  });

  it('THE RUNNING WORKER STILL CREATES DATES: no endpoint args, same answer', async () => {
    const row = await rehearsal('2031-03-03');
    expect(row.kind).toBe('rehearsal');
    expect(row.origin_city).toBeNull();
  });

  it('only a travel day has ends', async () => {
    const r = await pgRpc('create_date', jwt, {
      p_project_id: projectId,
      p_kind: 'rehearsal',
      p_starts_at: '2031-03-04T10:00:00Z',
      p_title: `ZZZ RLS Trip ${RUN} bad`,
      p_origin_city: 'Barcelona',
    });
    expect(r.status).toBe(400);
  });

  it('stages append 1..N, and only on a travel day', async () => {
    const t = await trip();
    const a = await stage(t.id, { p_mode: 'taxi' });
    const b = await stage(t.id, { p_mode: 'plane', p_reference: ' VY2222 ', p_to_country: 'es' });
    expect(a.status, a.error).toBe(200);
    expect(b.status, b.error).toBe(200);
    expect(one(a.data)!.position).toBe(1);
    expect(one(b.data)).toMatchObject({ position: 2, reference: 'VY2222', to_country: 'ES' });

    const reh = await rehearsal('2031-03-05');
    expect((await stage(reh.id, { p_mode: 'bus' })).status).toBe(400);
  });

  it('reorder takes the whole order or nothing; delete closes the gap', async () => {
    const t = await trip();
    const ids: string[] = [];
    for (const m of ['taxi', 'plane', 'metro']) {
      ids.push(one((await stage(t.id, { p_mode: m })).data)!.id);
    }

    const partial = await pgRpc('reorder_travel_stages', jwt, {
      p_date_id: t.id,
      p_stage_ids: ids.slice(0, 2),
    });
    expect(partial.status, 'a partial order is refused').toBe(400);
    const dup = await pgRpc('reorder_travel_stages', jwt, {
      p_date_id: t.id,
      p_stage_ids: [ids[0], ids[0], ids[1]],
    });
    expect(dup.status, 'a repeated id is refused').toBe(400);

    const r = await pgRpc('reorder_travel_stages', jwt, {
      p_date_id: t.id,
      p_stage_ids: [ids[2], ids[0], ids[1]],
    });
    expect(r.status, r.error).toBe(200);
    expect((await stagesOf(t.id)).map((s) => s.mode)).toEqual(['metro', 'taxi', 'plane']);

    const del = await pgRpc('delete_travel_stage', jwt, { p_stage_id: ids[0] });
    expect(del.status, del.error).toBeLessThan(300);
    expect((await stagesOf(t.id)).map((s) => [s.mode, s.position])).toEqual([
      ['metro', 1],
      ['plane', 2],
    ]);
  });

  it('update REPLACES the stage: what is not sent is cleared', async () => {
    const t = await trip();
    const s = one((await stage(t.id, { p_mode: 'plane', p_reference: 'VY1' })).data)!;
    const u = await pgRpc<StageRow>('update_travel_stage', jwt, {
      p_stage_id: s.id,
      p_mode: 'train',
      p_from_place: 'Sants',
    });
    expect(u.status, u.error).toBe(200);
    expect(one(u.data)).toMatchObject({
      mode: 'train',
      from_place: 'Sants',
      reference: null,
      position: 1,
    });
  });

  it('no direct writes: the table only reads', async () => {
    const t = await trip();
    const r = await pgPost('travel_stage', jwt, {
      date_id: t.id,
      project_id: projectId,
      position: 9,
      mode: 'bus',
    });
    expect([401, 403]).toContain(r.status);
  });

  it('a trip that is not yours is the same answer as one that is not there', async () => {
    expect((await stage(NOWHERE, { p_mode: 'bus' })).status, 'no existence oracle').toBe(403);
  });

  it('a deleted trip takes its stages out of sight, and out of reach', async () => {
    const t = await trip();
    const s = one((await stage(t.id, { p_mode: 'car' })).data)!;
    expect(await stagesOf(t.id)).toHaveLength(1);
    const del = await pgRpc('delete_date', jwt, { p_date_id: t.id });
    expect(del.status, del.error).toBeLessThan(300);
    expect(await stagesOf(t.id)).toHaveLength(0);
    expect((await pgRpc('delete_travel_stage', jwt, { p_stage_id: s.id })).status).toBe(403);
  });

  describe.skipIf(!limitedEnvReady())('the limited performer', () => {
    let limitedJwt: string;

    beforeAll(async () => {
      const l = requireLimitedEnv();
      limitedJwt = await login(l.email, l.password);
    });

    /**
     * No se da por hecho qué puede el rol: se le pregunta a `has_permission`
     * y se exige que las puertas del tramo contesten lo mismo. Lo que fija es
     * que el tramo usa la puerta del viaje, sea cual sea el rol de hoy.
     */
    it('reads and writes stages exactly as far as it reads and edits the trip', async () => {
      const t = await trip();
      expect((await stage(t.id, { p_mode: 'bus' })).status).toBe(200);
      const can = async (perm: string) =>
        (
          await pgRpc<boolean>('has_permission', limitedJwt, {
            p_project_id: projectId,
            p_perm: perm,
          })
        ).data;
      const read = await can('read:performance');
      const edit = await can('edit:performance');

      const seen = await pgGet<StageRow>(
        'travel_stage',
        limitedJwt,
        new URLSearchParams({ date_id: `eq.${t.id}`, select: 'id' }),
      );
      expect(seen.rows.length > 0, `read:performance=${read}`).toBe(Boolean(read));

      const w = await pgRpc('create_travel_stage', limitedJwt, { p_date_id: t.id, p_mode: 'walk' });
      expect(w.status, `edit:performance=${edit}`).toBe(edit ? 200 : 403);
    });
  });
});
