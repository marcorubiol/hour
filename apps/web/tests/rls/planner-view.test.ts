import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import {
  envReady,
  limitedEnvReady,
  login,
  pgGet,
  pgPatch,
  pgRpc,
  requireEnv,
  requireLimitedEnv,
} from './_helpers';

/**
 * ADR-192 (129): la vista de entrada del Planificador por persona
 * (20261110110000_membership_planner_view).
 *
 * Lo que fija este fichero:
 * - `set_my_planner_view` escribe solo la membresía de espacio de quien llama:
 *   'overview', 'agenda', 'month', 'board' o NULL; cualquier otro valor
 *   (también 'day': el Día es una lupa), 400;
 * - fuera del espacio, 403 sin oráculo; anon, nada;
 * - `membership.planner_view` no se escribe por PostgREST;
 * - otro miembro no toca la tuya ni la lee.
 *
 * Fixture: `playwright`. Deja todo como lo encontró. Va rojo contra un origen
 * sin `20261110110000`.
 */
const NOWHERE = '00000000-0000-4000-8000-000000000000';

describe.skipIf(!envReady())('Planner entry drawing per workspace membership (ADR-192)', () => {
  let jwt: string;
  let userId: string;
  let workspaceId: string;
  let original: string | null = null;

  const mine = () =>
    new URLSearchParams({
      select: 'planner_view',
      level: 'eq.workspace',
      workspace_id: `eq.${workspaceId}`,
      user_id: `eq.${userId}`,
    });
  async function myView(token = jwt): Promise<string | null | undefined> {
    const r = await pgGet<{ planner_view: string | null }>('membership', token, mine());
    return r.rows[0]?.planner_view;
  }
  const set = (token: string | null, view: string | null, ws = workspaceId) =>
    pgRpc('set_my_planner_view', token, { p_workspace_id: ws, p_view: view });

  beforeAll(async () => {
    const env = requireEnv();
    jwt = await login(env.email, env.password);
    userId = JSON.parse(Buffer.from(jwt.split('.')[1]!, 'base64url').toString('utf8')).sub as string;
    const w = await pgGet<{ id: string }>('workspace', jwt, new URLSearchParams({ select: 'id', slug: 'eq.playwright' }));
    if (w.rows.length === 0) throw new Error('playwright workspace missing');
    workspaceId = w.rows[0]!.id;
    original = (await myView()) ?? null;
  });

  afterAll(async () => {
    await set(jwt, original);
  });

  test('anon writes nothing', async () => {
    const r = await set(null, 'month');
    expect(r.status).toBeGreaterThanOrEqual(400);
  });

  test('a member sets their own: the four drawings of the bar, and null back to the default', async () => {
    for (const view of ['overview', 'agenda', 'month', 'board', null] as const) {
      const r = await set(jwt, view);
      expect(r.status).toBeLessThan(300);
      expect(await myView()).toBe(view);
    }
  });

  test('any other value is refused and changes nothing; the Day is not a way in', async () => {
    await set(jwt, 'board');
    for (const view of ['day', 'week', 'BOARD', 'carrils', '']) {
      const r = await set(jwt, view);
      expect(r.status).toBe(400);
    }
    expect(await myView()).toBe('board');
  });

  test('outside the workspace: no write, no oracle', async () => {
    const r = await set(jwt, 'month', NOWHERE);
    expect(r.status).toBe(403);
  });

  test('the column is not writable through PostgREST', async () => {
    await set(jwt, 'board');
    const upd = await pgPatch('membership', jwt, { planner_view: 'month' }, mine());
    expect(upd.status === 401 || upd.status === 403 || upd.rows.length === 0).toBe(true);
    expect(await myView()).toBe('board');
  });

  test.skipIf(!limitedEnvReady())('another member: their call changes only theirs, and they never read mine', async () => {
    const limited = requireLimitedEnv();
    const other = await login(limited.email, limited.password);
    await set(jwt, 'board');

    const theirs = await set(other, 'month');
    // A member of the space writes their own row; one who is not gets 403.
    expect([204, 200, 403]).toContain(theirs.status);
    expect(await myView()).toBe('board');

    const upd = await pgPatch('membership', other, { planner_view: 'month' }, mine());
    expect(upd.status === 401 || upd.status === 403 || upd.rows.length === 0).toBe(true);
    expect(await myView()).toBe('board');

    const read = await pgGet<{ planner_view: string | null }>('membership', other, mine());
    expect(read.rows).toHaveLength(0);

    await set(other, null);
  });
});
