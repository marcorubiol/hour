/**
 * 89 · Textos guardados del espacio (`20261102120000_workspace_text`) y, de
 * paso, 45 · `mail_domain_pending_checks` (`20261102110000`), que solo llama la
 * clave de servicio (ADR-110).
 *
 *   1. Escribe quien tiene `edit:conversation` en algún proyecto del espacio
 *      (aquí, el owner de `playwright`): INSERT y UPDATE de título y cuerpo.
 *      `created_by` no se escribe a mano (grant por columnas: 403).
 *   2. Leen los miembros internos; alguien de fuera no ve nada y no escribe.
 *   3. Borrar es blando y va por `delete_workspace_text`; de fuera, 42501.
 *   4. `mail_domain_pending_checks`: ni anon ni authenticated.
 *
 * Lo que crea lo borra (borrado blando: la fila queda en la tabla, invisible).
 */

import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import {
  decodeJwt,
  envReady,
  externalEnvReady,
  limitedEnvReady,
  login,
  pgGet,
  pgPatch,
  pgPost,
  pgRpc,
  requireEnv,
  requireExternalEnv,
  requireLimitedEnv,
} from './_helpers';

type Text = { id: string; workspace_id: string; title: string; body: string; created_by: string | null };

const RUN = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

describe.skipIf(!envReady())('RLS — workspace_text (89)', () => {
  let jwt: string;
  let me: string;
  let workspaceId: string;
  const texts: string[] = [];

  beforeAll(async () => {
    const env = requireEnv();
    jwt = await login(env.email, env.password);
    me = String(decodeJwt(jwt).sub);
    const ws = await pgGet<{ id: string }>('workspace', jwt, new URLSearchParams({ select: 'id', slug: 'eq.playwright' }));
    expect(ws.rows).toHaveLength(1);
    workspaceId = ws.rows[0]!.id;
  });

  afterAll(async () => {
    if (!jwt) return;
    for (const id of texts) await pgRpc('delete_workspace_text', jwt, { p_text_id: id });
  });

  const byId = (id: string, as: string | null) =>
    pgGet<Text>('workspace_text', as, new URLSearchParams({ select: 'id,title,body,created_by', id: `eq.${id}` }));

  test('a writer inserts and edits; created_by is theirs and cannot be forged', async () => {
    const made = await pgPost<Text>('workspace_text', jwt, {
      workspace_id: workspaceId,
      title: `Zzz Presentación ${RUN}`,
      body: 'Somos una compañía de prueba.',
    });
    expect(made.status).toBe(201);
    const row = made.rows[0]!;
    texts.push(row.id);
    expect(row.created_by).toBe(me);

    const edited = await pgPatch<Text>(
      'workspace_text',
      jwt,
      { title: `Zzz Presentación corta ${RUN}` },
      new URLSearchParams({ id: `eq.${row.id}` }),
    );
    expect(edited.status).toBe(200);
    expect(edited.rows[0]?.title).toBe(`Zzz Presentación corta ${RUN}`);

    const forged = await pgPost<Text>('workspace_text', jwt, {
      workspace_id: workspaceId,
      title: 'Zzz forged',
      body: 'x',
      created_by: crypto.randomUUID(),
    });
    expect(forged.status).toBe(403);

    const empty = await pgPost<Text>('workspace_text', jwt, { workspace_id: workspaceId, title: ' ', body: 'x' });
    expect(empty.status).toBe(400);
  });

  test.skipIf(!limitedEnvReady())('an internal member reads them', async () => {
    const lim = requireLimitedEnv();
    const member = await login(lim.email, lim.password);
    const r = await byId(texts[0]!, member);
    expect(r.status).toBe(200);
    expect(r.rows).toHaveLength(1);
  });

  test.skipIf(!externalEnvReady())('someone outside the space neither reads, writes nor deletes', async () => {
    const ext = requireExternalEnv();
    const other = await login(ext.email, ext.password);
    const read = await byId(texts[0]!, other);
    expect(read.rows).toHaveLength(0);
    const write = await pgPost('workspace_text', other, { workspace_id: workspaceId, title: 'Zzz x', body: 'y' });
    expect(write.status).toBe(403);
    const del = await pgRpc('delete_workspace_text', other, { p_text_id: texts[0]! });
    expect(del.status).toBe(403);
  });

  test('anon reads nothing', async () => {
    const r = await byId(texts[0]!, null);
    expect(r.rows).toHaveLength(0);
  });

  test('delete is soft and hides the row', async () => {
    const made = await pgPost<Text>('workspace_text', jwt, { workspace_id: workspaceId, title: `Zzz borrar ${RUN}`, body: 'b' });
    expect(made.status).toBe(201);
    const id = made.rows[0]!.id;
    const del = await pgRpc('delete_workspace_text', jwt, { p_text_id: id });
    expect(del.status).toBe(204);
    expect((await byId(id, jwt)).rows).toHaveLength(0);
    const again = await pgRpc('delete_workspace_text', jwt, { p_text_id: id });
    expect(again.status).toBe(403);
  });
});

describe.skipIf(!envReady())('RLS — mail_domain_pending_checks is the service role only (45)', () => {
  test('anon and authenticated are refused', async () => {
    const env = requireEnv();
    const jwt = await login(env.email, env.password);
    for (const who of [null, jwt]) {
      const r = await pgRpc('mail_domain_pending_checks', who, {});
      expect(r.status).toBeGreaterThanOrEqual(400);
      expect(r.data).toBeNull();
    }
  });
});
