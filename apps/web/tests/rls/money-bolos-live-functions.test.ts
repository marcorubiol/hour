/**
 * ADR-125 — `list_money_bolos` no cuenta las funciones canceladas
 * (`20261018130000_money_bolos_live_functions`).
 *
 * La primera función de un bolo decide su temporada y si está «por facturar».
 * Si esa primera función está cancelada, la fecha del bolo es la primera VIVA;
 * `function_count` solo cuenta las vivas. Un bolo con todas canceladas guarda
 * su primera fecha, para seguir teniendo temporada.
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

describe.skipIf(!envReady())('list_money_bolos — cancelled functions do not count (ADR-125)', () => {
  let jwt: string;
  let projectId: string;
  let boloId: string;
  const perfIds: string[] = [];

  async function setStatus(perfId: string, status: string): Promise<number> {
    const env = requireEnv();
    const res = await fetch(`${env.url}/rest/v1/performance?id=eq.${perfId}`, {
      method: 'PATCH',
      headers: {
        apikey: env.anon,
        Authorization: `Bearer ${jwt}`,
        'Content-Type': 'application/json',
        Prefer: 'return=minimal',
      },
      body: JSON.stringify({ status }),
    });
    return res.status;
  }

  async function row(): Promise<MoneyBoloRow | undefined> {
    const res = await pgRpc<MoneyBoloRow[]>('list_money_bolos', jwt, {
      p_project_ids: [projectId],
      p_workspace_ids: null,
      p_line_ids: null,
      p_from: null,
      p_to: null,
      p_limit: 500,
    });
    expect(res.status, res.error).toBe(200);
    return (res.data ?? []).find((b) => b.id === boloId);
  }

  beforeAll(async () => {
    const env = requireEnv();
    jwt = await login(env.email, env.password);
    const projects = await pgGet<Row>('project?select=id&slug=eq.zzz-e2e-collab', jwt);
    projectId = projects.rows[0]!.id;
    const bolo = await pgRpc<Row>('create_bolo', jwt, {
      p_project_id: projectId,
      p_status: 'confirmed',
      p_venue_name: `RLS live functions ${RUN}`,
    });
    expect(bolo.status, bolo.error).toBe(200);
    boloId = bolo.data!.id;
    for (const day of ['2027-01-10', '2027-02-20']) {
      const perf = await pgRpc<Row>('create_performance', jwt, {
        p_project_id: projectId,
        p_performed_at: day,
        p_status: 'confirmed',
        p_venue_name: `RLS live functions ${RUN}`,
        p_bolo_id: boloId,
      });
      expect(perf.status, perf.error).toBe(200);
      perfIds.push(perf.data!.id);
    }
  });

  afterAll(async () => {
    for (const id of perfIds) await pgRpc('delete_performance', jwt, { p_performance_id: id });
    if (boloId) await pgRpc('delete_bolo', jwt, { p_bolo_id: boloId });
  });

  it('with both live, the first function is the date and both count', async () => {
    expect(await row()).toMatchObject({ function_count: 2, first_performed_at: '2027-01-10', last_performed_at: '2027-02-20' });
  });

  it('a cancelled first function leaves the date to the first live one', async () => {
    expect(await setStatus(perfIds[0]!, 'cancelled')).toBe(204);
    expect(await row()).toMatchObject({ function_count: 1, first_performed_at: '2027-02-20', last_performed_at: '2027-02-20' });
  });

  it('with all cancelled, the bolo keeps its first date and counts none', async () => {
    expect(await setStatus(perfIds[1]!, 'cancelled')).toBe(204);
    expect(await row()).toMatchObject({ function_count: 0, first_performed_at: '2027-01-10', last_performed_at: '2027-02-20' });
  });
});
