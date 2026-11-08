/**
 * RLS regression: el diseño de una invitación solo lo escribe el Worker
 * (ADR-190; migración 20261108120000_mailout_design). Con el JWT no se puede
 * llamar a `set_mailout_design` ni escribir las columnas: así todo HTML que
 * se guarda pasó por la limpieza del servidor. Con la clave de servicio, la
 * RPC respeta borrador e invitación, y la base no deja diseño en una difusión.
 *
 * Escrito sin correr: necesita la migración aplicada. Todo en el espacio
 * `playwright`, con un borrador propio que se cancela al acabar.
 */

import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { envReady, login, pgGet, pgPatch, pgRpc, requireEnv } from './_helpers';

const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const one = <T>(data: T | T[] | null): T | undefined => (Array.isArray(data) ? data[0] : (data ?? undefined));

const DESIGN = { blocks: [{ type: 'paragraph', content: '<p>Hola</p>' }], settings: {} };
const HTML = '<!doctype html><html><head></head><body><p>Hola</p></body></html>';

async function svcRpc(name: string, args: Record<string, unknown>): Promise<{ status: number; text: string }> {
  const { url, anon } = requireEnv();
  const key = SERVICE_KEY!;
  const res = await fetch(new URL(`/rest/v1/rpc/${name}`, url), {
    method: 'POST',
    headers: {
      apikey: key.startsWith('eyJ') ? anon : key,
      Authorization: `Bearer ${key}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify(args),
  });
  return { status: res.status, text: await res.text() };
}

describe.skipIf(!envReady())('RLS: el diseño de una invitación, solo por el Worker (ADR-190)', () => {
  let adminJwt: string;
  let workspaceId: string;
  let projectId: string;
  const mailouts: string[] = [];

  beforeAll(async () => {
    const admin = requireEnv();
    adminJwt = await login(admin.email, admin.password);
    const projects = await pgGet<{ id: string; workspace_id: string }>(
      'project',
      adminJwt,
      new URLSearchParams({ slug: 'eq.zzz-e2e-collab', select: 'id,workspace_id' }),
    );
    projectId = projects.rows[0].id;
    workspaceId = projects.rows[0].workspace_id;
  });

  afterAll(async () => {
    for (const id of mailouts) await pgRpc('cancel_mailout', adminJwt, { p_id: id });
  });

  async function invitation(): Promise<string> {
    const res = await pgRpc<{ id: string }>('create_invitation', adminJwt, { p_workspace_id: workspaceId });
    expect(res.status, res.error).toBe(200);
    const id = one(res.data)!.id;
    mailouts.push(id);
    return id;
  }

  test('con el JWT, set_mailout_design no se puede llamar', async () => {
    const id = await invitation();
    const res = await pgRpc('set_mailout_design', adminJwt, { p_id: id, p_design: DESIGN, p_design_html: HTML, p_body: 'Hola' });
    expect(res.status).toBeGreaterThanOrEqual(400);
    const row = await pgGet<{ design: unknown }>('mailout', adminJwt, new URLSearchParams({ id: `eq.${id}`, select: 'design' }));
    expect(row.rows[0]?.design ?? null).toBeNull();
  });

  test('con el JWT, las columnas tampoco se escriben a mano', async () => {
    const id = await invitation();
    const res = await pgPatch('mailout', adminJwt, { design: DESIGN, design_html: HTML }, new URLSearchParams({ id: `eq.${id}` }));
    expect(res.rows.length).toBe(0);
  });

  test.skipIf(!SERVICE_KEY)('con la clave de servicio: guarda diseño y cuerpo juntos; null vuelve a carta y deja el cuerpo', async () => {
    const id = await invitation();
    const w = await svcRpc('set_mailout_design', { p_id: id, p_design: DESIGN, p_design_html: HTML, p_body: 'Hola' });
    expect(w.status, w.text).toBe(200);
    const after = await pgGet<{ design: unknown; design_html: string | null; body: string | null }>(
      'mailout',
      adminJwt,
      new URLSearchParams({ id: `eq.${id}`, select: 'design,design_html,body' }),
    );
    expect(after.rows[0].design).not.toBeNull();
    expect(after.rows[0].body).toBe('Hola');
    const back = await svcRpc('set_mailout_design', { p_id: id, p_design: null, p_design_html: null, p_body: null });
    expect(back.status, back.text).toBe(200);
    const letter = await pgGet<{ design: unknown; design_html: string | null; body: string | null }>(
      'mailout',
      adminJwt,
      new URLSearchParams({ id: `eq.${id}`, select: 'design,design_html,body' }),
    );
    expect(letter.rows[0].design).toBeNull();
    expect(letter.rows[0].design_html).toBeNull();
    expect(letter.rows[0].body).toBe('Hola');
  });

  test.skipIf(!SERVICE_KEY)('ni con la clave de servicio en una difusión', async () => {
    const res = await pgRpc<{ id: string }>('create_mailout', adminJwt, { p_project_id: projectId, p_mail_domain_id: null });
    expect(res.status, res.error).toBe(200);
    const id = one(res.data)!.id;
    mailouts.push(id);
    const w = await svcRpc('set_mailout_design', { p_id: id, p_design: DESIGN, p_design_html: HTML, p_body: 'Hola' });
    expect(w.status).toBeGreaterThanOrEqual(400);
  });
});
