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
 * ADR-151: «lo mío / todo» por espacio (20261031100000_membership_view_scope).
 *
 * Lo que fija este fichero:
 * - `set_my_view_scope` escribe solo la membresía de espacio de quien llama:
 *   'mine', 'all' o NULL (volver al paquete); cualquier otro valor, 400;
 * - fuera del espacio, 403 sin oráculo; anon, nada;
 * - `membership.view_scope` no se escribe por PostgREST;
 * - otro miembro no toca la tuya: su llamada cambia solo la suya, y no lee la
 *   fila tuya.
 *
 * Fixture: `playwright`. Deja todo como lo encontró. Va rojo contra un origen
 * sin `20261031100000`.
 */
const NOWHERE = '00000000-0000-4000-8000-000000000000';

describe.skipIf(!envReady())('«lo mío / todo» per workspace membership (ADR-151)', () => {
  let jwt: string;
  let userId: string;
  let workspaceId: string;
  let original: string | null = null;

  const mine = () =>
    new URLSearchParams({
      select: 'view_scope',
      level: 'eq.workspace',
      workspace_id: `eq.${workspaceId}`,
      user_id: `eq.${userId}`,
    });
  async function myScope(token = jwt): Promise<string | null | undefined> {
    const r = await pgGet<{ view_scope: string | null }>('membership', token, mine());
    return r.rows[0]?.view_scope;
  }

  beforeAll(async () => {
    const env = requireEnv();
    jwt = await login(env.email, env.password);
    userId = JSON.parse(Buffer.from(jwt.split('.')[1]!, 'base64url').toString('utf8')).sub as string;
    const w = await pgGet<{ id: string }>('workspace', jwt, new URLSearchParams({ select: 'id', slug: 'eq.playwright' }));
    if (w.rows.length === 0) throw new Error('playwright workspace missing');
    workspaceId = w.rows[0]!.id;
    original = (await myScope()) ?? null;
  });

  afterAll(async () => {
    await pgRpc('set_my_view_scope', jwt, { p_workspace_id: workspaceId, p_scope: original });
  });

  test('anon writes nothing', async () => {
    const r = await pgRpc('set_my_view_scope', null, { p_workspace_id: workspaceId, p_scope: 'mine' });
    expect(r.status).toBeGreaterThanOrEqual(400);
  });

  test('a member sets their own: mine, all, and null back to the package', async () => {
    for (const scope of ['mine', 'all', null] as const) {
      const set = await pgRpc('set_my_view_scope', jwt, { p_workspace_id: workspaceId, p_scope: scope });
      expect(set.status).toBeLessThan(300);
      expect(await myScope()).toBe(scope);
    }
  });

  test('any other value is refused and changes nothing', async () => {
    await pgRpc('set_my_view_scope', jwt, { p_workspace_id: workspaceId, p_scope: 'all' });
    for (const scope of ['everything', 'MINE', '']) {
      const r = await pgRpc('set_my_view_scope', jwt, { p_workspace_id: workspaceId, p_scope: scope });
      expect(r.status).toBe(400);
    }
    expect(await myScope()).toBe('all');
  });

  test('outside the workspace: no write, no oracle', async () => {
    const r = await pgRpc('set_my_view_scope', jwt, { p_workspace_id: NOWHERE, p_scope: 'mine' });
    expect(r.status).toBe(403);
  });

  test('the column is not writable through PostgREST', async () => {
    await pgRpc('set_my_view_scope', jwt, { p_workspace_id: workspaceId, p_scope: 'all' });
    const upd = await pgPatch('membership', jwt, { view_scope: 'mine' }, mine());
    expect(upd.status === 401 || upd.status === 403 || upd.rows.length === 0).toBe(true);
    expect(await myScope()).toBe('all');
  });

  test.skipIf(!limitedEnvReady())(
    'another member: their call changes only theirs, and they never read mine',
    async () => {
      const limited = requireLimitedEnv();
      const other = await login(limited.email, limited.password);
      await pgRpc('set_my_view_scope', jwt, { p_workspace_id: workspaceId, p_scope: 'all' });

      const theirs = await pgRpc('set_my_view_scope', other, { p_workspace_id: workspaceId, p_scope: 'mine' });
      // A member of the space writes their own row; one who is not gets 403.
      expect([204, 200, 403]).toContain(theirs.status);
      expect(await myScope()).toBe('all');

      // Their direct write on my row: refused or no row touched.
      const upd = await pgPatch('membership', other, { view_scope: 'mine' }, mine());
      expect(upd.status === 401 || upd.status === 403 || upd.rows.length === 0).toBe(true);
      expect(await myScope()).toBe('all');

      // They do not read my row's preference.
      const read = await pgGet<{ view_scope: string | null }>('membership', other, mine());
      expect(read.rows).toHaveLength(0);

      await pgRpc('set_my_view_scope', other, { p_workspace_id: workspaceId, p_scope: null });
    },
  );
});
