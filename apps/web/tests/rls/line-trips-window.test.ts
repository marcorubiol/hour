/**
 * RLS regression: los viajes de la gira salen solo en las funciones vecinas
 * (ADR-244, migración `20261123100000_line_trips_window`).
 *
 * Qué fija este fichero:
 * 1. Un viaje con línea y sin bolo sale en la función de esa línea más cercana
 *    (entre la anterior y la siguiente), no en todas.
 * 2. A igual distancia de dos funciones vecinas, sale en las dos.
 * 3. Un viaje de la gira ya no apaga la sugerencia del viaje suelto del día.
 *
 * Va rojo contra un origen sin `20261123100000`. Autolimpiante en `playwright`.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { envReady, login, pgGet, pgRpc, requireEnv } from './_helpers';

const RUN = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const one = <T>(data: T | T[] | null): T | undefined => (Array.isArray(data) ? data[0] : (data ?? undefined));

interface TripItem {
  id: string;
  link_source?: 'bolo' | 'line' | 'suggested';
}

describe.skipIf(!envReady())('tour trips only on neighbouring performances (ADR-244)', () => {
  let jwt: string;
  let projectId: string;
  let lineId: string | undefined;
  const createdDates: string[] = [];
  const createdPerfs: string[] = [];

  beforeAll(async () => {
    const env = requireEnv();
    jwt = await login(env.email, env.password);
    const projects = await pgGet<{ id: string }>(
      'project',
      jwt,
      new URLSearchParams({ select: 'id', slug: 'eq.zzz-e2e-collab', deleted_at: 'is.null' }),
    );
    expect(projects.status).toBe(200);
    projectId = projects.rows[0]!.id;
    const lines = await pgGet<{ id: string }>(
      'line',
      jwt,
      new URLSearchParams({ select: 'id', project_id: `eq.${projectId}`, deleted_at: 'is.null', order: 'id', limit: '1' }),
    );
    lineId = lines.rows[0]?.id;
  });

  afterAll(async () => {
    if (!jwt) return;
    for (const id of createdDates) await pgRpc('delete_date', jwt, { p_date_id: id });
    for (const id of createdPerfs) await pgRpc('delete_performance', jwt, { p_performance_id: id });
  });

  const makePerf = async (day: string) => {
    const r = await pgRpc<{ id: string }>('create_performance', jwt, {
      p_project_id: projectId,
      p_performed_at: day,
      p_status: 'confirmed',
      p_venue_name: `ZZZ Tour Perf ${RUN}`,
      p_line_id: lineId,
    });
    expect(r.status, r.error).toBe(200);
    const id = one(r.data)!.id;
    createdPerfs.push(id);
    return id;
  };

  const makeTrip = async (startsAt: string, title: string, withLine: boolean, endsAt?: string) => {
    const r = await pgRpc<{ id: string }>('create_date', jwt, {
      p_project_id: projectId,
      p_kind: 'travel_day',
      p_status: 'confirmed',
      p_starts_at: startsAt,
      ...(endsAt ? { p_ends_at: endsAt } : {}),
      p_title: `ZZZ ${title} ${RUN}`,
      ...(withLine ? { p_line_id: lineId } : {}),
    });
    expect(r.status, r.error).toBe(200);
    const id = one(r.data)!.id;
    createdDates.push(id);
    return id;
  };

  const tripsOf = async (perfId: string) => {
    const r = await pgRpc<TripItem[]>('trips_for_performance', jwt, { p_performance_id: perfId });
    expect(r.status, r.error).toBe(200);
    return new Map(((r.data ?? []) as TripItem[]).map((x) => [x.id, x.link_source]));
  };

  it('a tour trip goes to the nearest performance of its line, ties to both, and the loose day trip is still suggested', async () => {
    if (!lineId) return; // la fixture no tiene línea: nada que comprobar.
    // Funciones de la gira el 10, el 17 y el 30 (de 2032, lejos de cualquier otra).
    const p10 = await makePerf('2032-03-10');
    const p17 = await makePerf('2032-03-17');
    const p30 = await makePerf('2032-03-30');

    const before = await makeTrip('2032-03-09T08:00:00Z', 'Tour out', true); // antes de la primera → 10
    const nearPrev = await makeTrip('2032-03-12T08:00:00Z', 'Tour near 10', true); // 10 (2 días) frente a 17 (5)
    const near17 = await makeTrip('2032-03-22T12:00:00Z', 'Tour near 17', true); // 5 días de 17, 8 de 30 → 17
    // Del 23 al 24: 6 días hasta el 17 y 6 desde el 30 → a las dos.
    const tie = await makeTrip('2032-03-23T08:00:00Z', 'Tour tie', true, '2032-03-24T08:00:00Z');
    const after = await makeTrip('2032-03-31T08:00:00Z', 'Tour back', true); // después de la última → 30
    const looseEve = await makeTrip('2032-03-16T08:00:00Z', 'Loose eve', false); // suelto, víspera del 17

    const t10 = await tripsOf(p10);
    const t17 = await tripsOf(p17);
    const t30 = await tripsOf(p30);

    expect(t10.get(before)).toBe('line');
    expect(t10.get(nearPrev)).toBe('line');
    expect(t10.has(tie)).toBe(false);
    expect(t10.has(after)).toBe(false);

    expect(t17.has(before)).toBe(false);
    expect(t17.has(nearPrev)).toBe(false);
    expect(t17.get(near17)).toBe('line');
    expect(t17.get(tie)).toBe('line');
    expect(t17.get(looseEve)).toBe('suggested');
    expect(t17.has(after)).toBe(false);

    expect(t30.get(after)).toBe('line');
    expect(t30.get(tie)).toBe('line');
    expect(t30.has(near17)).toBe(false);
    expect(t30.has(before)).toBe(false);
  });
});
