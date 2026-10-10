/**
 * ADR-087 · `_tasks.md § 36` — leer de qué bolo cuelga una función.
 *
 * `bolo_id` está fuera del SELECT por columnas de `performance` a propósito
 * (es dinero), así que la ficha lo lee por `list_performance_bolo_links`
 * (`20261010140000`), con la puerta de `read:money`. Este fichero fija las dos
 * mitades: quien lee dinero ve el enlace (y `null` si no hay), y quien solo lee
 * funciones no recibe NI la fila, para que «sin bolo» y «no te toca» no se
 * distingan. Va ROJO contra una base sin esa migración.
 *
 * En `playwright`, sobre `zzz-e2e-collab`, donde el usuario limitado es
 * `performer` (read:performance, sin read:money). Autolimpiante.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  envReady,
  limitedEnvReady,
  login,
  pgGet,
  pgRpc,
  requireEnv,
  requireLimitedEnv,
} from './_helpers';

const RUN = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

type Link = { performance_id: string; bolo_id: string | null };

describe.skipIf(!envReady())('list_performance_bolo_links — the read:money door (§ 36)', () => {
  let jwt: string;
  let projectId: string;
  let boloId: string;
  let linkedId: string;
  let looseId: string;

  beforeAll(async () => {
    const env = requireEnv();
    jwt = await login(env.email, env.password);
    const projects = await pgGet<{ id: string }>('project?select=id&slug=eq.zzz-e2e-collab', jwt);
    projectId = projects.rows[0]!.id;
    expect(projectId, 'fixture project zzz-e2e-collab').toBeTruthy();

    const bolo = await pgRpc<{ id: string }>('create_bolo', jwt, {
      p_project_id: projectId,
      p_status: 'proposed',
      p_venue_name: `RLS links ${RUN}`,
    });
    expect(bolo.status, bolo.error).toBe(200);
    boloId = bolo.data!.id;

    for (const [day, bolo_id] of [
      ['2027-02-10', boloId],
      ['2027-02-11', null],
    ] as const) {
      const perf = await pgRpc<{ id: string }>('create_performance', jwt, {
        p_project_id: projectId,
        p_performed_at: day,
        p_status: 'proposed',
        p_venue_name: `RLS links ${RUN}`,
        p_bolo_id: bolo_id,
      });
      expect(perf.status, perf.error).toBe(200);
      if (bolo_id) linkedId = perf.data!.id;
      else looseId = perf.data!.id;
    }
  });

  afterAll(async () => {
    for (const id of [linkedId, looseId]) {
      if (id) await pgRpc('delete_performance', jwt, { p_performance_id: id });
    }
    if (boloId) await pgRpc('delete_bolo', jwt, { p_bolo_id: boloId });
  });

  it('a money reader sees the link, and null where there is none', async () => {
    const res = await pgRpc<Link[]>('list_performance_bolo_links', jwt, {
      p_performance_ids: [linkedId, looseId],
    });
    expect(res.status, res.error).toBe(200);
    const byId = new Map((res.data ?? []).map((r) => [r.performance_id, r.bolo_id]));
    expect(byId.get(linkedId)).toBe(boloId);
    expect(byId.has(looseId), 'an unlinked function still answers, with null').toBe(true);
    expect(byId.get(looseId)).toBeNull();
  });

  it('a deleted function is not answered', async () => {
    const extra = await pgRpc<{ id: string }>('create_performance', jwt, {
      p_project_id: projectId,
      p_performed_at: '2027-02-12',
      p_status: 'proposed',
      p_bolo_id: boloId,
    });
    expect(extra.status, extra.error).toBe(200);
    await pgRpc('delete_performance', jwt, { p_performance_id: extra.data!.id });
    const res = await pgRpc<Link[]>('list_performance_bolo_links', jwt, {
      p_performance_ids: [extra.data!.id],
    });
    expect(res.status).toBe(200);
    expect(res.data).toEqual([]);
  });

  it('anon cannot call it', async () => {
    const res = await pgRpc('list_performance_bolo_links', null, { p_performance_ids: [linkedId] });
    expect([401, 403, 404]).toContain(res.status);
  });

  describe.skipIf(!limitedEnvReady())('a member who reads functions but not money', () => {
    it('gets NO row, not even a null one', async () => {
      const env = requireLimitedEnv();
      const limitedJwt = await login(env.email, env.password);
      const visible = await pgGet<{ id: string }>(
        `performance?select=id&id=eq.${linkedId}`,
        limitedJwt,
      );
      expect(visible.rows, 'precondition: the function itself is readable').toHaveLength(1);
      const res = await pgRpc<Link[]>('list_performance_bolo_links', limitedJwt, {
        p_performance_ids: [linkedId, looseId],
      });
      expect(res.status, res.error).toBe(200);
      expect(res.data).toEqual([]);
    });
  });
});
