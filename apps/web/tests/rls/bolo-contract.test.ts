/**
 * El contrato del bolo (`20261101120000_bolo_contract`, ADR-163 § 1).
 *
 * `update_bolo_contract`: la puerta de `update_bolo_fee` (`edit:money` sobre
 * el proyecto del trato, 42501 para «no existe» y «no es tuyo»). Las dos
 * fechas llegan siempre; firmar sin envío toma la fecha de la firma; firmar
 * antes de enviar, 22023. `list_money_bolos` devuelve las dos fechas. Nadie
 * escribe la tabla por PostgREST (sin grant de UPDATE).
 *
 * Quien no lee dinero (la fixture limitada es `performer` en `zzz-e2e-collab`,
 * sin `read:money`) y alguien de fuera reciben 42501 y nada se mueve. Va ROJO
 * contra una base sin la migración. En `playwright`; el bolo se borra al final.
 */

import { afterAll, beforeAll, describe, expect, test } from 'vitest';
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
type Contract = { id: string; contract_sent_at: string | null; contract_signed_at: string | null };

describe.skipIf(!envReady())('RLS — update_bolo_contract (ADR-163)', () => {
  let jwt: string;
  let projectId: string;
  let boloId: string;

  beforeAll(async () => {
    const env = requireEnv();
    jwt = await login(env.email, env.password);
    const projects = await pgGet<{ id: string }>('project?select=id&slug=eq.zzz-e2e-collab', jwt);
    projectId = projects.rows[0]!.id;
    expect(projectId, 'fixture project zzz-e2e-collab').toBeTruthy();
    const bolo = await pgRpc<{ id: string }>('create_bolo', jwt, {
      p_project_id: projectId,
      p_status: 'confirmed',
      p_venue_name: `RLS contract ${RUN}`,
    });
    expect(bolo.status, bolo.error).toBe(200);
    boloId = bolo.data!.id;
  });

  afterAll(async () => {
    if (boloId) await pgRpc('delete_bolo', jwt, { p_bolo_id: boloId });
  });

  async function listed(): Promise<Contract | undefined> {
    const res = await pgRpc<Contract[]>('list_money_bolos', jwt, {
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

  const contract = (caller: string | null, sent: string | null, signed: string | null) =>
    pgRpc<Contract[]>('update_bolo_contract', caller, { p_bolo_id: boloId, p_sent_at: sent, p_signed_at: signed });

  test('a new bolo is unsent; sent, then signed, and list_money_bolos says so', async () => {
    expect(await listed()).toMatchObject({ contract_sent_at: null, contract_signed_at: null });

    const sent = await contract(jwt, '2026-11-01T10:00:00Z', null);
    expect(sent.status, sent.error).toBe(200);
    expect(sent.data?.[0]).toMatchObject({ id: boloId, contract_signed_at: null });
    expect(Date.parse(sent.data![0]!.contract_sent_at!)).toBe(Date.parse('2026-11-01T10:00:00Z'));

    const signed = await contract(jwt, '2026-11-01T10:00:00Z', '2026-11-03T09:00:00Z');
    expect(signed.status, signed.error).toBe(200);
    const row = await listed();
    expect(Date.parse(row!.contract_signed_at!)).toBe(Date.parse('2026-11-03T09:00:00Z'));
  });

  test('signing without a sent date takes the signature; signing before sending is 22023; null clears', async () => {
    const onlySigned = await contract(jwt, null, '2026-11-04T09:00:00Z');
    expect(onlySigned.status, onlySigned.error).toBe(200);
    expect(Date.parse(onlySigned.data![0]!.contract_sent_at!)).toBe(Date.parse('2026-11-04T09:00:00Z'));

    const backwards = await contract(jwt, '2026-11-05T09:00:00Z', '2026-11-04T09:00:00Z');
    expect(backwards.status).toBe(400);
    expect(backwards.error).toContain('22023');

    const cleared = await contract(jwt, null, null);
    expect(cleared.status, cleared.error).toBe(200);
    expect(await listed()).toMatchObject({ contract_sent_at: null, contract_signed_at: null });
  });

  test('an unknown bolo is 42501; anon cannot call it', async () => {
    const res = await pgRpc('update_bolo_contract', jwt, {
      p_bolo_id: '00000000-0000-0000-0000-000000000000',
      p_sent_at: null,
      p_signed_at: null,
    });
    expect(res.status).toBe(403);
    expect(res.error).toContain('42501');
    expect((await contract(null, null, null)).status).not.toBe(200);
  });

  test('the table is not written through PostgREST', async () => {
    await pgPatch('bolo', jwt, { contract_signed_at: '2026-11-06T09:00:00Z' }, new URLSearchParams({ id: `eq.${boloId}` }));
    expect((await listed())?.contract_signed_at).toBeNull();
  });

  describe.skipIf(!limitedEnvReady())('someone who does not handle money', () => {
    test('42501 and nothing moves', async () => {
      const limited = requireLimitedEnv();
      const limitedJwt = await login(limited.email, limited.password);
      const res = await contract(limitedJwt, '2026-11-01T10:00:00Z', null);
      expect(res.status).toBe(403);
      expect(res.error).toContain('42501');
      expect((await listed())?.contract_sent_at).toBeNull();
    });
  });

  test.skipIf(!externalEnvReady())('someone outside the workspace gets 42501', async () => {
    const external = requireExternalEnv();
    const ext = await login(external.email, external.password);
    const res = await contract(ext, '2026-11-01T10:00:00Z', null);
    expect(res.status).toBe(403);
    expect(res.error).toContain('42501');
    expect((await listed())?.contract_sent_at).toBeNull();
  });
});
