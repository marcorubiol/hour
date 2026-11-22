/**
 * RLS regression: el viaje se ata a su bolo (ADR-242 · Fase 1,
 * migración `20261122140000_date_bolo_link`).
 *
 * Qué fija este fichero:
 * 1. La firma vieja de `create_date` (sin `p_bolo_id`) sigue resolviendo sin
 *    sobrecarga (compatibilidad con el Worker desplegado).
 * 2. `create_date` y `PATCH /rest/v1/date` aceptan `bolo_id` solo en
 *    `travel_day` de la misma obra y con `read:money`; rechazan bolo de otra
 *    obra, UUID inexistente (mismo 403, sin oráculo) y fechas que no son viaje.
 * 3. Quien no ve el bolo (sin `read:money` en el proyecto) no puede atar un
 *    viaje a él.
 * 4. `delete_bolo` desata `date.bolo_id = NULL` al hacer borrado blando.
 * 5. `trips_for_performance`:
 *    - devuelve los viajes atados al bolo aunque caigan dos días antes o el día
 *      siguiente (`link_source = 'bolo'`), sin `travel_stage.notes` ni `bolo_id`;
 *    - devuelve los atados a la línea sin bolo (`link_source = 'line'`);
 *    - solo si no hay ninguno atado, sugiere día y víspera (`link_source = 'suggested'`),
 *      sin robar viajes ya atados a otro bolo;
 *    - devuelve `[]` a quien no tiene acceso a la función (sin oráculo).
 * 6. `get_public_roadsheet`: devuelve los viajes atados al bolo (incluidas ida
 *    dos días antes y vuelta al día siguiente) y a la línea para `performer` y
 *    `tech_manager`, sin `notes` y nunca para `venue`.
 *
 * Va rojo contra un origen sin `20261122140000`. Autolimpiante en `playwright`.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  envReady,
  externalEnvReady,
  limitedEnvReady,
  login,
  pgGet,
  pgPatch,
  pgRpc,
  requireEnv,
  requireExternalEnv,
  requireLimitedEnv,
} from './_helpers';

const RUN = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const NOWHERE = '00000000-0000-4000-8000-000000000000';
const one = <T>(data: T | T[] | null): T | undefined => (Array.isArray(data) ? data[0] : (data ?? undefined));

interface DateRow {
  id: string;
  kind: string;
  bolo_id: string | null;
  line_id: string | null;
}

interface TripItem {
  id: string;
  title: string | null;
  travel_direction?: string | null;
  link_source?: 'bolo' | 'line' | 'suggested';
  status?: string;
  stages: Array<Record<string, unknown>>;
  going: string[];
  bolo_id?: unknown;
}

describe.skipIf(!envReady())('date ↔ bolo link + trips_for_performance + public roadsheet (ADR-242)', () => {
  let jwt: string;
  let homeProjectId: string;
  let foreignProjectId: string;
  let homeBoloId: string;
  let otherHomeBoloId: string;
  let foreignBoloId: string;
  let lineId: string | undefined;

  const createdDates: string[] = [];
  const createdPerfs: string[] = [];
  const createdBolos: string[] = [];
  const createdShares: string[] = [];

  beforeAll(async () => {
    const env = requireEnv();
    jwt = await login(env.email, env.password);

    const projects = await pgGet<{ id: string; slug: string }>(
      'project',
      jwt,
      new URLSearchParams({
        select: 'id,slug',
        slug: 'in.(zzz-e2e-collab,zzz-rls-foreign-project)',
        deleted_at: 'is.null',
      }),
    );
    expect(projects.status).toBe(200);
    homeProjectId = projects.rows.find((p) => p.slug === 'zzz-e2e-collab')!.id;
    foreignProjectId = projects.rows.find((p) => p.slug === 'zzz-rls-foreign-project')!.id;

    const lines = await pgGet<{ id: string }>(
      'line',
      jwt,
      new URLSearchParams({
        select: 'id',
        project_id: `eq.${homeProjectId}`,
        deleted_at: 'is.null',
        order: 'id',
        limit: '1',
      }),
    );
    lineId = lines.rows[0]?.id;

    for (const [projectId, label] of [
      [homeProjectId, 'home'],
      [homeProjectId, 'other-home'],
      [foreignProjectId, 'foreign'],
    ] as const) {
      const b = await pgRpc<{ id: string }>('create_bolo', jwt, {
        p_project_id: projectId,
        p_status: 'proposed',
        p_venue_name: `ZZZ Travel Bolo ${label} ${RUN}`,
      });
      expect(b.status, b.error).toBe(200);
      const id = one(b.data)!.id;
      createdBolos.push(id);
      if (label === 'home') homeBoloId = id;
      else if (label === 'other-home') otherHomeBoloId = id;
      else foreignBoloId = id;
    }
  });

  afterAll(async () => {
    if (!jwt) return;
    for (const id of createdShares) await pgRpc('revoke_roadsheet_share', jwt, { p_share_id: id });
    for (const id of createdDates) await pgRpc('delete_date', jwt, { p_date_id: id });
    for (const id of createdPerfs) await pgRpc('delete_performance', jwt, { p_performance_id: id });
    for (const id of createdBolos) await pgRpc('delete_bolo', jwt, { p_bolo_id: id });
  });

  const makePerf = async (day: string, extra: Record<string, unknown> = {}) => {
    const r = await pgRpc<{ id: string }>('create_performance', jwt, {
      p_project_id: homeProjectId,
      p_performed_at: day,
      p_status: 'confirmed',
      p_venue_name: `ZZZ Travel Perf ${RUN}`,
      ...extra,
    });
    expect(r.status, r.error).toBe(200);
    const id = one(r.data)!.id;
    createdPerfs.push(id);
    return id;
  };

  const makeDate = async (args: Record<string, unknown>) => {
    const r = await pgRpc<DateRow>('create_date', jwt, {
      p_project_id: homeProjectId,
      p_status: 'confirmed',
      ...args,
    });
    if (r.status === 200 && one(r.data)?.id) createdDates.push(one(r.data)!.id);
    return r;
  };

  it('old create_date signature (without p_bolo_id) still resolves cleanly', async () => {
    const r = await makeDate({
      p_kind: 'travel_day',
      p_starts_at: '2031-11-01T08:00:00Z',
      p_all_day: true,
      p_title: `ZZZ Old Sig ${RUN}`,
      p_travel_direction: 'outbound',
      p_origin_city: 'Barcelona',
      p_destination_city: 'Getxo',
    });
    expect(r.status, r.error).toBe(200);
    expect(one(r.data)!.bolo_id).toBeNull();
  });

  it('create_date accepts p_bolo_id on same-project travel_day and rejects non-travel_day or foreign/unknown bolo', async () => {
    const ok = await makeDate({
      p_kind: 'travel_day',
      p_starts_at: '2031-11-02T08:00:00Z',
      p_title: `ZZZ Bound Create ${RUN}`,
      p_travel_direction: 'outbound',
      p_bolo_id: homeBoloId,
    });
    expect(ok.status, ok.error).toBe(200);
    expect(one(ok.data)!.bolo_id).toBe(homeBoloId);

    const nonTravel = await makeDate({
      p_kind: 'rehearsal',
      p_starts_at: '2031-11-02T10:00:00Z',
      p_title: `ZZZ Non Travel ${RUN}`,
      p_bolo_id: homeBoloId,
    });
    expect(nonTravel.status).toBe(400);

    const foreign = await makeDate({
      p_kind: 'travel_day',
      p_starts_at: '2031-11-02T08:00:00Z',
      p_title: `ZZZ Foreign Bolo ${RUN}`,
      p_bolo_id: foreignBoloId,
    });
    const missing = await makeDate({
      p_kind: 'travel_day',
      p_starts_at: '2031-11-02T08:00:00Z',
      p_title: `ZZZ Missing Bolo ${RUN}`,
      p_bolo_id: NOWHERE,
    });
    expect(foreign.status).toBe(403);
    expect(missing.status).toBe(403);
  });

  it('direct PostgREST PATCH enforces same-project bolo, travel_day CHECK, and allows detach', async () => {
    const trip = await makeDate({
      p_kind: 'travel_day',
      p_starts_at: '2031-11-03T08:00:00Z',
      p_title: `ZZZ Patch Trip ${RUN}`,
    });
    expect(trip.status, trip.error).toBe(200);
    const tripId = one(trip.data)!.id;

    const bind = await pgPatch<DateRow>('date', jwt, { bolo_id: homeBoloId }, new URLSearchParams({ id: `eq.${tripId}` }));
    expect(bind.status).toBe(200);
    expect(bind.rows[0]?.bolo_id).toBe(homeBoloId);

    const foreign = await pgPatch<DateRow>('date', jwt, { bolo_id: foreignBoloId }, new URLSearchParams({ id: `eq.${tripId}` }));
    expect(foreign.status).toBe(403);

    const missing = await pgPatch<DateRow>('date', jwt, { bolo_id: NOWHERE }, new URLSearchParams({ id: `eq.${tripId}` }));
    expect(missing.status).toBe(403);

    const detach = await pgPatch<DateRow>('date', jwt, { bolo_id: null }, new URLSearchParams({ id: `eq.${tripId}` }));
    expect(detach.status).toBe(200);
    expect(detach.rows[0]?.bolo_id).toBeNull();

    const reh = await makeDate({
      p_kind: 'rehearsal',
      p_starts_at: '2031-11-03T11:00:00Z',
      p_title: `ZZZ Patch Rehearsal ${RUN}`,
    });
    expect(reh.status, reh.error).toBe(200);
    const rehId = one(reh.data)!.id;

    const badKind = await pgPatch<DateRow>('date', jwt, { bolo_id: homeBoloId }, new URLSearchParams({ id: `eq.${rehId}` }));
    expect(badKind.status).toBe(400);
  });

  it('delete_bolo detaches date.bolo_id on soft-delete', async () => {
    const tmpBolo = await pgRpc<{ id: string }>('create_bolo', jwt, {
      p_project_id: homeProjectId,
      p_status: 'proposed',
      p_venue_name: `ZZZ Ephemeral Bolo ${RUN}`,
    });
    expect(tmpBolo.status, tmpBolo.error).toBe(200);
    const tmpBoloId = one(tmpBolo.data)!.id;

    const trip = await makeDate({
      p_kind: 'travel_day',
      p_starts_at: '2031-11-04T08:00:00Z',
      p_title: `ZZZ Detach On Delete ${RUN}`,
      p_bolo_id: tmpBoloId,
    });
    expect(trip.status, trip.error).toBe(200);
    const tripId = one(trip.data)!.id;

    const del = await pgRpc('delete_bolo', jwt, { p_bolo_id: tmpBoloId });
    expect(del.status, del.error).toBe(200);

    const after = await pgGet<DateRow>('date', jwt, new URLSearchParams({ select: 'id,bolo_id', id: `eq.${tripId}` }));
    expect(after.status).toBe(200);
    expect(after.rows[0]?.bolo_id).toBeNull();
  });

  it('trips_for_performance and get_public_roadsheet return bolo trips outside day+eve, line trips, and fallback without stealing other bolos', async () => {
    // Bolo con función el 15: ida el 13 (2 días antes), vuelta el 16 (día siguiente).
    const perfBound = await makePerf('2031-12-15', { p_bolo_id: homeBoloId });
    const outTrip = one(
      (
        await makeDate({
          p_kind: 'travel_day',
          p_starts_at: '2031-12-13T07:00:00Z',
          p_title: `ZZZ Ida 2d ${RUN}`,
          p_travel_direction: 'outbound',
          p_origin_city: 'Barcelona',
          p_destination_city: 'Bilbao',
          p_bolo_id: homeBoloId,
        })
      ).data,
    )!;
    const backTrip = one(
      (
        await makeDate({
          p_kind: 'travel_day',
          p_starts_at: '2031-12-16T10:00:00Z',
          p_title: `ZZZ Vuelta +1d ${RUN}`,
          p_travel_direction: 'return',
          p_origin_city: 'Bilbao',
          p_destination_city: 'Barcelona',
          p_bolo_id: homeBoloId,
        })
      ).data,
    )!;
    const stage = await pgRpc('create_travel_stage', jwt, {
      p_date_id: outTrip.id,
      p_mode: 'plane',
      p_from_city: 'Barcelona',
      p_to_city: 'Bilbao',
      p_depart_at: '2031-12-13T07:00:00Z',
      p_arrive_at: '2031-12-13T08:15:00Z',
      p_reference: 'VY1234',
      p_notes: `zzz-private-note-${RUN}`,
    });
    expect(stage.status, stage.error).toBe(200);

    // Viaje de gira en la misma línea sin bolo: debe sumarse a una función de esa línea.
    let lineTripId: string | null = null;
    if (lineId) {
      const lt = await makeDate({
        p_kind: 'travel_day',
        p_starts_at: '2031-12-12T09:00:00Z',
        p_title: `ZZZ Line Trip ${RUN}`,
        p_travel_direction: 'leg',
        p_line_id: lineId,
      });
      expect(lt.status, lt.error).toBe(200);
      lineTripId = one(lt.data)!.id;
    }

    // Función en esa línea + bolo: recibe los dos del bolo y el de línea.
    const perfLineAndBolo = lineId ? await makePerf('2031-12-15', { p_bolo_id: homeBoloId, p_line_id: lineId }) : perfBound;
    const rpc = await pgRpc<TripItem[]>('trips_for_performance', jwt, { p_performance_id: perfLineAndBolo });
    expect(rpc.status, rpc.error).toBe(200);
    const items = (rpc.data ?? []) as TripItem[];
    expect(items.map((x) => x.id)).toContain(outTrip.id);
    expect(items.map((x) => x.id)).toContain(backTrip.id);
    expect(items.find((x) => x.id === outTrip.id)?.link_source).toBe('bolo');
    expect(items.find((x) => x.id === backTrip.id)?.link_source).toBe('bolo');
    expect(items.find((x) => x.id === outTrip.id)?.bolo_id).toBeUndefined();
    expect(JSON.stringify(items)).not.toContain(`zzz-private-note-${RUN}`);
    if (lineTripId) {
      expect(items.map((x) => x.id)).toContain(lineTripId);
      expect(items.find((x) => x.id === lineTripId)?.link_source).toBe('line');
    }

    // Hoja pública: performer y tech_manager ven ida (-2d) y vuelta (+1d), nunca notes; venue sin travel.
    for (const role of ['performer', 'tech_manager', 'venue'] as const) {
      const share = await pgRpc<{ id: string; token: string }>('create_roadsheet_share', jwt, {
        p_performance_id: perfBound,
        p_role: role,
      });
      expect(share.status, share.error).toBe(200);
      const s = one(share.data)!;
      createdShares.push(s.id);

      const pub = await pgRpc<Record<string, unknown>>('get_public_roadsheet', null, { p_token: s.token });
      expect(pub.status, pub.error).toBe(200);
      if (role === 'venue') {
        expect(pub.data).not.toHaveProperty('travel');
      } else {
        const travel = pub.data!.travel as TripItem[];
        expect(travel.map((x) => x.id)).toContain(outTrip.id);
        expect(travel.map((x) => x.id)).toContain(backTrip.id);
        expect(JSON.stringify(pub.data)).not.toContain(`zzz-private-note-${RUN}`);
      }
    }

    // Fallback: una función del día 14 sin viajes atados ni línea NO roba outTrip (atado a homeBoloId),
    // pero sí sugiere un viaje suelto sin bolo del día 14.
    const perfFallback = await makePerf('2031-12-14', { p_bolo_id: otherHomeBoloId });
    const looseTrip = one(
      (
        await makeDate({
          p_kind: 'travel_day',
          p_starts_at: '2031-12-14T08:00:00Z',
          p_title: `ZZZ Loose Suggested ${RUN}`,
        })
      ).data,
    )!;
    const fb = await pgRpc<TripItem[]>('trips_for_performance', jwt, { p_performance_id: perfFallback });
    expect(fb.status, fb.error).toBe(200);
    const fbItems = (fb.data ?? []) as TripItem[];
    expect(fbItems.map((x) => x.id)).toContain(looseTrip.id);
    expect(fbItems.find((x) => x.id === looseTrip.id)?.link_source).toBe('suggested');
    expect(fbItems.map((x) => x.id)).not.toContain(outTrip.id);
  });

  it.skipIf(!limitedEnvReady())('a caller who cannot read the bolo cannot bind a trip to it', async () => {
    const lim = requireLimitedEnv();
    const limJwt = await login(lim.email, lim.password);

    const created = await pgRpc<DateRow>('create_date', limJwt, {
      p_project_id: homeProjectId,
      p_kind: 'travel_day',
      p_starts_at: '2031-11-05T08:00:00Z',
      p_title: `ZZZ Lim Bind ${RUN}`,
      p_bolo_id: homeBoloId,
    });
    expect(created.status).toBe(403);
  });

  it.skipIf(!externalEnvReady())('an external caller without access cannot read trips_for_performance or bind a bolo', async () => {
    const ext = requireExternalEnv();
    const extJwt = await login(ext.email, ext.password);

    const perfId = await makePerf('2031-12-20', { p_bolo_id: homeBoloId });
    const read = await pgRpc<TripItem[]>('trips_for_performance', extJwt, { p_performance_id: perfId });
    expect(read.status).toBe(200);
    expect(read.data).toEqual([]);

    const bind = await pgRpc<DateRow>('create_date', extJwt, {
      p_project_id: homeProjectId,
      p_kind: 'travel_day',
      p_starts_at: '2031-12-19T08:00:00Z',
      p_title: `ZZZ Ext Bind ${RUN}`,
      p_bolo_id: homeBoloId,
    });
    expect(bind.status).toBe(403);
  });
});
