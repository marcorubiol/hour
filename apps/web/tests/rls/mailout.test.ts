/**
 * RLS regression: envío en bloque, fase 1 (ADR-109, ADR-110, ADR-112;
 * migración 20261015100000_mailout; plan build/plans/2026-10-14-bulk-send.md
 * § 11, tests 1 a 12).
 *
 * Todo ocurre en el espacio `playwright` (nunca `muk-cia`), entre sus proyectos
 * `zzz-e2e-collab` (la fixture limitada tiene membresía) y
 * `zzz-rls-foreign-project` (no la tiene). Cada ejecución es dueña de sus filas:
 * conversaciones, dominio y envíos con un sufijo propio; al final cancela los
 * envíos, borra el dominio y las conversaciones y, si hay clave de servicio,
 * las bases y exclusiones que dejó. El acceso de la fixture limitada se
 * restaura como estaba. Todas las direcciones que podrían ponerse en cola son
 * del simulador de SES (el espacio tiene `mailout_simulator_only`).
 *
 * Lo que necesita la clave de servicio (verificar un dominio, la cola, el
 * tope, la revisión, el token de baja) se salta sin ella.
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
  projectAccess,
  requireEnv,
  requireExternalEnv,
  requireLimitedEnv,
  restoreProjectAccess,
  setFacets,
  type ProjectAccess,
} from './_helpers';

const RUN = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const SIM = (label: string) => `success+${RUN}-${label}@simulator.amazonses.com`;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const one = <T>(data: T | T[] | null): T | undefined => (Array.isArray(data) ? data[0] : (data ?? undefined));

interface Mailout {
  id: string;
  workspace_id: string;
  project_id: string;
  status: string;
  from_address: string | null;
  reply_to_address: string | null;
}

interface Recipient {
  id: string;
  conversation_id: string;
  address: string | null;
  address_kind: string | null;
  status: string;
  skip_reason: string | null;
  basis_kind: string | null;
}

interface Preview {
  recipient_id: string;
  conversation_id: string;
  address: string | null;
  status: string;
  skip_reason: string | null;
  suppressed_reason: string | null;
  ready: boolean;
}

/** Service role por REST: la clave puede ser JWT antigua o `sb_secret_`. */
async function svc<T = unknown>(
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
  path: string,
  body?: unknown,
): Promise<{ status: number; data: T | null; error?: string }> {
  const { url, anon } = requireEnv();
  const key = SERVICE_KEY!;
  const res = await fetch(new URL(`/rest/v1/${path}`, url), {
    method,
    headers: {
      apikey: key.startsWith('eyJ') ? anon : key,
      Authorization: `Bearer ${key}`,
      'content-type': 'application/json',
      Accept: 'application/json',
      Prefer: 'return=representation',
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  return res.ok
    ? { status: res.status, data: text ? (JSON.parse(text) as T) : null }
    : { status: res.status, data: null, error: text };
}

describe.skipIf(!envReady() || !limitedEnvReady())('RLS: envío en bloque (ADR-110)', () => {
  let adminJwt: string;
  let adminUserId: string;
  let limitedJwt: string;
  let limitedUserId: string;
  let limitedSnapshot: ProjectAccess | undefined;
  let workspaceId: string;
  let homeProjectId: string;
  let foreignProjectId: string;
  let domainId: string;
  const conv: Record<string, string> = {};
  const mailouts: string[] = [];
  const domains: string[] = [];
  const addresses: string[] = [];

  async function conversation(
    label: string,
    projectId: string,
    opts: { email?: string; org?: string; shared?: boolean } = {},
  ): Promise<string> {
    const res = await pgRpc<{ id: string; organization_id: string }>('create_conversation', adminJwt, {
      p_project_id: projectId,
      ...(opts.email ? { p_full_name: `RLS Envío ${label} ${RUN}`, p_email: opts.email } : {}),
      p_organization_name: opts.org ?? `RLS Sala ${label} ${RUN}`,
    });
    expect(res.status, res.error).toBe(200);
    const row = one(res.data)!;
    if (opts.shared !== false) {
      await pgPatch('conversation', adminJwt, { private_to: null }, new URLSearchParams({ id: `eq.${row.id}` }));
    }
    conv[label] = row.id;
    return row.id;
  }

  async function newMailout(jwt = adminJwt, projectId = homeProjectId, domain: string | null = null) {
    const res = await pgRpc<Mailout>('create_mailout', jwt, {
      p_project_id: projectId,
      p_mail_domain_id: domain,
    });
    const row = one(res.data);
    if (res.status === 200 && row) mailouts.push(row.id);
    return { status: res.status, row, error: res.error };
  }

  async function write(id: string, extra: Record<string, unknown> = {}, jwt = adminJwt) {
    return pgRpc<Mailout>('update_mailout', jwt, {
      p_id: id,
      p_subject: `MaMeMi, propuesta ${RUN}`,
      p_body: 'Hola, {nombre}. ¿Os encaja hablar de fechas?',
      p_language: 'es',
      p_mail_domain_id: domainId,
      ...extra,
    });
  }

  async function recipients(id: string, jwt = adminJwt) {
    return pgGet<Recipient>(
      'mailout_recipient',
      jwt,
      new URLSearchParams({
        mailout_id: `eq.${id}`,
        select: 'id,conversation_id,address,address_kind,status,skip_reason,basis_kind',
      }),
    );
  }

  async function basis(address: string, kind: string, note: string | null = null) {
    const res = await pgRpc('set_mail_basis', adminJwt, {
      p_workspace_id: workspaceId,
      p_address: address,
      p_kind: kind,
      p_note: note,
    });
    expect(res.status, res.error).toBe(200);
  }

  beforeAll(async () => {
    const admin = requireEnv();
    adminJwt = await login(admin.email, admin.password);
    adminUserId = String(decodeJwt(adminJwt).sub);
    const limited = requireLimitedEnv();
    limitedJwt = await login(limited.email, limited.password);
    limitedUserId = String(decodeJwt(limitedJwt).sub);

    const projects = await pgGet<{ id: string; slug: string; workspace_id: string }>(
      'project',
      adminJwt,
      new URLSearchParams({ slug: 'in.(zzz-e2e-collab,zzz-rls-foreign-project)', select: 'id,slug,workspace_id' }),
    );
    homeProjectId = projects.rows.find((p) => p.slug === 'zzz-e2e-collab')!.id;
    foreignProjectId = projects.rows.find((p) => p.slug === 'zzz-rls-foreign-project')!.id;
    workspaceId = projects.rows.find((p) => p.slug === 'zzz-e2e-collab')!.workspace_id;

    limitedSnapshot = await projectAccess(adminJwt, homeProjectId, limitedUserId);
    await setFacets(adminJwt, limitedSnapshot.membershipId, { converses: 'view' });

    await conversation('a', homeProjectId, { email: SIM('a') });
    await conversation('b', homeProjectId, { email: SIM('b') });
    await conversation('c', homeProjectId, { email: SIM('c') });
    await conversation('org', homeProjectId);
    await conversation('private', homeProjectId, { email: SIM('private'), shared: false });
    await conversation('real', homeProjectId, { email: `real-${RUN}@example.test` });
    await conversation('foreign', foreignProjectId, { email: SIM('foreign') });
    await conversation('deleted', homeProjectId, { email: SIM('deleted') });
    await pgRpc('delete_conversation', adminJwt, { p_conversation_id: conv.deleted });

    // El genérico de la sala de `org`, que no tiene contacto. La API no deja
    // escribir el correo de una organización: se pone con la clave de servicio.
    if (SERVICE_KEY) {
      const orgConv = await pgGet<{ organization_id: string }>(
        'conversation',
        adminJwt,
        new URLSearchParams({ id: `eq.${conv.org}`, select: 'organization_id' }),
      );
      const orgPatch = await svc<unknown[]>(
        'PATCH',
        `workspace_organization?id=eq.${orgConv.rows[0].organization_id}`,
        { email: `programacion+${RUN}@simulator.amazonses.com` },
      );
      expect(orgPatch.data?.length, orgPatch.error).toBe(1);
    }
    addresses.push(
      SIM('a'), SIM('b'), SIM('c'), SIM('private'), SIM('foreign'),
      `real-${RUN}@example.test`, `programacion+${RUN}@simulator.amazonses.com`,
    );

    const dom = await pgRpc<{ id: string }>('add_mail_domain', adminJwt, {
      p_workspace_id: workspaceId,
      p_domain: `envios-${RUN}.example.test`,
    });
    expect(dom.status, dom.error).toBe(200);
    domainId = one(dom.data)!.id;
    domains.push(domainId);
  });

  afterAll(async () => {
    for (const id of mailouts) await pgRpc('cancel_mailout', adminJwt, { p_id: id });
    for (const id of domains) await pgRpc('remove_mail_domain', adminJwt, { p_id: id });
    for (const id of Object.values(conv)) await pgRpc('delete_conversation', adminJwt, { p_conversation_id: id });
    if (SERVICE_KEY) {
      const list = `in.(${addresses.map((a) => `"${a}"`).join(',')})`;
      await svc('DELETE', `mail_suppression?workspace_id=eq.${workspaceId}&address=${encodeURIComponent(list)}`);
      await svc('DELETE', `mail_basis?workspace_id=eq.${workspaceId}&address=${encodeURIComponent(list)}`);
    }
    if (limitedSnapshot) await restoreProjectAccess(adminJwt, homeProjectId, limitedUserId, limitedSnapshot);
  });

  test('7 · un admin no verifica un dominio: ni por PATCH ni por la RPC del proveedor', async () => {
    const patch = await pgPatch(
      'mail_domain',
      adminJwt,
      { verified_at: new Date().toISOString(), dkim_status: 'SUCCESS', mail_from_status: 'SUCCESS' },
      new URLSearchParams({ id: `eq.${domainId}` }),
    );
    expect(patch.status).toBeGreaterThanOrEqual(400);
    const rpc = await pgRpc('mail_domain_record_status', adminJwt, {
      p_id: domainId,
      p_dkim_status: 'SUCCESS',
      p_mail_from_status: 'SUCCESS',
    });
    expect(rpc.status).toBeGreaterThanOrEqual(400);
    const row = await pgGet<{ verified_at: string | null; provider: string }>(
      'mail_domain',
      adminJwt,
      new URLSearchParams({ id: `eq.${domainId}`, select: 'verified_at,provider' }),
    );
    expect(row.rows).toEqual([{ verified_at: null, provider: 'simulator' }]);
  });

  test('dominios: solo el admin da de alta; un miembro lo lee', async () => {
    const res = await pgRpc('add_mail_domain', limitedJwt, {
      p_workspace_id: workspaceId,
      p_domain: `limitado-${RUN}.example.test`,
    });
    expect(res.status).toBe(403);
    expect((await pgRpc('remove_mail_domain', limitedJwt, { p_id: domainId })).status).toBe(403);
    const seen = await pgGet('mail_domain', limitedJwt, new URLSearchParams({ id: `eq.${domainId}`, select: 'id' }));
    expect(seen.rows.length).toBe(1);
    const bad = await pgRpc('add_mail_domain', adminJwt, { p_workspace_id: workspaceId, p_domain: 'no es un dominio' });
    expect(bad.status).toBe(400);
  });

  test('2 · con «ver» Converses se lee; sin «editar» no se crea, ni se escribe, ni se pone en cola', async () => {
    const m = await newMailout();
    expect(m.status, m.error).toBe(200);
    expect(m.row).toMatchObject({ workspace_id: workspaceId, project_id: homeProjectId, status: 'draft' });

    const read = await pgGet('mailout', limitedJwt, new URLSearchParams({ id: `eq.${m.row!.id}`, select: 'id' }));
    expect(read.rows.length).toBe(1);

    expect((await newMailout(limitedJwt)).status).toBe(403);
    expect((await write(m.row!.id, {}, limitedJwt)).status).toBe(403);
    expect((await pgRpc('set_mailout_recipients', limitedJwt, { p_id: m.row!.id, p_conversation_ids: [conv.a] })).status).toBe(403);
    expect((await pgRpc('queue_mailout', limitedJwt, { p_id: m.row!.id })).status).toBe(403);
    expect((await pgRpc('cancel_mailout', limitedJwt, { p_id: m.row!.id })).status).toBe(403);
    expect((await pgRpc('mailout_test_authorize', limitedJwt, { p_id: m.row!.id })).status).toBe(403);

    // Sin ninguna faceta de conversaciones no se lee.
    await setFacets(adminJwt, limitedSnapshot!.membershipId, { converses: null });
    try {
      const hidden = await pgGet('mailout', limitedJwt, new URLSearchParams({ id: `eq.${m.row!.id}`, select: 'id' }));
      expect(hidden.rows.length).toBe(0);
      expect((await pgRpc('mailout_preview', limitedJwt, { p_id: m.row!.id })).status).toBe(403);
    } finally {
      await setFacets(adminJwt, limitedSnapshot!.membershipId, { converses: 'view' });
    }

    // Con «editar» sí crea; en un proyecto donde no está, no.
    await setFacets(adminJwt, limitedSnapshot!.membershipId, { converses: 'edit' });
    try {
      expect((await newMailout(limitedJwt)).status).toBe(200);
      expect((await newMailout(limitedJwt, foreignProjectId)).status).toBe(403);
    } finally {
      await setFacets(adminJwt, limitedSnapshot!.membershipId, { converses: 'view' });
    }

    const test = await pgRpc<string>('mailout_test_authorize', adminJwt, { p_id: m.row!.id });
    expect(test.status, test.error).toBe(200);
    expect(test.data).toBe(requireEnv().email);
  });

  test('3 · set_mailout_recipients rechaza otro proyecto, una borrada o una privada ajena', async () => {
    const m = (await newMailout()).row!;
    for (const bad of [conv.foreign, conv.deleted, '00000000-0000-4000-8000-000000000000']) {
      const res = await pgRpc('set_mailout_recipients', adminJwt, { p_id: m.id, p_conversation_ids: [conv.a, bad] });
      expect(res.status, bad).toBe(403);
    }
    expect((await recipients(m.id)).rows.length, 'nada cambió').toBe(0);

    // La privada del admin, vista por la limitada con «editar», no existe.
    await setFacets(adminJwt, limitedSnapshot!.membershipId, { converses: 'edit' });
    try {
      const own = (await newMailout(limitedJwt)).row!;
      const res = await pgRpc('set_mailout_recipients', limitedJwt, {
        p_id: own.id,
        p_conversation_ids: [conv.a, conv.private],
      });
      expect(res.status).toBe(403);
    } finally {
      await setFacets(adminJwt, limitedSnapshot!.membershipId, { converses: 'view' });
    }
  });

  test('5 · el destinatario es el contacto principal o el genérico; nunca una dirección del cliente', async () => {
    const m = (await newMailout()).row!;
    const forged = await pgRpc('set_mailout_recipients', adminJwt, {
      p_id: m.id,
      p_conversation_ids: [conv.a],
      p_address: 'otro@example.test',
    });
    expect(forged.status, 'no hay parámetro de dirección').toBeGreaterThanOrEqual(400);

    const res = await pgRpc<Recipient[]>('set_mailout_recipients', adminJwt, {
      p_id: m.id,
      p_conversation_ids: [conv.a, conv.org],
    });
    expect(res.status, res.error).toBe(200);
    const rows = res.data!;
    expect(rows.find((r) => r.conversation_id === conv.a)).toMatchObject({
      address: SIM('a'),
      address_kind: 'contact',
      status: 'pending',
    });
    expect(rows.find((r) => r.conversation_id === conv.org)).toMatchObject(
      SERVICE_KEY
        ? { address: `programacion+${RUN}@simulator.amazonses.com`, address_kind: 'organization', status: 'pending' }
        : { address: null, status: 'skipped', skip_reason: 'no_address' },
    );
  });

  test('4 · un destinatario de una conversación privada ajena no se ve en un envío que sí se ve', async () => {
    const m = (await newMailout()).row!;
    const res = await pgRpc('set_mailout_recipients', adminJwt, {
      p_id: m.id,
      p_conversation_ids: [conv.a, conv.private],
    });
    expect(res.status, res.error).toBe(200);
    expect((await recipients(m.id)).rows.length).toBe(2);

    const limitedRows = await recipients(m.id, limitedJwt);
    expect(limitedRows.rows.map((r) => r.conversation_id)).toEqual([conv.a]);
    const preview = await pgRpc<Preview[]>('mailout_preview', limitedJwt, { p_id: m.id });
    expect(preview.status, preview.error).toBe(200);
    expect(preview.data!.map((r) => r.conversation_id)).toEqual([conv.a]);
  });

  test('basis: consentimiento pide nota; genérico solo para una organización; nadie ajeno la apunta', async () => {
    const noNote = await pgRpc('set_mail_basis', adminJwt, {
      p_workspace_id: workspaceId,
      p_address: SIM('a'),
      p_kind: 'consent',
    });
    expect(noNote.status).toBe(400);
    const genericContact = await pgRpc('set_mail_basis', adminJwt, {
      p_workspace_id: workspaceId,
      p_address: SIM('a'),
      p_kind: 'generic',
    });
    expect(genericContact.status).toBe(400);
    const unknown = await pgRpc('set_mail_basis', adminJwt, {
      p_workspace_id: workspaceId,
      p_address: `nadie-${RUN}@example.test`,
      p_kind: 'relationship',
    });
    expect(unknown.status).toBe(403);
    // La limitada solo ve: no edita ninguna conversación con esa dirección.
    const limited = await pgRpc('set_mail_basis', limitedJwt, {
      p_workspace_id: workspaceId,
      p_address: SIM('a'),
      p_kind: 'relationship',
    });
    expect(limited.status).toBe(403);
    // La tabla de bases solo la lee el admin.
    await basis(SIM('a'), 'consent', `Nos pidió el dossier ${RUN}`);
    const asLimited = await pgGet('mail_basis', limitedJwt, new URLSearchParams({ address: `eq.${SIM('a')}` }));
    expect(asLimited.rows.length).toBe(0);
    const asAdmin = await pgGet<{ kind: string }>('mail_basis', adminJwt, new URLSearchParams({ address: `eq.${SIM('a')}` }));
    expect(asAdmin.rows).toMatchObject([{ kind: 'consent' }]);
  });

  test('8 · mail_suppression: solo el admin la lee; la vista previa dice la razón sin dar la lista', async () => {
    const add = await pgRpc('suppress_mail_address', adminJwt, { p_workspace_id: workspaceId, p_address: SIM('c') });
    expect(add.status, add.error).toBeLessThan(300);
    expect((await pgRpc('suppress_mail_address', limitedJwt, { p_workspace_id: workspaceId, p_address: SIM('b') })).status).toBe(403);

    const asLimited = await pgGet('mail_suppression', limitedJwt, new URLSearchParams({ workspace_id: `eq.${workspaceId}` }));
    expect(asLimited.rows.length).toBe(0);
    const asAdmin = await pgGet<{ reason: string }>(
      'mail_suppression',
      adminJwt,
      new URLSearchParams({ address: `eq.${SIM('c')}`, select: 'reason' }),
    );
    expect(asAdmin.rows).toEqual([{ reason: 'manual' }]);

    const m = (await newMailout()).row!;
    await pgRpc('set_mailout_recipients', adminJwt, { p_id: m.id, p_conversation_ids: [conv.a, conv.c] });
    const preview = await pgRpc<Preview[]>('mailout_preview', limitedJwt, { p_id: m.id });
    expect(preview.status, preview.error).toBe(200);
    expect(preview.data!.find((r) => r.conversation_id === conv.c)).toMatchObject({
      suppressed_reason: 'manual',
      ready: false,
    });
    expect(preview.data!.find((r) => r.conversation_id === conv.a)).toMatchObject({
      suppressed_reason: null,
    });
  });

  test('9 · el token de baja no se lee; un token falso no hace nada y no se distingue', async () => {
    const m = (await newMailout()).row!;
    await pgRpc('set_mailout_recipients', adminJwt, { p_id: m.id, p_conversation_ids: [conv.b] });
    const token = await pgGet(
      'mailout_recipient',
      adminJwt,
      new URLSearchParams({ mailout_id: `eq.${m.id}`, select: 'unsubscribe_token' }),
    );
    expect(token.status).toBeGreaterThanOrEqual(400);
    const star = await pgGet<Record<string, unknown>>(
      'mailout_recipient',
      adminJwt,
      new URLSearchParams({ mailout_id: `eq.${m.id}`, select: '*' }),
    );
    expect(star.status).toBeGreaterThanOrEqual(400);

    const fake = await pgRpc('mailout_unsubscribe', null, { p_token: 'f'.repeat(48) });
    const empty = await pgRpc('mailout_unsubscribe', null, { p_token: '' });
    expect(fake.status).toBe(empty.status);
    expect(fake.status).toBeLessThan(300);
    expect(fake.data).toEqual(empty.data);
  });

  test('11 · nadie escribe las tablas nuevas por la API, ni el owner', async () => {
    const m = (await newMailout()).row!;
    await pgRpc('set_mailout_recipients', adminJwt, { p_id: m.id, p_conversation_ids: [conv.a] });
    const r = (await recipients(m.id)).rows[0];
    const tables: [string, Record<string, unknown>, URLSearchParams][] = [
      ['mail_domain', { workspace_id: workspaceId, domain: `directo-${RUN}.example.test` }, new URLSearchParams({ id: `eq.${domainId}` })],
      ['mailout', { workspace_id: workspaceId, project_id: homeProjectId }, new URLSearchParams({ id: `eq.${m.id}` })],
      ['mailout_recipient', { mailout_id: m.id, workspace_id: workspaceId, conversation_id: conv.b }, new URLSearchParams({ id: `eq.${r.id}` })],
      ['mailout_event', { recipient_id: r.id, workspace_id: workspaceId, type: 'delivery', occurred_at: new Date().toISOString(), provider_event_id: `x-${RUN}` }, new URLSearchParams({ recipient_id: `eq.${r.id}` })],
      ['mail_suppression', { workspace_id: workspaceId, address: SIM('b'), reason: 'manual' }, new URLSearchParams({ address: `eq.${SIM('c')}` })],
      ['mail_basis', { workspace_id: workspaceId, address: SIM('b'), kind: 'relationship' }, new URLSearchParams({ address: `eq.${SIM('a')}` })],
    ];
    const { url, anon } = requireEnv();
    for (const [table, row, filter] of tables) {
      expect((await pgPost(table, adminJwt, row)).status, `${table} INSERT`).toBeGreaterThanOrEqual(400);
      expect((await pgPatch(table, adminJwt, { workspace_id: workspaceId }, filter)).status, `${table} PATCH`).toBeGreaterThanOrEqual(400);
      const del = await fetch(new URL(`/rest/v1/${table}?${filter}`, url), {
        method: 'DELETE',
        headers: { apikey: anon, Authorization: `Bearer ${adminJwt}`, Prefer: 'return=representation' },
      });
      expect(del.status, `${table} DELETE`).toBeGreaterThanOrEqual(400);
    }
    // El admin no se sube el tope ni se quita el modo simulador.
    const ws = await pgPatch(
      'workspace',
      adminJwt,
      { mailout_daily_cap: 100000, mailout_simulator_only: false, mailout_reviewed_at: new Date().toISOString() },
      new URLSearchParams({ id: `eq.${workspaceId}` }),
    );
    expect(ws.status).toBeGreaterThanOrEqual(400);
    const privacy = await pgPatch<{ privacy_url: string }>(
      'workspace',
      adminJwt,
      { privacy_url: 'https://example.test/privacidad' },
      new URLSearchParams({ id: `eq.${workspaceId}`, select: 'privacy_url' }),
    );
    expect(privacy.status).toBe(200);
    expect(privacy.rows).toEqual([{ privacy_url: 'https://example.test/privacidad' }]);
    await pgPatch('workspace', adminJwt, { privacy_url: null }, new URLSearchParams({ id: `eq.${workspaceId}` }));
  });

  test('12 · anon no lee nada ni llama a nada salvo las dos RPC por token', async () => {
    for (const table of ['mail_domain', 'mailout', 'mailout_recipient', 'mailout_event', 'mail_suppression', 'mail_basis']) {
      const res = await pgGet(table, null, new URLSearchParams({ select: 'workspace_id', limit: '1' }));
      expect(res.rows.length, table).toBe(0);
    }
    const calls: [string, Record<string, unknown>][] = [
      ['add_mail_domain', { p_workspace_id: workspaceId, p_domain: `anon-${RUN}.example.test` }],
      ['create_mailout', { p_project_id: homeProjectId }],
      ['mailout_preview', { p_id: mailouts[0] }],
      ['queue_mailout', { p_id: mailouts[0] }],
      ['set_mail_basis', { p_workspace_id: workspaceId, p_address: SIM('a'), p_kind: 'relationship' }],
      ['mailout_claim', { p_limit: 1 }],
      ['mailout_record_event', { p_payload: {} }],
      ['mail_domain_record_status', { p_id: domainId, p_dkim_status: 'SUCCESS', p_mail_from_status: 'SUCCESS' }],
    ];
    for (const [fn, args] of calls) {
      expect((await pgRpc(fn, null, args)).status, fn).toBeGreaterThanOrEqual(400);
    }
  });

  test('las RPC de máquina son solo de service_role', async () => {
    for (const [fn, args] of [
      ['mailout_claim', { p_limit: 1 }],
      ['mailout_record_sent', { p_recipient_id: '00000000-0000-4000-8000-000000000000', p_provider_message_id: 'x', p_rfc_message_id: 'x', p_body: 'x' }],
      ['mailout_record_failure', { p_recipient_id: '00000000-0000-4000-8000-000000000000', p_error: 'x' }],
      ['mailout_record_event', { p_payload: { provider_event_id: 'x', type: 'delivery' } }],
      ['mailout_approve_review', { p_mailout_id: '00000000-0000-4000-8000-000000000000' }],
    ] as const) {
      expect((await pgRpc(fn, adminJwt, args)).status, fn).toBeGreaterThanOrEqual(400);
    }
  });

  describe.skipIf(!SERVICE_KEY)('con la clave de servicio: dominio verificado, cola, tope, revisión y baja', () => {
    let queued: Mailout;

    beforeAll(async () => {
      const ok = await svc('POST', 'rpc/mail_domain_record_status', {
        p_id: domainId,
        p_dkim_status: 'SUCCESS',
        p_mail_from_status: 'SUCCESS',
        p_dns_records: [],
      });
      expect(ok.status, ok.error).toBe(200);
      await basis(`programacion+${RUN}@simulator.amazonses.com`, 'generic');
      await basis(SIM('c'), 'relationship');
    });

    test('6 · queue_mailout: dominio sin verificar, borrador vacío, solo simulador; excluidos y sin base quedan fuera', async () => {
      // Dominio sin verificar.
      const pending = await pgRpc<{ id: string }>('add_mail_domain', adminJwt, {
        p_workspace_id: workspaceId,
        p_domain: `pendiente-${RUN}.example.test`,
      });
      domains.push(one(pending.data)!.id);
      const m0 = (await newMailout()).row!;
      await write(m0.id, { p_mail_domain_id: one(pending.data)!.id });
      await pgRpc('set_mailout_recipients', adminJwt, { p_id: m0.id, p_conversation_ids: [conv.a] });
      expect((await pgRpc('queue_mailout', adminJwt, { p_id: m0.id })).status).toBe(400);

      // Borrador vacío: sin asunto ni cuerpo; con contenido y sin destinatarios.
      const m1 = (await newMailout(adminJwt, homeProjectId, domainId)).row!;
      await pgRpc('set_mailout_recipients', adminJwt, { p_id: m1.id, p_conversation_ids: [conv.a] });
      expect((await pgRpc('queue_mailout', adminJwt, { p_id: m1.id })).status).toBe(400);
      const m2 = (await newMailout()).row!;
      await write(m2.id);
      expect((await pgRpc('queue_mailout', adminJwt, { p_id: m2.id })).status).toBe(400);

      // Modo simulador: una dirección real tumba la puesta en cola entera.
      const m3 = (await newMailout()).row!;
      await write(m3.id);
      await pgRpc('set_mailout_recipients', adminJwt, { p_id: m3.id, p_conversation_ids: [conv.a, conv.real] });
      expect((await pgRpc('queue_mailout', adminJwt, { p_id: m3.id })).status).toBe(403);
      expect((await recipients(m3.id)).rows.every((r) => r.status === 'pending')).toBe(true);

      // El bueno: a con consentimiento, org genérico, b sin base, c excluida,
      // y una que se borra después de elegirla.
      const gone = await conversation('gone', homeProjectId, { email: SIM('gone') });
      addresses.push(SIM('gone'));
      await basis(SIM('gone'), 'relationship');
      const m = (await newMailout()).row!;
      expect((await write(m.id)).status).toBe(200);
      await pgRpc('set_mailout_recipients', adminJwt, {
        p_id: m.id,
        p_conversation_ids: [conv.a, conv.b, conv.c, conv.org, gone],
      });
      await pgRpc('delete_conversation', adminJwt, { p_conversation_id: gone });
      const res = await pgRpc<Mailout>('queue_mailout', adminJwt, { p_id: m.id });
      expect(res.status, res.error).toBe(200);
      queued = one(res.data)!;
      expect(queued).toMatchObject({ status: 'queued', from_address: `difusion@envios-${RUN}.example.test` });
      expect(queued.reply_to_address).toBeTruthy();

      const rows = (await recipients(m.id)).rows;
      const by = (id: string) => rows.find((r) => r.conversation_id === id);
      expect(by(conv.a)).toMatchObject({ status: 'queued', basis_kind: 'consent' });
      expect(by(conv.org)).toMatchObject({ status: 'queued', basis_kind: 'generic' });
      expect(by(conv.b)).toMatchObject({ status: 'skipped', skip_reason: 'no_basis' });
      expect(by(conv.c)).toMatchObject({ status: 'skipped', skip_reason: 'suppressed' });
      expect(by(gone), 'una conversación borrada no se lee').toBeUndefined();
      const all = await svc<Recipient[]>('GET', `mailout_recipient?mailout_id=eq.${m.id}&conversation_id=eq.${gone}&select=status,skip_reason`);
      expect(all.data).toEqual([{ status: 'skipped', skip_reason: 'unavailable' }]);

      // Una vez en cola, ya no se edita.
      expect((await write(m.id)).status).toBe(400);
      expect((await pgRpc('set_mailout_recipients', adminJwt, { p_id: m.id, p_conversation_ids: [conv.a] })).status).toBe(400);
    });

    test('el tope diario corta: lo que pasa queda en cola', async () => {
      expect(queued, 'depende del test 6').toBeTruthy();
      const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
      const recent = await svc<{ id: string }[]>(
        'GET',
        `mailout_recipient?workspace_id=eq.${workspaceId}&or=(status.eq.sending,sent_at.gt.${since})&select=id`,
      );
      const used = recent.data!.length;
      await svc('PATCH', `workspace?id=eq.${workspaceId}`, { mailout_daily_cap: used + 1 });
      try {
        const first = await svc<{ recipient_id: string; provider: string; subject: string }[]>(
          'POST',
          'rpc/mailout_claim',
          { p_limit: 10, p_mailout_id: queued.id },
        );
        expect(first.status, first.error).toBe(200);
        expect(first.data!.length).toBe(1);
        expect(first.data![0]).toMatchObject({ provider: 'simulator', subject: `MaMeMi, propuesta ${RUN}` });
        const second = await svc<unknown[]>('POST', 'rpc/mailout_claim', { p_limit: 10, p_mailout_id: queued.id });
        expect(second.data!.length, 'el tope ya está lleno').toBe(0);

        // El enviado entra en su conversación como un correo.
        const sent = await svc<{ status: string; conversation_event_id: string }>('POST', 'rpc/mailout_record_sent', {
          p_recipient_id: first.data![0].recipient_id,
          p_provider_message_id: `sim-${RUN}`,
          p_rfc_message_id: `<sim-${RUN}@simulator.hour>`,
          p_body: 'Hola, Ana.',
        });
        expect(sent.status, sent.error).toBe(200);
        expect(one(sent.data)).toMatchObject({ status: 'sent' });
        const event = await pgGet<{ kind: string; source: string; direction: string; external_ref: string }>(
          'conversation_event',
          adminJwt,
          new URLSearchParams({ id: `eq.${one(sent.data)!.conversation_event_id}`, select: 'kind,source,direction,external_ref' }),
        );
        expect(event.rows[0]).toMatchObject({ kind: 'email', source: 'email', direction: 'outbound' });
        expect(event.rows[0].external_ref).toMatch(/^mail:<sim-.*>#/);

        const still = (await recipients(queued.id)).rows.filter((r) => r.status === 'queued');
        expect(still.length, 'el otro espera al día siguiente').toBe(1);
      } finally {
        await svc('PATCH', `workspace?id=eq.${workspaceId}`, { mailout_daily_cap: 300 });
      }
    });

    test('10 · baja con un token válido: exclusión, base retirada y nota; dos veces, igual', async () => {
      const tok = await svc<{ unsubscribe_token: string }[]>(
        'GET',
        `mailout_recipient?mailout_id=eq.${queued.id}&conversation_id=eq.${conv.a}&select=unsubscribe_token`,
      );
      const token = tok.data![0].unsubscribe_token;
      expect(token).toMatch(/^[0-9a-f]{48}$/);

      const notes = async () =>
        (
          await pgGet<{ id: string }>(
            'conversation_event',
            adminJwt,
            new URLSearchParams({ conversation_id: `eq.${conv.a}`, 'metadata->>mailout': 'eq.unsubscribed', select: 'id' }),
          )
        ).rows.length;

      for (let i = 0; i < 2; i += 1) {
        const res = await pgRpc('mailout_unsubscribe', null, { p_token: token });
        expect(res.status, res.error).toBeLessThan(300);
      }
      const sup = await pgGet<{ reason: string }>(
        'mail_suppression',
        adminJwt,
        new URLSearchParams({ address: `eq.${SIM('a')}`, select: 'reason' }),
      );
      expect(sup.rows).toEqual([{ reason: 'unsubscribe' }]);
      const b = await pgGet<{ withdrawn_at: string | null }>(
        'mail_basis',
        adminJwt,
        new URLSearchParams({ address: `eq.${SIM('a')}`, select: 'withdrawn_at' }),
      );
      expect(b.rows[0].withdrawn_at).not.toBeNull();
      expect(await notes()).toBe(1);

      // Una baja no la quita el admin; la persona, sí.
      expect((await pgRpc('remove_mail_suppression', adminJwt, { p_workspace_id: workspaceId, p_address: SIM('a') })).status).toBe(403);
      const back = await pgRpc('mailout_resubscribe', null, { p_token: token });
      expect(back.status, back.error).toBeLessThan(300);
      const after = await pgGet('mail_suppression', adminJwt, new URLSearchParams({ address: `eq.${SIM('a')}` }));
      expect(after.rows.length).toBe(0);
      const consent = await pgGet<{ kind: string; withdrawn_at: string | null }>(
        'mail_basis',
        adminJwt,
        new URLSearchParams({ address: `eq.${SIM('a')}`, select: 'kind,withdrawn_at' }),
      );
      expect(consent.rows).toEqual([{ kind: 'consent', withdrawn_at: null }]);
    });

    test('queja: supresión, base retirada; un rebote permanente excluye, uno temporal no', async () => {
      const rows = (await recipients(queued.id)).rows;
      const org = rows.find((r) => r.conversation_id === conv.org)!;
      const ev = (type: string, extra: Record<string, unknown> = {}) =>
        svc<boolean>('POST', 'rpc/mailout_record_event', {
          p_payload: { provider_event_id: `${type}-${RUN}-${Math.random()}`, recipient_id: org.id, type, ...extra },
        });
      expect((await ev('bounce', { bounce_type: 'Transient' })).data).toBe(true);
      let sup = await pgGet('mail_suppression', adminJwt, new URLSearchParams({ address: `eq.programacion+${RUN}@simulator.amazonses.com` }));
      expect(sup.rows.length).toBe(0);
      expect((await ev('complaint')).data).toBe(true);
      sup = await pgGet<{ reason: string }>(
        'mail_suppression',
        adminJwt,
        new URLSearchParams({ address: `eq.programacion+${RUN}@simulator.amazonses.com`, select: 'reason' }),
      );
      expect(sup.rows).toEqual([{ reason: 'complaint' }]);
      const repeat = await svc<boolean>('POST', 'rpc/mailout_record_event', {
        p_payload: { provider_event_id: `dup-${RUN}`, recipient_id: org.id, type: 'delivery' },
      });
      const again = await svc<boolean>('POST', 'rpc/mailout_record_event', {
        p_payload: { provider_event_id: `dup-${RUN}`, recipient_id: org.id, type: 'delivery' },
      });
      expect([repeat.data, again.data]).toEqual([true, false]);
      const events = await pgGet('mailout_event', adminJwt, new URLSearchParams({ recipient_id: `eq.${org.id}` }));
      expect(events.rows.length).toBe(3);
      expect((await pgGet('mailout_event', limitedJwt, new URLSearchParams({ recipient_id: `eq.${org.id}` }))).rows.length).toBe(3);
    });

    test('ADR-110 § 6: el primer envío real de un espacio espera la revisión de Marco', async () => {
      const ws = await svc<{ mailout_simulator_only: boolean; mailout_reviewed_at: string | null }[]>(
        'GET',
        `workspace?id=eq.${workspaceId}&select=mailout_simulator_only,mailout_reviewed_at`,
      );
      const before = ws.data![0];
      const ses = await pgRpc<{ id: string }>('add_mail_domain', adminJwt, {
        p_workspace_id: workspaceId,
        p_domain: `ses-${RUN}.example.test`,
        p_provider: 'ses',
      });
      expect(ses.status, ses.error).toBe(200);
      const sesId = one(ses.data)!.id;
      domains.push(sesId);
      await svc('POST', 'rpc/mail_domain_record_status', { p_id: sesId, p_dkim_status: 'SUCCESS', p_mail_from_status: 'SUCCESS' });
      await svc('PATCH', `workspace?id=eq.${workspaceId}`, { mailout_simulator_only: false, mailout_reviewed_at: null });
      try {
        const m = (await newMailout()).row!;
        await write(m.id, { p_mail_domain_id: sesId });
        await basis(SIM('b'), 'relationship');
        await pgRpc('set_mailout_recipients', adminJwt, { p_id: m.id, p_conversation_ids: [conv.b] });
        const res = await pgRpc<Mailout>('queue_mailout', adminJwt, { p_id: m.id });
        expect(res.status, res.error).toBe(200);
        expect(one(res.data)!.status).toBe('review');
        const none = await svc<unknown[]>('POST', 'rpc/mailout_claim', { p_limit: 10, p_mailout_id: m.id });
        expect(none.data!.length, 'en revisión no sale').toBe(0);
        const ok = await svc<Mailout>('POST', 'rpc/mailout_approve_review', { p_mailout_id: m.id });
        expect(ok.status, ok.error).toBe(200);
        expect(one(ok.data)!.status).toBe('queued');
        await pgRpc('cancel_mailout', adminJwt, { p_id: m.id });
      } finally {
        await svc('PATCH', `workspace?id=eq.${workspaceId}`, before);
      }
    });
  });

  describe.skipIf(!externalEnvReady())('1 · un login de otro espacio', () => {
    let externalJwt: string;
    let target: string;

    beforeAll(async () => {
      const ext = requireExternalEnv();
      externalJwt = await login(ext.email, ext.password);
      target = (await newMailout()).row!.id;
      await pgRpc('set_mailout_recipients', adminJwt, { p_id: target, p_conversation_ids: [conv.a] });
    });

    test('no lee envíos, destinatarios, eventos, dominios, bases ni exclusiones; sus RPC dan 42501', async () => {
      for (const table of ['mail_domain', 'mailout', 'mailout_recipient', 'mailout_event', 'mail_suppression', 'mail_basis']) {
        const res = await pgGet(table, externalJwt, new URLSearchParams({ workspace_id: `eq.${workspaceId}`, select: 'workspace_id' }));
        expect(res.rows.length, table).toBe(0);
      }
      const calls: [string, Record<string, unknown>][] = [
        ['create_mailout', { p_project_id: homeProjectId }],
        ['update_mailout', { p_id: target, p_subject: 'x', p_body: 'x' }],
        ['set_mailout_recipients', { p_id: target, p_conversation_ids: [conv.a] }],
        ['mailout_preview', { p_id: target }],
        ['mailout_test_authorize', { p_id: target }],
        ['queue_mailout', { p_id: target }],
        ['cancel_mailout', { p_id: target }],
        ['add_mail_domain', { p_workspace_id: workspaceId, p_domain: `ajeno-${RUN}.example.test` }],
        ['remove_mail_domain', { p_id: domainId }],
        ['set_mail_basis', { p_workspace_id: workspaceId, p_address: SIM('a'), p_kind: 'relationship' }],
        ['withdraw_mail_basis', { p_workspace_id: workspaceId, p_address: SIM('a') }],
        ['suppress_mail_address', { p_workspace_id: workspaceId, p_address: SIM('b') }],
        ['remove_mail_suppression', { p_workspace_id: workspaceId, p_address: SIM('c') }],
      ];
      for (const [fn, args] of calls) {
        expect((await pgRpc(fn, externalJwt, args)).status, fn).toBe(403);
      }
    });
  });
});
