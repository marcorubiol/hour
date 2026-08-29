/**
 * ADR-084 §1 — una función puede durar varios días (`create_performance_series`).
 *
 * Simétrico a `create_date_series`, que lleva meses funcionando. Lo que fija
 * aquí no es «inserta N filas» sino las reglas que hacen que una tanda sea una
 * tanda: **una sola serie para las N**, días distintos, mínimo 2 —para una sola
 * está `create_performance`— y tope de 92.
 *
 * POR QUÉ FILAS POR DÍA Y NO UN RANGO: la banda es un dibujo de las filas y el
 * borde se deriva en cada pintada, así que confirmar un solo día de la tanda lo
 * muestra como lo que es sin desincronizar un span guardado. Esa es la razón de
 * que el contrato sea «N filas con una serie» y no «una fila con dos fechas».
 *
 * Va ROJO contra un origen donde `20260829100000_performance_series` no esté
 * aplicada. Autolimpiante: borra en afterAll lo que crea.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { envReady, limitedEnvReady, login, pgGet, pgRpc, requireEnv, requireLimitedEnv } from './_helpers';

const RUN = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const VENUE = `RLS series ${RUN}`;

interface PerfRow {
  id: string;
  performed_at: string;
  series_id: string | null;
  slug: string;
  status: string;
}

/** Días lejanos y propios de esta corrida, para no chocar con nada vivo. */
const DAYS = ['2031-03-01', '2031-03-02', '2031-03-03'];

describe.skipIf(!envReady())('performance series (ADR-084 §1)', () => {
  let jwt: string;
  let projectId: string;
  const made: string[] = [];

  beforeAll(async () => {
    const env = requireEnv();
    jwt = await login(env.email, env.password);
    const p = await pgGet<{ id: string }>('project?select=id&slug=eq.zzz-e2e-collab', jwt);
    expect(p.status).toBe(200);
    projectId = p.rows[0]!.id;
  });

  afterAll(async () => {
    for (const id of made) await pgRpc('delete_performance', jwt, { p_performance_id: id });
  });

  const create = (days: (string | null)[], venue = VENUE) =>
    pgRpc<PerfRow[]>('create_performance_series', jwt, {
      p_project_id: projectId,
      p_performed_at: days,
      p_venue_name: venue,
      p_city: 'Testville',
      p_country: 'ES',
    });

  it('THREE NIGHTS ARE ONE RUN — N rows, one series, in day order', async () => {
    const res = await create(DAYS);
    expect(res.status, res.error).toBe(200);
    const rows = res.data ?? [];
    rows.forEach((r) => made.push(r.id));

    expect(rows, 'one row per day').toHaveLength(DAYS.length);
    expect(rows.map((r) => r.performed_at), 'and in day order').toEqual(DAYS);

    const series = new Set(rows.map((r) => r.series_id));
    expect(series.size, 'the three must share ONE series').toBe(1);
    expect([...series][0], 'and it must not be null').toBeTruthy();

    // El slug lleva su propio día, así que no colisionan entre sí.
    expect(new Set(rows.map((r) => r.slug)).size, 'each day gets its own slug').toBe(3);
  });

  /**
   * LOS RECHAZOS SE AFIRMAN POR SU STATUS EXACTO, no por `>= 400`.
   * PostgREST mapea `22023` (parámetro inválido) a 400 y `42501` a 403, así que
   * el número distingue «la regla dijo que no» de «la RPC no existe» (404).
   * Con `>= 400` estos seis salían VERDES contra una base sin la migración
   * aplicada, que es exactamente el fallo que costó una tarde el 2026-08-28.
   */
  it('a single day is not a series — use create_performance', async () => {
    expect((await create([DAYS[0]])).status).toBe(400);
  });

  it('a series cannot repeat a day', async () => {
    expect((await create([DAYS[0], DAYS[0]])).status).toBe(400);
  });

  it('a null day is refused', async () => {
    expect((await create([null, DAYS[1]])).status).toBe(400);
  });

  it('is capped, so one call cannot fill a year', async () => {
    const many = Array.from({ length: 100 }, (_, i) => {
      const d = new Date(Date.UTC(2032, 0, 1 + i));
      return d.toISOString().slice(0, 10);
    });
    expect((await create(many)).status).toBe(400);
  });

  it('refuses a project the caller cannot edit', async () => {
    const res = await pgRpc('create_performance_series', jwt, {
      p_project_id: '00000000-0000-0000-0000-000000000000',
      p_performed_at: [DAYS[0], DAYS[1]],
      p_venue_name: VENUE,
    });
    expect(res.status, 'an unreachable project is 42501 → 403').toBe(403);
  });

  describe.skipIf(!limitedEnvReady())('a member without edit:performance', () => {
    it('cannot create a run', async () => {
      const env = requireLimitedEnv();
      const limitedJwt = await login(env.email, env.password);
      const res = await pgRpc('create_performance_series', limitedJwt, {
        p_project_id: projectId,
        p_performed_at: [DAYS[0], DAYS[1]],
        p_venue_name: VENUE,
      });
      expect(res.status, 'the gate is the same as create_performance').toBe(403);
    });
  });
});
