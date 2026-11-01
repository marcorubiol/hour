/**
 * RLS regression: la plantilla del correo de difusión (ADR-172; migración
 * 20261102170000_mail_template).
 *
 *   · `set_mailout_image`: la escribe quien edita el envío, solo en borrador;
 *     la imagen tiene que ser una ruta de Hour de ESTE espacio (ni la de otro,
 *     ni una URL externa) y el enlace, http(s). Sin texto alternativo, el
 *     nombre del proyecto; null lo quita todo. Quien solo lee, 403; anon, no.
 *   · Las columnas nuevas se leen con el envío (SELECT a tabla entera).
 *   · `mailout_template`: solo service_role (ni persona ni anon); con la
 *     clave de servicio devuelve el logo del espacio y la imagen del envío.
 *
 * En el espacio `playwright` (nunca `muk-cia`), proyecto `zzz-e2e-collab`.
 * Cada ejecución es dueña de su envío y lo borra; el acceso de la fixture
 * limitada se restaura como estaba.
 */

import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import {
  decodeJwt,
  envReady,
  limitedEnvReady,
  login,
  pgGet,
  pgRpc,
  projectAccess,
  requireEnv,
  requireLimitedEnv,
  restoreProjectAccess,
  setFacets,
  type ProjectAccess,
} from './_helpers';

const RUN = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const OTHER_WS = '00000000-0000-4000-8000-000000000000';

const one = <T>(data: T | T[] | null): T | undefined => (Array.isArray(data) ? data[0] : (data ?? undefined));

interface MailoutImage {
  image_url: string | null;
  image_alt: string | null;
  image_link_url: string | null;
}

async function svc<T = unknown>(method: 'POST' | 'DELETE', path: string, body?: unknown) {
  const { url, anon } = requireEnv();
  const key = SERVICE_KEY!;
  const res = await fetch(new URL(`/rest/v1/${path}`, url), {
    method,
    headers: {
      apikey: key.startsWith('eyJ') ? anon : key,
      Authorization: `Bearer ${key}`,
      'content-type': 'application/json',
      Accept: 'application/json',
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, data: res.ok && text ? (JSON.parse(text) as T) : null, error: res.ok ? undefined : text };
}

describe.skipIf(!envReady() || !limitedEnvReady())('RLS: plantilla del correo (ADR-172)', () => {
  let adminJwt: string;
  let limitedJwt: string;
  let limitedUserId: string;
  let limitedSnapshot: ProjectAccess | undefined;
  let workspaceId: string;
  let projectId: string;
  let projectName: string;
  let mailoutId: string;
  let image: string;

  beforeAll(async () => {
    const admin = requireEnv();
    adminJwt = await login(admin.email, admin.password);
    const limited = requireLimitedEnv();
    limitedJwt = await login(limited.email, limited.password);
    limitedUserId = String(decodeJwt(limitedJwt).sub);

    const projects = await pgGet<{ id: string; workspace_id: string; name: string }>(
      'project',
      adminJwt,
      new URLSearchParams({ slug: 'eq.zzz-e2e-collab', select: 'id,workspace_id,name' }),
    );
    projectId = projects.rows[0].id;
    workspaceId = projects.rows[0].workspace_id;
    projectName = projects.rows[0].name;
    image = `/m/ws/${workspaceId}/mail/${'a'.repeat(32)}-1200x800.jpg`;
    limitedSnapshot = await projectAccess(adminJwt, projectId, limitedUserId);
    await setFacets(adminJwt, limitedSnapshot.membershipId, { converses: 'view' });

    const m = await pgRpc<{ id: string }>('create_mailout', adminJwt, { p_project_id: projectId });
    expect(m.status, m.error).toBe(200);
    mailoutId = one(m.data)!.id;
  });

  afterAll(async () => {
    if (mailoutId) await pgRpc('cancel_mailout', adminJwt, { p_id: mailoutId });
    if (SERVICE_KEY && mailoutId) await svc('DELETE', `mailout?id=eq.${mailoutId}`);
    if (limitedSnapshot) await restoreProjectAccess(adminJwt, projectId, limitedUserId, limitedSnapshot);
  });

  async function read(): Promise<MailoutImage> {
    const r = await pgGet<MailoutImage>(
      'mailout',
      adminJwt,
      new URLSearchParams({ id: `eq.${mailoutId}`, select: 'image_url,image_alt,image_link_url' }),
    );
    return r.rows[0];
  }

  test('quien edita pone la imagen; sin alt, el nombre del proyecto; se lee con el envío', async () => {
    const res = await pgRpc('set_mailout_image', adminJwt, {
      p_id: mailoutId,
      p_image_url: image,
      p_image_link_url: `https://example.test/dossier-${RUN}.pdf`,
    });
    expect(res.status, res.error).toBe(200);
    expect(await read()).toEqual({ image_url: image, image_alt: projectName.slice(0, 200), image_link_url: `https://example.test/dossier-${RUN}.pdf` });

    // Quien lee el envío ve también la imagen.
    const asLimited = await pgGet<MailoutImage>(
      'mailout',
      limitedJwt,
      new URLSearchParams({ id: `eq.${mailoutId}`, select: 'image_url' }),
    );
    expect(asLimited.rows).toEqual([{ image_url: image }]);
  });

  test('ni la imagen de otro espacio, ni una URL externa, ni un enlace que no sea http(s)', async () => {
    const other = `/m/ws/${OTHER_WS}/mail/${'b'.repeat(32)}-10x10.jpg`;
    for (const args of [
      { p_image_url: other },
      { p_image_url: 'https://evil.example/x.jpg' },
      { p_image_url: image, p_image_link_url: 'javascript:alert(1)' },
    ]) {
      const res = await pgRpc('set_mailout_image', adminJwt, { p_id: mailoutId, ...args });
      expect(res.status, JSON.stringify(args)).toBe(400);
    }
    expect((await read()).image_url).toBe(image);
  });

  test('quien solo lee no la cambia; sin sesión tampoco', async () => {
    expect((await pgRpc('set_mailout_image', limitedJwt, { p_id: mailoutId, p_image_url: null })).status).toBe(403);
    expect((await pgRpc('set_mailout_image', null, { p_id: mailoutId, p_image_url: null })).status).toBeGreaterThanOrEqual(400);
    expect((await read()).image_url).toBe(image);
  });

  test('mailout_template: ni una persona ni anon', async () => {
    expect((await pgRpc('mailout_template', adminJwt, { p_mailout_ids: [mailoutId] })).status).toBeGreaterThanOrEqual(400);
    expect((await pgRpc('mailout_template', null, { p_mailout_ids: [mailoutId] })).status).toBeGreaterThanOrEqual(400);
  });

  test.skipIf(!SERVICE_KEY)('mailout_template con la clave de servicio: logo del espacio e imagen del envío', async () => {
    const ws = await pgGet<{ name: string; logo_url: string | null }>(
      'workspace',
      adminJwt,
      new URLSearchParams({ id: `eq.${workspaceId}`, select: 'name,logo_url' }),
    );
    const res = await svc<{ mailout_id: string; company_name: string; logo_url: string | null; image_url: string | null }[]>(
      'POST',
      'rpc/mailout_template',
      { p_mailout_ids: [mailoutId] },
    );
    expect(res.status, res.error).toBe(200);
    expect(res.data).toEqual([
      expect.objectContaining({ mailout_id: mailoutId, company_name: ws.rows[0].name, logo_url: ws.rows[0].logo_url, image_url: image }),
    ]);
  });

  test('null la quita entera; fuera de borrador ya no se toca', async () => {
    const res = await pgRpc('set_mailout_image', adminJwt, { p_id: mailoutId, p_image_url: null, p_image_alt: 'x' });
    expect(res.status, res.error).toBe(200);
    expect(await read()).toEqual({ image_url: null, image_alt: null, image_link_url: null });

    expect((await pgRpc('cancel_mailout', adminJwt, { p_id: mailoutId })).status).toBeLessThan(300);
    expect((await pgRpc('set_mailout_image', adminJwt, { p_id: mailoutId, p_image_url: image })).status).toBe(400);
  });
});
