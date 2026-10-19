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
 * Ayuda contextual, enfoque A · lo visto (20261020150000_help_seen).
 *
 * Lo que fija este fichero:
 * - cada uno lee su fila y ninguna otra, aunque compartan espacio;
 * - la API no escribe la tabla: solo `mark_help_seen` y `reset_help_seen`, y
 *   las dos sobre la fila de quien llama;
 * - una clave que no es `card:` ni `event:` se rechaza;
 * - `anon` no llama a ninguna de las dos.
 *
 * Fixture: el usuario de la suite y el limitado. Al usuario de la suite le
 * deja marcada `card:zzz_rls`; al limitado le vacía lo visto (sus tarjetas
 * vuelven a salir, que es lo que pide un fixture). Va rojo contra un origen
 * sin `20261020150000`.
 */
type Seen = Record<string, string>;
interface Row {
  user_id: string;
  seen: Seen;
}

describe.skipIf(!envReady() || !limitedEnvReady())('help_seen is your own and nobody else’s', () => {
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

  test('mark_help_seen writes the caller’s row and returns it whole', async () => {
    const r = await pgRpc<Seen>('mark_help_seen', admin, { p_key: 'card:zzz_rls' });
    expect(r.status).toBe(200);
    expect(r.data).toHaveProperty('card:zzz_rls');

    const first = r.data?.['card:zzz_rls'];
    const again = await pgRpc<Seen>('mark_help_seen', admin, { p_key: 'card:zzz_rls' });
    expect(again.data?.['card:zzz_rls']).toBe(first);
  });

  test('each one reads only their own row', async () => {
    await pgRpc('mark_help_seen', limited, { p_key: 'event:zzz_rls' });

    const mine = await pgGet<Row>('help_seen', admin, new URLSearchParams({ select: 'user_id,seen' }));
    expect(mine.rows.map((row) => row.user_id)).toEqual([adminSub]);

    const theirs = await pgGet<Row>(
      'help_seen',
      admin,
      new URLSearchParams({ select: 'user_id', user_id: `eq.${limitedSub}` }),
    );
    expect(theirs.rows).toEqual([]);

    const limitedView = await pgGet<Row>('help_seen', limited, new URLSearchParams({ select: 'user_id,seen' }));
    expect(limitedView.rows.map((row) => row.user_id)).toEqual([limitedSub]);
    expect(limitedView.rows[0]?.seen).not.toHaveProperty('card:zzz_rls');
  });

  test('the API cannot write the table directly', async () => {
    const patch = await pgPatch(
      'help_seen',
      admin,
      { seen: {} },
      new URLSearchParams({ user_id: `eq.${limitedSub}` }),
    );
    expect(patch.status).toBeGreaterThanOrEqual(400);

    const post = await pgPost('help_seen', admin, { user_id: limitedSub, seen: { 'card:x': 'y' } });
    expect(post.status).toBeGreaterThanOrEqual(400);
  });

  test('a key that is not card: or event: is refused', async () => {
    const r = await pgRpc('mark_help_seen', admin, { p_key: 'anything goes' });
    expect(r.status).toBe(400);
  });

  test('reset_help_seen empties only the caller’s row', async () => {
    const r = await pgRpc<Seen>('reset_help_seen', limited);
    expect(r.status).toBe(200);
    expect(r.data).toEqual({});

    const limitedView = await pgGet<Row>('help_seen', limited, new URLSearchParams({ select: 'seen' }));
    expect(limitedView.rows[0]?.seen).toEqual({});

    const mine = await pgGet<Row>('help_seen', admin, new URLSearchParams({ select: 'seen' }));
    expect(mine.rows[0]?.seen).toHaveProperty('card:zzz_rls');
  });

  test('anon calls neither RPC', async () => {
    expect((await pgRpc('mark_help_seen', null, { p_key: 'card:desk' })).status).toBeGreaterThanOrEqual(400);
    expect((await pgRpc('reset_help_seen', null)).status).toBeGreaterThanOrEqual(400);
  });
});
