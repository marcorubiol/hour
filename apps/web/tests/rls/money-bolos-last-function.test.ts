/**
 * ADR-131 — `list_money_bolos` devuelve la primera y la última función viva
 * (`20261018170000_money_bolos_last_function`).
 *
 * La primera decide la temporada; la última, cuándo el trato está hecho y se
 * puede facturar. Tres bolos: de una función, de tres con la última en el
 * futuro y de tres con la última cancelada (cuenta la última viva).
 *
 * En el workspace `playwright`, proyecto `zzz-e2e-collab`. Autolimpiante.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { envReady, login, pgGet, pgRpc, requireEnv } from './_helpers';

const RUN = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

interface Row {
  id: string;
}
interface MoneyBoloRow {
  id: string;
  function_count: number;
  first_performed_at: string | null;
  last_performed_at: string | null;
}

describe.skipIf(!envReady())('list_money_bolos — first and last live function (ADR-131)', () => {
  let jwt: string;
  let projectId: string;
  const boloIds: Record<'one' | 'ahead' | 'cancelled', string> = { one: '', ahead: '', cancelled: '' };
  const perfIds: string[] = [];

  async function seed(days: string[]): Promise<{ boloId: string; perfs: string[] }> {
    const bolo = await pgRpc<Row>('create_bolo', jwt, {
      p_project_id: projectId,
      p_status: 'confirmed',
      p_venue_name: `RLS last function ${RUN}`,
    });
    expect(bolo.status, bolo.error).toBe(200);
    const perfs: string[] = [];
    for (const day of days) {
      const perf = await pgRpc<Row>('create_performance', jwt, {
        p_project_id: projectId,
        p_performed_at: day,
        p_status: 'confirmed',
        p_venue_name: `RLS last function ${RUN}`,
        p_bolo_id: bolo.data!.id,
      });
      expect(perf.status, perf.error).toBe(200);
      perfs.push(perf.data!.id);
      perfIds.push(perf.data!.id);
    }
    return { boloId: bolo.data!.id, perfs };
  }

  async function rows(): Promise<MoneyBoloRow[]> {
    const res = await pgRpc<MoneyBoloRow[]>('list_money_bolos', jwt, {
      p_project_ids: [projectId],
      p_workspace_ids: null,
      p_line_ids: null,
      p_from: null,
      p_to: null,
      p_limit: 500,
    });
    expect(res.status, res.error).toBe(200);
    return res.data ?? [];
  }

  beforeAll(async () => {
    const env = requireEnv();
    jwt = await login(env.email, env.password);
    const projects = await pgGet<Row>('project?select=id&slug=eq.zzz-e2e-collab', jwt);
    projectId = projects.rows[0]!.id;

    boloIds.one = (await seed(['2026-03-14'])).boloId;
    boloIds.ahead = (await seed(['2026-03-10', '2026-03-11', '2099-03-12'])).boloId;
    const cancelled = await seed(['2026-04-01', '2026-04-02', '2026-04-03']);
    boloIds.cancelled = cancelled.boloId;
    const res = await fetch(`${env.url}/rest/v1/performance?id=eq.${cancelled.perfs[2]}`, {
      method: 'PATCH',
      headers: {
        apikey: env.anon,
        Authorization: `Bearer ${jwt}`,
        'Content-Type': 'application/json',
        Prefer: 'return=minimal',
      },
      body: JSON.stringify({ status: 'cancelled' }),
    });
    expect(res.status).toBe(204);
  });

  afterAll(async () => {
    for (const id of perfIds) await pgRpc('delete_performance', jwt, { p_performance_id: id });
    for (const id of Object.values(boloIds)) if (id) await pgRpc('delete_bolo', jwt, { p_bolo_id: id });
  });

  it('a bolo of one function: first and last are the same day', async () => {
    const row = (await rows()).find((b) => b.id === boloIds.one);
    expect(row).toMatchObject({ function_count: 1, first_performed_at: '2026-03-14', last_performed_at: '2026-03-14' });
  });

  it('a bolo of three with the last ahead: the last is still to come', async () => {
    const row = (await rows()).find((b) => b.id === boloIds.ahead);
    expect(row).toMatchObject({ function_count: 3, first_performed_at: '2026-03-10', last_performed_at: '2099-03-12' });
  });

  it('a bolo of three with the last cancelled: the last live one counts', async () => {
    const row = (await rows()).find((b) => b.id === boloIds.cancelled);
    expect(row).toMatchObject({ function_count: 2, first_performed_at: '2026-04-01', last_performed_at: '2026-04-02' });
  });

  it('the old name is gone', async () => {
    const row = (await rows()).find((b) => b.id === boloIds.one) as unknown as Record<string, unknown>;
    expect('next_performed_at' in row).toBe(false);
  });
});
