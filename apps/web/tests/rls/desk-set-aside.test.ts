import { beforeAll, describe, expect, test } from 'vitest';
import {
  decodeJwt,
  envReady,
  limitedEnvReady,
  login,
  pgGet,
  pgPatch,
  pgPost,
  pgRpc,
  requireEnv,
  requireLimitedEnv,
} from './_helpers';

/**
 * «Ahora no» en «Te espera» (20261120030000_desk_set_aside, ADR-231).
 *
 * Lo que fija este fichero:
 * - cada uno lee su fila y ninguna otra, aunque compartan espacio;
 * - la API no escribe la tabla: solo `set_aside_desk_item`, sobre la fila de
 *   quien llama;
 * - una clave que no es `<tipo>-<id>`, un día pasado o a más de un año, se
 *   rechazan;
 * - con día nulo la fila vuelve;
 * - `anon` no la llama.
 *
 * Fixture: el usuario de la suite y el limitado. Cada test deja lo suyo
 * devuelto (día nulo). Va rojo contra un origen sin `20261120030000`.
 */
type Items = Record<string, string>;
interface Row {
  user_id: string;
  items: Items;
}

function dayFromToday(n: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

describe.skipIf(!envReady() || !limitedEnvReady())('desk_set_aside is your own and nobody else’s', () => {
  let admin: string;
  let adminSub: string;
  let limited: string;
  let limitedSub: string;

  beforeAll(async () => {
    const env = requireEnv();
    const lim = requireLimitedEnv();
    admin = await login(env.email, env.password);
    limited = await login(lim.email, lim.password);
    adminSub = String(decodeJwt(admin).sub);
    limitedSub = String(decodeJwt(limited).sub);
  });

  test('set_aside_desk_item writes the caller’s row and a null day brings it back', async () => {
    const until = dayFromToday(3);
    const r = await pgRpc<Items>('set_aside_desk_item', admin, { p_key: 'task-zzz_rls', p_until: until });
    expect(r.status).toBe(200);
    expect(r.data?.['task-zzz_rls']).toBe(until);

    const back = await pgRpc<Items>('set_aside_desk_item', admin, { p_key: 'task-zzz_rls', p_until: null });
    expect(back.status).toBe(200);
    expect(back.data).not.toHaveProperty('task-zzz_rls');
  });

  test('each one reads only their own row', async () => {
    await pgRpc('set_aside_desk_item', admin, { p_key: 'conv-zzz_rls', p_until: dayFromToday(2) });
    await pgRpc('set_aside_desk_item', limited, { p_key: 'inv-zzz_rls', p_until: dayFromToday(2) });

    const mine = await pgGet<Row>('desk_set_aside', admin, new URLSearchParams({ select: 'user_id,items' }));
    expect(mine.rows.map((row) => row.user_id)).toEqual([adminSub]);
    expect(mine.rows[0]?.items).not.toHaveProperty('inv-zzz_rls');

    const theirs = await pgGet<Row>(
      'desk_set_aside',
      admin,
      new URLSearchParams({ select: 'user_id', user_id: `eq.${limitedSub}` }),
    );
    expect(theirs.rows).toEqual([]);

    const limitedView = await pgGet<Row>('desk_set_aside', limited, new URLSearchParams({ select: 'user_id,items' }));
    expect(limitedView.rows.map((row) => row.user_id)).toEqual([limitedSub]);
    expect(limitedView.rows[0]?.items).not.toHaveProperty('conv-zzz_rls');

    await pgRpc('set_aside_desk_item', admin, { p_key: 'conv-zzz_rls', p_until: null });
    await pgRpc('set_aside_desk_item', limited, { p_key: 'inv-zzz_rls', p_until: null });
  });

  test('the API cannot write the table directly', async () => {
    const patch = await pgPatch(
      'desk_set_aside',
      admin,
      { items: {} },
      new URLSearchParams({ user_id: `eq.${limitedSub}` }),
    );
    expect(patch.status).toBeGreaterThanOrEqual(400);

    const post = await pgPost('desk_set_aside', admin, { user_id: limitedSub, items: { 'task-x': '2099-01-01' } });
    expect(post.status).toBeGreaterThanOrEqual(400);
  });

  test('a bad key or a bad day is refused', async () => {
    expect((await pgRpc('set_aside_desk_item', admin, { p_key: 'anything goes', p_until: dayFromToday(2) })).status).toBe(400);
    expect((await pgRpc('set_aside_desk_item', admin, { p_key: 'task-x', p_until: dayFromToday(-3) })).status).toBe(400);
    expect((await pgRpc('set_aside_desk_item', admin, { p_key: 'task-x', p_until: dayFromToday(400) })).status).toBe(400);
  });

  test('anon cannot call it', async () => {
    const r = await pgRpc('set_aside_desk_item', null, { p_key: 'task-x', p_until: dayFromToday(2) });
    expect(r.status).toBeGreaterThanOrEqual(400);
  });
});
