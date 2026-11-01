/**
 * Caducidad del enlace público de la hoja de ruta
 * (`20261101130000_roadsheet_share_expiry`, ADR-160 § 2).
 *
 *   1. `create_roadsheet_share` rellena `expires_at`: el principio del segundo
 *      día tras la función, o tras la última función viva de su bolo, en la
 *      zona del espacio (la regla de ADR-142 § 2).
 *   2. `get_public_roadsheet` (anon) devuelve null con un enlace caducado.
 *   3. `set_roadsheet_share_expiry` lo alarga (`edit:performance` sobre la
 *      función del enlace); un día anterior a hoy, 22023; sin permiso o de
 *      fuera, 42501.
 *
 * Funciones en `zzz-e2e-collab` (`playwright`) con fechas que no chocan con
 * nada (2020 y 2031). Lo que crea lo revoca y lo borra.
 */

import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import {
  envReady,
  externalEnvReady,
  limitedEnvReady,
  login,
  pgGet,
  pgRpc,
  requireEnv,
  requireExternalEnv,
  requireLimitedEnv,
} from './_helpers';

const RUN = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const DAY = 86_400_000;
type Share = { id: string; token: string; expires_at: string };

/** The start of `day` in some zone between UTC-12 and UTC+14: the expiry is that instant. */
function startOfDayAnywhere(day: string, at: string): boolean {
  const utc = Date.parse(`${day}T00:00:00Z`);
  const t = Date.parse(at);
  return t >= utc - 14 * 3_600_000 && t <= utc + 12 * 3_600_000;
}

describe.skipIf(!envReady())('RLS — roadsheet_share.expires_at (ADR-160 § 2)', () => {
  let jwt: string;
  let projectId: string;
  let boloId: string;
  const perfIds: string[] = [];
  const shareIds: string[] = [];

  async function perf(day: string, bolo?: string): Promise<string> {
    const res = await pgRpc<{ id: string }>('create_performance', jwt, {
      p_project_id: projectId,
      p_performed_at: day,
      p_status: 'confirmed',
      p_venue_name: `RLS share expiry ${RUN}`,
      ...(bolo ? { p_bolo_id: bolo } : {}),
    });
    expect(res.status, res.error).toBe(200);
    perfIds.push(res.data!.id);
    return res.data!.id;
  }

  async function share(performanceId: string): Promise<Share> {
    const res = await pgRpc<Share>('create_roadsheet_share', jwt, { p_performance_id: performanceId, p_role: 'venue' });
    expect(res.status, res.error).toBe(200);
    shareIds.push(res.data!.id);
    return res.data!;
  }

  beforeAll(async () => {
    const env = requireEnv();
    jwt = await login(env.email, env.password);
    const projects = await pgGet<{ id: string }>('project?select=id&slug=eq.zzz-e2e-collab', jwt);
    projectId = projects.rows[0]!.id;
    expect(projectId, 'fixture project zzz-e2e-collab').toBeTruthy();
    const bolo = await pgRpc<{ id: string }>('create_bolo', jwt, {
      p_project_id: projectId,
      p_status: 'confirmed',
      p_venue_name: `RLS share expiry ${RUN}`,
    });
    expect(bolo.status, bolo.error).toBe(200);
    boloId = bolo.data!.id;
  });

  afterAll(async () => {
    for (const id of shareIds) await pgRpc('revoke_roadsheet_share', jwt, { p_share_id: id });
    for (const id of perfIds) await pgRpc('delete_performance', jwt, { p_performance_id: id });
    if (boloId) await pgRpc('delete_bolo', jwt, { p_bolo_id: boloId });
  });

  test('a loose function: the link lasts until the day after it ends', async () => {
    const s = await share(await perf('2031-05-10'));
    expect(startOfDayAnywhere('2031-05-12', s.expires_at), s.expires_at).toBe(true);
    const pub = await pgRpc('get_public_roadsheet', null, { p_token: s.token });
    expect(pub.status).toBe(200);
    expect(pub.data).not.toBeNull();
  });

  test('a function of a bolo: until the day after the bolo’s last function', async () => {
    const first = await perf('2031-06-10', boloId);
    await perf('2031-06-20', boloId);
    const s = await share(first);
    expect(startOfDayAnywhere('2031-06-22', s.expires_at), s.expires_at).toBe(true);
  });

  test('a past function: the link is born expired and opens nothing, until its date moves', async () => {
    const s = await share(await perf('2020-01-10'));
    expect(Date.parse(s.expires_at)).toBeLessThan(Date.now());
    const dead = await pgRpc('get_public_roadsheet', null, { p_token: s.token });
    expect(dead.status).toBe(200);
    expect(dead.data).toBeNull();

    const lastDay = new Date(Date.now() + 30 * DAY).toISOString().slice(0, 10);
    const moved = await pgRpc<Share>('set_roadsheet_share_expiry', jwt, { p_share_id: s.id, p_last_day: lastDay });
    expect(moved.status, moved.error).toBe(200);
    const next = new Date(Date.parse(`${lastDay}T00:00:00Z`) + DAY).toISOString().slice(0, 10);
    expect(startOfDayAnywhere(next, moved.data!.expires_at), moved.data!.expires_at).toBe(true);
    const alive = await pgRpc('get_public_roadsheet', null, { p_token: s.token });
    expect(alive.data).not.toBeNull();

    const listed = await pgRpc<Share[]>('list_roadsheet_shares', jwt, { p_performance_id: perfIds.at(-1) });
    expect(listed.status, listed.error).toBe(200);
    expect((listed.data ?? []).find((x) => x.id === s.id)?.expires_at).toBe(moved.data!.expires_at);
  });

  test('a last day before today is 22023; an unknown or revoked link is 42501', async () => {
    const s = await share(await perf('2031-07-10'));
    const past = await pgRpc('set_roadsheet_share_expiry', jwt, { p_share_id: s.id, p_last_day: '2020-01-01' });
    expect(past.status).toBe(400);
    expect(past.error).toContain('22023');

    const unknown = await pgRpc('set_roadsheet_share_expiry', jwt, {
      p_share_id: '00000000-0000-0000-0000-000000000000',
      p_last_day: '2031-12-31',
    });
    expect(unknown.status).toBe(403);
    expect(unknown.error).toContain('42501');

    await pgRpc('revoke_roadsheet_share', jwt, { p_share_id: s.id });
    const revoked = await pgRpc('set_roadsheet_share_expiry', jwt, { p_share_id: s.id, p_last_day: '2031-12-31' });
    expect(revoked.status).toBe(403);
  });

  test('anon cannot move a date', async () => {
    const res = await pgRpc('set_roadsheet_share_expiry', null, {
      p_share_id: '00000000-0000-0000-0000-000000000000',
      p_last_day: '2031-12-31',
    });
    expect([401, 403, 404]).toContain(res.status);
  });

  describe.skipIf(!limitedEnvReady())('someone who does not edit the function', () => {
    test('42501 and the date stays', async () => {
      const s = await share(await perf('2031-08-10'));
      const limited = requireLimitedEnv();
      const limitedJwt = await login(limited.email, limited.password);
      const res = await pgRpc('set_roadsheet_share_expiry', limitedJwt, { p_share_id: s.id, p_last_day: '2031-12-31' });
      expect(res.status).toBe(403);
      expect(res.error).toContain('42501');
      const listed = await pgRpc<Share[]>('list_roadsheet_shares', jwt, { p_performance_id: perfIds.at(-1) });
      expect((listed.data ?? []).find((x) => x.id === s.id)?.expires_at).toBe(s.expires_at);
    });
  });

  test.skipIf(!externalEnvReady())('someone outside the workspace gets 42501', async () => {
    const s = await share(await perf('2031-09-10'));
    const external = requireExternalEnv();
    const ext = await login(external.email, external.password);
    const res = await pgRpc('set_roadsheet_share_expiry', ext, { p_share_id: s.id, p_last_day: '2031-12-31' });
    expect(res.status).toBe(403);
    expect(res.error).toContain('42501');
  });
});
