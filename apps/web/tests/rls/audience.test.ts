/**
 * RLS regression: el público y sus invitaciones, fase 1 (ADR-173; migración
 * 20261102180100_audience; plan build/plans/2026-11-01-audience.md § 7, los 16
 * casos de la puerta de la fase 1).
 *
 * Todo ocurre en el espacio `playwright` (nunca `muk-cia`), entre sus proyectos
 * `zzz-e2e-collab` (la fixture limitada tiene membresía) y
 * `zzz-rls-foreign-project` (no la tiene). Cada ejecución es dueña de sus filas:
 * listas, conversaciones, dominios e invitaciones con un sufijo propio; al
 * final, con la clave de servicio, borra sus invitaciones y sus listas (con sus
 * personas, textos e importaciones), y las bases y exclusiones que dejó; sin
 * ella, cancela y archiva. La faceta Público de la fixture limitada vuelve a
 * nada, su acceso al proyecto como estaba y la política de privacidad del
 * espacio como estaba. Todas las direcciones que podrían ponerse en cola son
 * del simulador de SES (el espacio tiene `mailout_simulator_only`).
 *
 * Lo que necesita la clave de servicio (el alta del formulario, la
 * confirmación, verificar dominios, la cola, el tope, los eventos) se salta
 * sin ella.
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
const FAKE_ID = '00000000-0000-4000-8000-000000000000';

const one = <T>(data: T | T[] | null): T | undefined => (Array.isArray(data) ? data[0] : (data ?? undefined));

interface Mailout {
  id: string;
  kind: string;
  status: string;
  audience_id: string | null;
  mail_domain_id: string | null;
  audience_mail_domain_id: string | null;
  from_address: string | null;
}

interface Recipient {
  id: string;
  conversation_id: string | null;
  audience_subscription_id: string | null;
  address: string | null;
  address_kind: string | null;
  status: string;
  skip_reason: string | null;
  basis_kind: string | null;
  mail_domain_id: string | null;
  consent_event_id: string | null;
  conversation_event_id: string | null;
}

interface Subscribed {
  subscription_id: string | null;
  token: string | null;
  language: string | null;
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

describe.skipIf(!envReady() || !limitedEnvReady())('RLS: el público y sus invitaciones (ADR-173)', () => {
  let adminJwt: string;
  let limitedJwt: string;
  let limitedUserId: string;
  let limitedWsMembership: string;
  let limitedSnapshot: ProjectAccess | undefined;
  let workspaceId: string;
  let homeProjectId: string;
  let foreignProjectId: string;
  let privacyBefore: string | null = null;
  let outDomain: string;
  let audDomain: string;
  let listId: string;
  let formKey: string;
  const conv: Record<string, string> = {};
  const mailouts: string[] = [];
  const domains: string[] = [];
  const audiences: string[] = [];
  const addresses: string[] = [];

  async function conversation(
    label: string,
    projectId: string,
    opts: { email?: string; shared?: boolean } = {},
  ): Promise<string> {
    const res = await pgRpc<{ id: string }>('create_conversation', adminJwt, {
      p_project_id: projectId,
      ...(opts.email ? { p_full_name: `RLS Público ${label} ${RUN}`, p_email: opts.email } : {}),
      p_organization_name: `RLS Sala ${label} ${RUN}`,
    });
    expect(res.status, res.error).toBe(200);
    const row = one(res.data)!;
    if (opts.shared !== false) {
      await pgPatch('conversation', adminJwt, { private_to: null }, new URLSearchParams({ id: `eq.${row.id}` }));
    }
    if (opts.email) addresses.push(opts.email);
    conv[label] = row.id;
    return row.id;
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

  async function newList(name: string, jwt = adminJwt) {
    const res = await pgRpc<{ id: string; form_key: string }>('create_audience', jwt, {
      p_workspace_id: workspaceId,
      p_name: `${name} ${RUN}`,
      p_languages: ['es', 'ca'],
    });
    const row = one(res.data);
    if (res.status === 200 && row) audiences.push(row.id);
    return { status: res.status, row, error: res.error };
  }

  async function setText(id: string, label: string, jwt = adminJwt) {
    return pgRpc<{ current_text_version: number }>('set_audience_consent_text', jwt, {
      p_audience_id: id,
      p_texts: {
        es: { consent_text: `Quiero recibir invitaciones ${label} ${RUN}.`, info_text: 'Responsable: Playwright.' },
        ca: { consent_text: `Vull rebre invitacions ${label} ${RUN}.`, info_text: 'Responsable: Playwright.' },
      },
    });
  }

  /** Una lista abierta con su texto, lista para altas. */
  async function openList(name: string): Promise<{ id: string; key: string }> {
    const list = await newList(name);
    expect(list.status, list.error).toBe(200);
    expect((await setText(list.row!.id, name)).status).toBe(200);
    const open = await pgRpc('set_audience_status', adminJwt, { p_id: list.row!.id, p_status: 'open' });
    expect(open.status, open.error).toBe(200);
    return { id: list.row!.id, key: list.row!.form_key };
  }

  async function invitation(
    opts: { audience?: string | null; convs?: string[]; jwt?: string } = {},
  ): Promise<{ status: number; row?: Mailout; error?: string }> {
    const res = await pgRpc<Mailout>('create_invitation', opts.jwt ?? adminJwt, {
      p_workspace_id: workspaceId,
      p_audience_id: opts.audience ?? null,
      p_conversation_ids: opts.convs ?? null,
    });
    const row = one(res.data);
    if (res.status === 200 && row) mailouts.push(row.id);
    return { status: res.status, row, error: res.error };
  }

  async function write(id: string, jwt = adminJwt) {
    return pgRpc<Mailout>('update_mailout', jwt, {
      p_id: id,
      p_subject: `Estreno de MaMeMi ${RUN}`,
      p_body: 'Hola, {nombre}. Os esperamos en {sala}.',
      p_language: 'es',
      p_mail_domain_id: outDomain,
    });
  }

  async function recipients(id: string, jwt = adminJwt) {
    return pgGet<Recipient>(
      'mailout_recipient',
      jwt,
      new URLSearchParams({
        mailout_id: `eq.${id}`,
        select:
          'id,conversation_id,audience_subscription_id,address,address_kind,status,skip_reason,basis_kind,mail_domain_id,consent_event_id,conversation_event_id',
      }),
    );
  }

  /** El alta del formulario, como la hace el Worker (service_role). */
  async function subscribe(address: string, key = formKey) {
    if (!addresses.includes(address)) addresses.push(address);
    return svc<Subscribed[]>('POST', 'rpc/audience_subscribe', {
      p_key: key,
      p_address: address,
      p_name: 'Ana',
      p_language: 'es',
      p_text_id: null,
      p_age_confirmed: true,
      p_ip: '203.0.113.7',
      p_user_agent: `vitest ${RUN}`,
      p_channel: 'form',
      p_page_url: 'https://example.test/compania',
    });
  }

  /** Alta y confirmación: devuelve el id de la suscripción confirmada. */
  async function confirmed(address: string, key = formKey): Promise<string> {
    const sub = await subscribe(address, key);
    expect(sub.status, sub.error).toBe(200);
    const row = one(sub.data)!;
    expect(row.token, `token para ${address}`).toMatch(/^[0-9a-f]{64}$/);
    const ok = await svc<boolean>('POST', 'rpc/audience_confirm', {
      p_token: row.token,
      p_ip: '203.0.113.8',
      p_user_agent: `vitest ${RUN}`,
    });
    expect(ok.data, ok.error).toBe(true);
    return row.subscription_id!;
  }

  beforeAll(async () => {
    const admin = requireEnv();
    adminJwt = await login(admin.email, admin.password);
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

    const wsm = await pgGet<{ id: string }>(
      'membership',
      adminJwt,
      new URLSearchParams({
        level: 'eq.workspace',
        workspace_id: `eq.${workspaceId}`,
        user_id: `eq.${limitedUserId}`,
        select: 'id',
      }),
    );
    expect(wsm.rows.length, 'la limitada es miembro del espacio').toBe(1);
    limitedWsMembership = wsm.rows[0].id;
    await setFacets(adminJwt, limitedWsMembership, { audience: null });

    limitedSnapshot = await projectAccess(adminJwt, homeProjectId, limitedUserId);
    await setFacets(adminJwt, limitedSnapshot.membershipId, { converses: 'view' });

    // Abrir una lista pide la política de privacidad del espacio.
    const ws = await pgGet<{ privacy_url: string | null }>(
      'workspace',
      adminJwt,
      new URLSearchParams({ id: `eq.${workspaceId}`, select: 'privacy_url' }),
    );
    privacyBefore = ws.rows[0].privacy_url;
    await pgPatch(
      'workspace',
      adminJwt,
      { privacy_url: `https://example.test/privacidad-${RUN}` },
      new URLSearchParams({ id: `eq.${workspaceId}` }),
    );

    await conversation('pa', homeProjectId, { email: SIM('pa') });
    await conversation('pb', homeProjectId, { email: SIM('pb') });
    await conversation('shared', homeProjectId, { email: SIM('shared') });
    await conversation('private', homeProjectId, { email: SIM('private'), shared: false });
    await conversation('foreign', foreignProjectId, { email: SIM('foreign') });
    await basis(SIM('pa'), 'relationship');
    await basis(SIM('shared'), 'consent', `Nos pidió el dossier ${RUN}`);

    const out = await pgRpc<{ id: string; purpose: string; tenant_name: string }>('add_mail_domain', adminJwt, {
      p_workspace_id: workspaceId,
      p_domain: `inv-${RUN}.example.test`,
    });
    expect(out.status, out.error).toBe(200);
    expect(one(out.data)).toMatchObject({ purpose: 'outreach', tenant_name: `hour-${workspaceId}` });
    outDomain = one(out.data)!.id;
    domains.push(outDomain);
    const aud = await pgRpc<{ id: string; purpose: string; tenant_name: string; from_local_part: string }>(
      'add_mail_domain',
      adminJwt,
      { p_workspace_id: workspaceId, p_domain: `publico.inv-${RUN}.example.test`, p_purpose: 'audience' },
    );
    expect(aud.status, aud.error).toBe(200);
    expect(one(aud.data)).toMatchObject({
      purpose: 'audience',
      tenant_name: `hour-aud-${workspaceId}`,
      from_local_part: 'hola',
    });
    audDomain = one(aud.data)!.id;
    domains.push(audDomain);

    const main = await openList('Estrenos');
    listId = main.id;
    formKey = main.key;
  });

  afterAll(async () => {
    for (const id of mailouts) await pgRpc('cancel_mailout', adminJwt, { p_id: id });
    if (SERVICE_KEY) {
      if (mailouts.length) await svc('DELETE', `mailout?id=in.(${mailouts.join(',')})`);
      if (audiences.length) await svc('DELETE', `audience?id=in.(${audiences.join(',')})`);
      const list = `in.(${addresses.map((a) => `"${a}"`).join(',')})`;
      await svc('DELETE', `mail_suppression?workspace_id=eq.${workspaceId}&address=${encodeURIComponent(list)}`);
      await svc('DELETE', `mail_basis?workspace_id=eq.${workspaceId}&address=${encodeURIComponent(list)}`);
    } else {
      for (const id of audiences) await pgRpc('set_audience_status', adminJwt, { p_id: id, p_status: 'archived' });
    }
    for (const id of domains) await pgRpc('remove_mail_domain', adminJwt, { p_id: id });
    for (const id of Object.values(conv)) await pgRpc('delete_conversation', adminJwt, { p_conversation_id: id });
    await pgPatch('workspace', adminJwt, { privacy_url: privacyBefore }, new URLSearchParams({ id: `eq.${workspaceId}` }));
    if (limitedWsMembership) await setFacets(adminJwt, limitedWsMembership, { audience: null });
    if (limitedSnapshot) await restoreProjectAccess(adminJwt, homeProjectId, limitedUserId, limitedSnapshot);
  });

  test('2 · sin la faceta Público no se lee nada; con «ver» se lee y no se escribe; con «ver y editar», sí', async () => {
    const read = async () =>
      (await pgGet('audience', limitedJwt, new URLSearchParams({ id: `eq.${listId}`, select: 'id' }))).rows.length;

    expect(await read()).toBe(0);
    expect((await pgGet('audience_consent_text', limitedJwt, new URLSearchParams({ audience_id: `eq.${listId}` }))).rows.length).toBe(0);
    expect((await newList('Limitada', limitedJwt)).status).toBe(403);

    await setFacets(adminJwt, limitedWsMembership, { audience: 'view' });
    try {
      expect(await read()).toBe(1);
      expect((await pgGet('audience_consent_text', limitedJwt, new URLSearchParams({ audience_id: `eq.${listId}` }))).rows.length).toBe(2);
      expect((await newList('Limitada', limitedJwt)).status).toBe(403);
      expect((await setText(listId, 'limitada', limitedJwt)).status).toBe(403);
      expect((await pgRpc('regenerate_audience_form_key', limitedJwt, { p_id: listId })).status).toBe(403);
      expect((await pgRpc('add_audience_subscription', limitedJwt, { p_audience_id: listId, p_address: SIM('lim') })).status).toBe(403);

      await setFacets(adminJwt, limitedWsMembership, { audience: 'edit' });
      const own = await newList('Limitada', limitedJwt);
      expect(own.status, own.error).toBe(200);
      const upd = await pgRpc('update_audience', limitedJwt, {
        p_id: own.row!.id,
        p_name: `Limitada editada ${RUN}`,
        p_description: 'Funciones familiares.',
        p_languages: ['es'],
        p_default_language: 'es',
      });
      expect(upd.status, upd.error).toBe(200);
    } finally {
      await setFacets(adminJwt, limitedWsMembership, { audience: null });
    }
    expect(await read()).toBe(0);
  });

  test('una faceta de espacio que no es Público sigue sin poderse dar', async () => {
    const facets = await pgGet<{ id: string; key: string }>(
      'facet',
      adminJwt,
      new URLSearchParams({ workspace_id: 'is.null', key: 'eq.converses', select: 'id,key' }),
    );
    const res = await pgRpc('set_membership_facet', adminJwt, {
      p_membership_id: limitedWsMembership,
      p_facet_id: facets.rows[0].id,
      p_verb: 'view',
    });
    expect(res.status).toBeGreaterThanOrEqual(400);
  });

  test('4 · el texto de consentimiento no se cambia: una versión nueva no toca las viejas', async () => {
    const v1 = await pgGet<{ id: string; consent_text: string }>(
      'audience_consent_text',
      adminJwt,
      new URLSearchParams({ audience_id: `eq.${listId}`, version: 'eq.1', language: 'eq.es', select: 'id,consent_text' }),
    );
    expect(v1.rows.length).toBe(1);
    const res = await setText(listId, 'segunda');
    expect(res.status, res.error).toBe(200);
    expect(one(res.data)!.current_text_version).toBe(2);
    const again = await pgGet<{ id: string; consent_text: string }>(
      'audience_consent_text',
      adminJwt,
      new URLSearchParams({ audience_id: `eq.${listId}`, version: 'eq.1', language: 'eq.es', select: 'id,consent_text' }),
    );
    expect(again.rows).toEqual(v1.rows);
    const versions = await pgGet('audience_consent_text', adminJwt, new URLSearchParams({ audience_id: `eq.${listId}` }));
    expect(versions.rows.length).toBe(4);

    const patch = await pgPatch(
      'audience_consent_text',
      adminJwt,
      { consent_text: 'Otro texto que nadie aceptó.' },
      new URLSearchParams({ id: `eq.${v1.rows[0].id}` }),
    );
    expect(patch.status).toBeGreaterThanOrEqual(400);
    if (SERVICE_KEY) {
      // Ni con la clave de servicio: lo para la tabla, no el grant.
      const svcPatch = await svc('PATCH', `audience_consent_text?id=eq.${v1.rows[0].id}`, {
        consent_text: 'Otro texto que nadie aceptó.',
      });
      expect(svcPatch.status).toBeGreaterThanOrEqual(400);
    }
    // Un texto que no cubre los idiomas de la lista no vale.
    const partial = await pgRpc('set_audience_consent_text', adminJwt, {
      p_audience_id: listId,
      p_texts: { es: { consent_text: `Solo en castellano ${RUN}.` } },
    });
    expect(partial.status).toBe(400);
  });

  test('una lista no se abre sin política de privacidad ni sin texto', async () => {
    const list = await newList('Sin texto');
    expect((await pgRpc('set_audience_status', adminJwt, { p_id: list.row!.id, p_status: 'open' })).status).toBe(400);
    expect((await setText(list.row!.id, 'sin texto')).status).toBe(200);
    await pgPatch('workspace', adminJwt, { privacy_url: null }, new URLSearchParams({ id: `eq.${workspaceId}` }));
    try {
      expect((await pgRpc('set_audience_status', adminJwt, { p_id: list.row!.id, p_status: 'open' })).status).toBe(400);
    } finally {
      await pgPatch(
        'workspace',
        adminJwt,
        { privacy_url: `https://example.test/privacidad-${RUN}` },
        new URLSearchParams({ id: `eq.${workspaceId}` }),
      );
    }
    expect((await pgRpc('set_audience_status', adminJwt, { p_id: list.row!.id, p_status: 'open' })).status).toBe(200);
  });

  test('5 · anon solo llega al formulario, a la confirmación y a la baja por token; lo demás, 4xx', async () => {
    const info = await pgRpc<Record<string, unknown>[]>('audience_form_info', null, { p_key: formKey, p_language: 'ca' });
    expect(info.status, info.error).toBe(200);
    expect(Object.keys(info.data![0]).sort()).toEqual(
      ['audience_name', 'company_name', 'consent_text', 'consent_text_id', 'description', 'info_text', 'language',
        'languages', 'logo_url', 'open', 'privacy_url'].sort(),
    );
    expect(info.data![0]).toMatchObject({ language: 'ca', open: true });
    const unknown = await pgRpc<unknown[]>('audience_form_info', null, { p_key: 'f'.repeat(32) });
    expect(unknown.data).toEqual([]);
    const conf = await pgRpc<unknown[]>('audience_confirm_info', null, { p_token: 'f'.repeat(64) });
    expect(conf.status, conf.error).toBe(200);
    expect(conf.data).toEqual([]);
    for (const fn of ['mailout_unsubscribe', 'mailout_resubscribe', 'mailout_unsubscribe_everything']) {
      expect((await pgRpc(fn, null, { p_token: 'f'.repeat(48) })).status, fn).toBeLessThan(300);
    }
    expect((await pgRpc('mailout_unsubscribe_info', null, { p_token: 'f'.repeat(48) })).data).toEqual([]);

    for (const table of ['audience', 'audience_consent_text', 'audience_import', 'audience_subscription', 'audience_consent_event']) {
      const res = await pgGet(table, null, new URLSearchParams({ select: 'workspace_id', limit: '1' }));
      expect(res.rows.length, table).toBe(0);
    }
    const machine: [string, Record<string, unknown>][] = [
      ['audience_subscribe', { p_key: formKey, p_address: SIM('anon'), p_name: null, p_language: 'es', p_text_id: null, p_age_confirmed: true, p_ip: '203.0.113.9', p_user_agent: 'x' }],
      ['audience_confirm', { p_token: 'f'.repeat(64) }],
      ['audience_confirmation_token', { p_subscription_id: FAKE_ID }],
      ['audience_confirmation_sent', { p_subscription_id: FAKE_ID, p_provider_message_id: 'x' }],
      ['audience_purge_pending', {}],
      ['audience_approve_import', { p_import_id: FAKE_ID }],
    ];
    const person: [string, Record<string, unknown>][] = [
      ['create_audience', { p_workspace_id: workspaceId, p_name: 'anon' }],
      ['set_audience_status', { p_id: listId, p_status: 'closed' }],
      ['add_audience_subscription', { p_audience_id: listId, p_address: SIM('anon') }],
      ['import_audience', { p_audience_id: listId, p_filename: 'x.csv', p_rows: [], p_basis_kind: 'consent', p_source_note: 'xxxxxxxxxxxx' }],
      ['audience_consent_proof', { p_subscription_id: FAKE_ID }],
      ['create_invitation', { p_workspace_id: workspaceId, p_audience_id: listId }],
    ];
    for (const [fn, args] of [...machine, ...person]) {
      expect((await pgRpc(fn, null, args)).status, `anon ${fn}`).toBeGreaterThanOrEqual(400);
    }
    // Las de máquina tampoco son de una persona, ni del owner: la IP la pone el Worker.
    for (const [fn, args] of machine) {
      expect((await pgRpc(fn, adminJwt, args)).status, `admin ${fn}`).toBeGreaterThanOrEqual(400);
    }
  });

  test('11 · importar: base y fuente obligatorias; la primera queda en revisión; una baja no se deshace importando', async () => {
    const rows = [{ email: SIM('i1') }, { email: SIM('i1') }, { email: 'no es una dirección' }];
    addresses.push(SIM('i1'));
    const noBasis = await pgRpc('import_audience', adminJwt, {
      p_audience_id: listId, p_filename: 'lista.csv', p_rows: rows, p_basis_kind: null, p_source_note: 'Formulario de la web, 2024 a 2026',
    });
    expect(noBasis.status).toBe(400);
    const generic = await pgRpc('import_audience', adminJwt, {
      p_audience_id: listId, p_filename: 'lista.csv', p_rows: rows, p_basis_kind: 'generic', p_source_note: 'Formulario de la web, 2024 a 2026',
    });
    expect(generic.status).toBe(400);
    const noSource = await pgRpc('import_audience', adminJwt, {
      p_audience_id: listId, p_filename: 'lista.csv', p_rows: rows, p_basis_kind: 'consent', p_source_note: 'web',
    });
    expect(noSource.status).toBe(400);

    const doneBefore = await pgGet(
      'audience_import',
      adminJwt,
      new URLSearchParams({ workspace_id: `eq.${workspaceId}`, status: 'eq.done', select: 'id' }),
    );

    // Una persona de baja en la lista: la importación no la vuelve a apuntar.
    const unsub = await pgRpc<{ subscription_id: string }[]>('add_audience_subscription', adminJwt, {
      p_audience_id: listId,
      p_address: SIM('u11'),
    });
    expect(unsub.status, unsub.error).toBe(200);
    addresses.push(SIM('u11'));
    const unsubId = unsub.data![0].subscription_id;
    expect((await pgRpc('unsubscribe_audience_subscription', adminJwt, { p_id: unsubId })).status).toBeLessThan(300);

    const res = await pgRpc<{ status: string; imported_count: number; row_count: number; skipped: Record<string, number> }>(
      'import_audience',
      adminJwt,
      {
        p_audience_id: listId,
        p_filename: 'lista.csv',
        p_rows: [...rows, { email: SIM('u11') }],
        p_basis_kind: 'consent',
        p_source_note: 'Formulario de nuestra web con casilla, 2024 a 2026',
        p_statement_language: 'es',
      },
    );
    expect(res.status, res.error).toBe(200);
    expect(res.data).toMatchObject({
      status: doneBefore.rows.length === 0 ? 'review' : 'done',
      row_count: 4,
      imported_count: 1,
      skipped: { duplicate: 1, invalid: 1, unsubscribed: 1 },
    });
    const after = await pgGet<{ status: string }>(
      'audience_subscription',
      adminJwt,
      new URLSearchParams({ id: `eq.${unsubId}`, select: 'status' }),
    );
    expect(after.rows).toEqual([{ status: 'unsubscribed' }]);
    const imported = await pgGet<{ status: string; source: string; basis_kind: string }>(
      'audience_subscription',
      adminJwt,
      new URLSearchParams({ audience_id: `eq.${listId}`, address: `eq.${SIM('i1')}`, select: 'status,source,basis_kind' }),
    );
    expect(imported.rows).toEqual([{ status: 'confirmed', source: 'import', basis_kind: 'consent' }]);
  });

  test('3 · token, IP, agente y página no se leen por PostgREST; la prueba completa, solo el admin', async () => {
    const res = await pgRpc<{ subscription_id: string }[]>('add_audience_subscription', adminJwt, {
      p_audience_id: listId,
      p_address: SIM('c3'),
    });
    expect(res.status, res.error).toBe(200);
    addresses.push(SIM('c3'));
    const subId = res.data![0].subscription_id;

    for (const select of ['confirm_token_hash', 'confirm_expires_at', 'confirm_sent_count', '*']) {
      const r = await pgGet('audience_subscription', adminJwt, new URLSearchParams({ id: `eq.${subId}`, select }));
      expect(r.status, select).toBeGreaterThanOrEqual(400);
    }
    const ok = await pgGet('audience_subscription', adminJwt, new URLSearchParams({ id: `eq.${subId}`, select: 'id,address,status' }));
    expect(ok.rows.length).toBe(1);
    for (const select of ['ip', 'user_agent', 'page_url', '*']) {
      const r = await pgGet('audience_consent_event', adminJwt, new URLSearchParams({ subscription_id: `eq.${subId}`, select }));
      expect(r.status, select).toBeGreaterThanOrEqual(400);
    }
    const events = await pgGet<{ kind: string; channel: string }>(
      'audience_consent_event',
      adminJwt,
      new URLSearchParams({ subscription_id: `eq.${subId}`, select: 'kind,channel' }),
    );
    expect(events.rows).toEqual([{ kind: 'requested', channel: 'admin' }]);

    const proof = await pgRpc<{ events: { kind: string }[]; subscription: { address: string } }>(
      'audience_consent_proof',
      adminJwt,
      { p_subscription_id: subId },
    );
    expect(proof.status, proof.error).toBe(200);
    expect(proof.data!.subscription.address).toBe(SIM('c3'));
    await setFacets(adminJwt, limitedWsMembership, { audience: 'edit' });
    try {
      expect((await pgRpc('audience_consent_proof', limitedJwt, { p_subscription_id: subId })).status).toBe(403);
      expect((await pgRpc('erase_audience_subscription', limitedJwt, { p_id: subId })).status).toBe(403);
    } finally {
      await setFacets(adminJwt, limitedWsMembership, { audience: null });
    }
    // El admin borra sus datos, con su prueba.
    expect((await pgRpc('erase_audience_subscription', adminJwt, { p_id: subId })).status).toBeLessThan(300);
    expect((await pgGet('audience_consent_event', adminJwt, new URLSearchParams({ subscription_id: `eq.${subId}`, select: 'id' }))).rows.length).toBe(0);
  });

  test('14 · sin edit:conversation una conversación no entra; una privada ajena tampoco; solo profesionales no pide la faceta', async () => {
    // La limitada ve las conversaciones del proyecto, no las edita, y no lleva el público.
    expect((await invitation({ convs: [conv.pa], jwt: limitedJwt })).status).toBe(403);
    await setFacets(adminJwt, limitedSnapshot!.membershipId, { converses: 'edit' });
    try {
      const own = await invitation({ convs: [conv.pa], jwt: limitedJwt });
      expect(own.status, own.error).toBe(200);
      expect(own.row).toMatchObject({ kind: 'invitation', audience_id: null, mail_domain_id: outDomain });
      const priv = await pgRpc('set_mailout_recipients', limitedJwt, { p_id: own.row!.id, p_conversation_ids: [conv.pa, conv.private] });
      expect(priv.status).toBe(403);
      const foreign = await pgRpc('set_mailout_recipients', limitedJwt, { p_id: own.row!.id, p_conversation_ids: [conv.foreign] });
      expect(foreign.status).toBe(403);
      expect((await recipients(own.row!.id, limitedJwt)).rows.map((r) => r.conversation_id)).toEqual([conv.pa]);
      // La lista sí pide la faceta.
      expect((await invitation({ audience: listId, jwt: limitedJwt })).status).toBe(403);
      expect((await pgRpc('set_invitation_audience', limitedJwt, { p_mailout_id: own.row!.id, p_audience_id: listId })).status).toBe(403);
    } finally {
      await setFacets(adminJwt, limitedSnapshot!.membershipId, { converses: 'view' });
    }
    // El admin sí elige una conversación de otro proyecto en una invitación (no en un envío).
    const mixed = await invitation({ convs: [conv.pa, conv.foreign] });
    expect(mixed.status, mixed.error).toBe(200);
    expect((await recipients(mixed.row!.id)).rows.length).toBe(2);
  });

  test('10 · nadie escribe las tablas nuevas por la API, ni el owner', async () => {
    const text = await pgGet<{ id: string }>('audience_consent_text', adminJwt, new URLSearchParams({ audience_id: `eq.${listId}`, select: 'id', limit: '1' }));
    const sub = await pgGet<{ id: string }>('audience_subscription', adminJwt, new URLSearchParams({ audience_id: `eq.${listId}`, select: 'id', limit: '1' }));
    const tables: [string, Record<string, unknown>, URLSearchParams][] = [
      ['audience', { workspace_id: workspaceId, name: `directa ${RUN}` }, new URLSearchParams({ id: `eq.${listId}` })],
      ['audience_consent_text', { workspace_id: workspaceId, audience_id: listId, version: 9, language: 'es', consent_text: 'Texto directo, sin RPC.' }, new URLSearchParams({ id: `eq.${text.rows[0].id}` })],
      ['audience_import', { workspace_id: workspaceId, audience_id: listId, basis_kind: 'consent', source_note: 'directa directa', statement_text: 'x', statement_language: 'es' }, new URLSearchParams({ audience_id: `eq.${listId}` })],
      ['audience_subscription', { workspace_id: workspaceId, audience_id: listId, address: SIM('direct'), source: 'manual', status: 'confirmed' }, new URLSearchParams({ id: `eq.${sub.rows[0].id}` })],
      ['audience_consent_event', { workspace_id: workspaceId, subscription_id: sub.rows[0].id, kind: 'confirmed' }, new URLSearchParams({ subscription_id: `eq.${sub.rows[0].id}` })],
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
    // El admin no se sube el tope de las invitaciones ni se da la revisión.
    const ws = await pgPatch(
      'workspace',
      adminJwt,
      { invitation_daily_cap: 100000, invitation_reviewed_at: new Date().toISOString() },
      new URLSearchParams({ id: `eq.${workspaceId}` }),
    );
    expect(ws.status).toBeGreaterThanOrEqual(400);
    // Ni cambia el propósito de un dominio.
    const dom = await pgPatch('mail_domain', adminJwt, { purpose: 'audience' }, new URLSearchParams({ id: `eq.${outDomain}` }));
    expect(dom.status).toBeGreaterThanOrEqual(400);
  });

  describe.skipIf(!SERVICE_KEY)('con la clave de servicio: alta, cola, tope, registro y baja', () => {
    let invShared: Mailout;

    test('16 · queue_mailout rechaza una invitación sin origen, con lista sin dominio del público verificado o con profesionales sin dominio de difusión verificado', async () => {
      const empty = (await invitation()).row!;
      await write(empty.id);
      const noOrigin = await pgRpc('queue_mailout', adminJwt, { p_id: empty.id });
      expect(noOrigin.status).toBe(400);
      expect(noOrigin.error).toMatch(/needs a list or professionals/);

      const s = await confirmed(SIM('q16'));
      expect(s).toBeTruthy();
      const withList = (await invitation({ audience: listId })).row!;
      expect(withList.audience_mail_domain_id).toBe(audDomain);
      await write(withList.id);
      const noAud = await pgRpc('queue_mailout', adminJwt, { p_id: withList.id });
      expect(noAud.status).toBe(400);
      expect(noAud.error).toMatch(/audience sending domain is not verified/);

      const withPros = (await invitation({ convs: [conv.pa] })).row!;
      await write(withPros.id);
      const noOut = await pgRpc('queue_mailout', adminJwt, { p_id: withPros.id });
      expect(noOut.status).toBe(400);
      expect(noOut.error).toMatch(/sending domain is not verified/);

      for (const id of [outDomain, audDomain]) {
        const ok = await svc('POST', 'rpc/mail_domain_record_status', {
          p_id: id,
          p_dkim_status: 'SUCCESS',
          p_mail_from_status: 'SUCCESS',
          p_dns_records: [],
        });
        expect(ok.status, ok.error).toBe(200);
      }
      // Verificados, los dos salen.
      expect((await pgRpc('queue_mailout', adminJwt, { p_id: withList.id })).status).toBe(200);
      expect((await pgRpc('queue_mailout', adminJwt, { p_id: withPros.id })).status).toBe(200);
    });

    test('6 · audience_subscribe: la misma salida con dirección nueva, pendiente, confirmada o de baja; límites de 24 horas y 3', async () => {
      const keys = (r: { data: Subscribed[] | null }) => Object.keys(r.data![0]).sort();
      const fresh = await subscribe(SIM('n1'));
      expect(fresh.status, fresh.error).toBe(200);
      expect(one(fresh.data)!.token).toMatch(/^[0-9a-f]{64}$/);
      const subId = one(fresh.data)!.subscription_id!;

      // Pendiente, otra vez dentro de 24 horas: no sale otro correo.
      const again = await subscribe(SIM('n1'));
      expect(again.status).toBe(200);
      expect(keys(again)).toEqual(keys(fresh));
      expect(one(again.data)!.token).toBeNull();

      // Pasadas 24 horas, sí; hasta tres en total.
      const age = () =>
        svc('PATCH', `audience_subscription?id=eq.${subId}`, {
          confirm_last_sent_at: new Date(Date.now() - 25 * 3600 * 1000).toISOString(),
        });
      await age();
      expect(one((await subscribe(SIM('n1'))).data)!.token).toMatch(/^[0-9a-f]{64}$/);
      await age();
      const third = await subscribe(SIM('n1'));
      const thirdToken = one(third.data)!.token;
      expect(thirdToken).toMatch(/^[0-9a-f]{64}$/);
      await age();
      expect(one((await subscribe(SIM('n1'))).data)!.token, 'tres en total').toBeNull();
      const requested = await pgGet(
        'audience_consent_event',
        adminJwt,
        new URLSearchParams({ subscription_id: `eq.${subId}`, kind: 'eq.requested', select: 'id' }),
      );
      expect(requested.rows.length, 'una petición sin correo no deja evento').toBe(3);

      // Confirmada: misma salida, nada que mandar.
      await confirmed(SIM('n2'));
      const conf = await subscribe(SIM('n2'));
      expect(conf.status).toBe(200);
      expect(keys(conf)).toEqual(keys(fresh));
      expect(one(conf.data)).toMatchObject({ token: null, subscription_id: null });

      // De baja: vuelve a pedirse con un correo nuevo y sigue de baja hasta confirmar.
      const gone = await confirmed(SIM('n3'));
      expect((await pgRpc('unsubscribe_audience_subscription', adminJwt, { p_id: gone })).status).toBeLessThan(300);
      // Su confirmación salió hace un momento: dentro de 24 horas no sale otra.
      expect(one((await subscribe(SIM('n3'))).data)!.token).toBeNull();
      await svc('PATCH', `audience_subscription?id=eq.${gone}`, {
        confirm_last_sent_at: new Date(Date.now() - 25 * 3600 * 1000).toISOString(),
      });
      const back = await subscribe(SIM('n3'));
      expect(keys(back)).toEqual(keys(fresh));
      expect(one(back.data)!.token).toMatch(/^[0-9a-f]{64}$/);
      const still = await pgGet<{ status: string }>('audience_subscription', adminJwt, new URLSearchParams({ id: `eq.${gone}`, select: 'status' }));
      expect(still.rows).toEqual([{ status: 'unsubscribed' }]);

      // Lista cerrada o clave desconocida: misma salida, nada.
      const closed = await subscribe(SIM('n4'), 'f'.repeat(32));
      expect(closed.status).toBe(200);
      expect(keys(closed)).toEqual(keys(fresh));
      expect(one(closed.data)).toMatchObject({ token: null, subscription_id: null });

      // Confirmar es idempotente; un token falso o viejo, no.
      const confirm = (token: string | null) => svc<boolean>('POST', 'rpc/audience_confirm', { p_token: token });
      expect((await confirm(thirdToken)).data).toBe(true);
      expect((await confirm(thirdToken)).data).toBe(true);
      expect((await confirm('f'.repeat(64))).data).toBe(false);
      const confirmedEvents = await pgGet(
        'audience_consent_event',
        adminJwt,
        new URLSearchParams({ subscription_id: `eq.${subId}`, kind: 'eq.confirmed', select: 'id' }),
      );
      expect(confirmedEvents.rows.length).toBe(1);

      // Pendiente de más de 30 días: la purga la borra con sus eventos.
      const old = one((await subscribe(SIM('n5'))).data)!.subscription_id!;
      const past = new Date(Date.now() - 31 * 24 * 3600 * 1000).toISOString();
      await svc('PATCH', `audience_subscription?id=eq.${old}`, { created_at: past, confirm_last_sent_at: past });
      const purged = await svc<number>('POST', 'rpc/audience_purge_pending', {});
      expect(purged.data).toBeGreaterThanOrEqual(1);
      expect((await pgGet('audience_subscription', adminJwt, new URLSearchParams({ id: `eq.${old}`, select: 'id' }))).rows.length).toBe(0);
    });

    test('7 · queue_mailout de una invitación: solo confirmadas, sin importaciones en revisión, sin excluidas; dominio del público; el simulador manda', async () => {
      const list = await openList('Cola');
      await confirmed(SIM('s1'), list.key);
      await confirmed(SIM('s2'), list.key);
      await subscribe(SIM('sp'), list.key);
      await confirmed(SIM('ss'), list.key);
      expect((await pgRpc('suppress_mail_address', adminJwt, { p_workspace_id: workspaceId, p_address: SIM('ss') })).status).toBeLessThan(300);
      const imp = await pgRpc<{ status: string }>('import_audience', adminJwt, {
        p_audience_id: list.id,
        p_filename: 'cola.csv',
        p_rows: [{ email: SIM('ir') }],
        p_basis_kind: 'relationship',
        p_source_note: 'Compradores de la taquilla propia, 2025',
      });
      expect(imp.status, imp.error).toBe(200);
      addresses.push(SIM('ir'));
      const real = await confirmed(`real-${RUN}@example.test`, list.key);

      const m = (await invitation({ audience: list.id })).row!;
      await write(m.id);
      const blocked = await pgRpc('queue_mailout', adminJwt, { p_id: m.id });
      expect(blocked.status, 'una dirección fuera del simulador tumba la cola').toBe(403);
      expect((await recipients(m.id)).rows.length, 'nada quedó congelado').toBe(0);

      expect((await pgRpc('unsubscribe_audience_subscription', adminJwt, { p_id: real })).status).toBeLessThan(300);
      const res = await pgRpc<Mailout>('queue_mailout', adminJwt, { p_id: m.id });
      expect(res.status, res.error).toBe(200);
      expect(one(res.data)).toMatchObject({
        status: 'queued',
        from_address: `hola@publico.inv-${RUN}.example.test`,
      });

      const rows = (await recipients(m.id)).rows;
      const by = (a: string) => rows.find((r) => r.address === a);
      for (const a of [SIM('s1'), SIM('s2')]) {
        expect(by(a)).toMatchObject({
          status: 'queued',
          address_kind: 'subscriber',
          basis_kind: 'consent',
          conversation_id: null,
          mail_domain_id: audDomain,
        });
        expect(by(a)!.consent_event_id).toBeTruthy();
      }
      expect(by(SIM('ss'))).toMatchObject({ status: 'skipped', skip_reason: 'suppressed' });
      expect(by(SIM('sp')), 'pendiente').toBeUndefined();
      expect(by(`real-${RUN}@example.test`), 'de baja').toBeUndefined();
      if (one(imp.data)!.status === 'review') {
        expect(by(SIM('ir')), 'importación en revisión').toBeUndefined();
      } else {
        expect(by(SIM('ir'))).toMatchObject({ status: 'queued', basis_kind: 'relationship' });
      }
    });

    test('12 y 13 · profesionales: sin base no_basis, con base la suya y la identidad de la difusión; una dirección en los dos orígenes, una fila, la de la conversación', async () => {
      await confirmed(SIM('shared'));
      await confirmed(SIM('m1'));
      const m = (await invitation({ audience: listId, convs: [conv.pa, conv.pb, conv.shared] })).row!;
      await write(m.id);
      const res = await pgRpc<Mailout>('queue_mailout', adminJwt, { p_id: m.id });
      expect(res.status, res.error).toBe(200);
      invShared = one(res.data)!;
      expect(invShared.from_address).toBe(`difusion@inv-${RUN}.example.test`);

      const rows = (await recipients(m.id)).rows;
      expect(rows.find((r) => r.conversation_id === conv.pa)).toMatchObject({
        status: 'queued', basis_kind: 'relationship', mail_domain_id: outDomain, address_kind: 'contact',
      });
      expect(rows.find((r) => r.conversation_id === conv.pb)).toMatchObject({ status: 'skipped', skip_reason: 'no_basis' });
      const shared = rows.filter((r) => r.address === SIM('shared'));
      expect(shared.length, 'una sola fila por dirección').toBe(1);
      expect(shared[0]).toMatchObject({
        conversation_id: conv.shared, audience_subscription_id: null, basis_kind: 'consent', mail_domain_id: outDomain,
      });
      expect(rows.find((r) => r.address === SIM('m1'))).toMatchObject({
        status: 'queued', address_kind: 'subscriber', mail_domain_id: audDomain,
      });

      // La vista previa enseña cada fila con su identidad; la limitada, sin la faceta, solo las de conversación.
      const preview = await pgRpc<{ audience_subscription_id: string | null; mail_domain_id: string }[]>(
        'mailout_preview',
        adminJwt,
        { p_id: m.id },
      );
      expect(preview.status, preview.error).toBe(200);
      expect(preview.data!.length).toBe(rows.length);
      const limitedRows = await recipients(m.id, limitedJwt);
      expect(limitedRows.rows.every((r) => r.conversation_id !== null)).toBe(true);
      expect(limitedRows.rows.length).toBeGreaterThan(0);
    });

    test('15 y 8 · tope por identidad; el profesional deja conversation_event, el público no', async () => {
      expect(invShared, 'depende del test 12').toBeTruthy();
      const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
      const used = async (audience: boolean) =>
        (
          await svc<{ id: string }[]>(
            'GET',
            `mailout_recipient?workspace_id=eq.${workspaceId}&audience_subscription_id=${audience ? 'not.is.null' : 'is.null'}&or=(status.eq.sending,sent_at.gt.${since})&select=id`,
          )
        ).data!.length;
      const caps = await svc<{ mailout_daily_cap: number; invitation_daily_cap: number }[]>(
        'GET',
        `workspace?id=eq.${workspaceId}&select=mailout_daily_cap,invitation_daily_cap`,
      );
      const before = caps.data![0];
      await svc('PATCH', `workspace?id=eq.${workspaceId}`, {
        mailout_daily_cap: (await used(false)) + 1,
        invitation_daily_cap: (await used(true)) + 1,
      });
      try {
        const first = await svc<{ recipient_id: string; conversation_id: string | null; audience_subscription_id: string | null; from_address: string; tenant_name: string }[]>(
          'POST',
          'rpc/mailout_claim',
          { p_limit: 10, p_mailout_id: invShared.id },
        );
        expect(first.status, first.error).toBe(200);
        expect(first.data!.length, 'uno de cada identidad').toBe(2);
        const pro = first.data!.find((r) => r.conversation_id !== null)!;
        const sub = first.data!.find((r) => r.audience_subscription_id !== null)!;
        expect(pro).toMatchObject({ from_address: `difusion@inv-${RUN}.example.test`, tenant_name: `hour-${workspaceId}` });
        expect(sub).toMatchObject({ from_address: `hola@publico.inv-${RUN}.example.test`, tenant_name: `hour-aud-${workspaceId}` });
        const second = await svc<unknown[]>('POST', 'rpc/mailout_claim', { p_limit: 10, p_mailout_id: invShared.id });
        expect(second.data!.length, 'los dos topes llenos').toBe(0);

        const sent = async (id: string) =>
          svc<{ status: string; conversation_event_id: string | null }>('POST', 'rpc/mailout_record_sent', {
            p_recipient_id: id,
            p_provider_message_id: `sim-${id}`,
            p_rfc_message_id: `<sim-${id}@simulator.hour>`,
            p_body: 'Hola. Os esperamos.',
            p_subject: `Estreno de MaMeMi ${RUN}`,
          });
        const proSent = await sent(pro.recipient_id);
        expect(proSent.status, proSent.error).toBe(200);
        expect(one(proSent.data)!.conversation_event_id).toBeTruthy();
        const event = await pgGet<{ conversation_id: string; kind: string; direction: string; metadata: { mailout_kind: string } }>(
          'conversation_event',
          adminJwt,
          new URLSearchParams({ id: `eq.${one(proSent.data)!.conversation_event_id}`, select: 'conversation_id,kind,direction,metadata' }),
        );
        expect(event.rows[0]).toMatchObject({
          conversation_id: pro.conversation_id, kind: 'email', direction: 'outbound', metadata: { mailout_kind: 'invitation' },
        });
        const subSent = await sent(sub.recipient_id);
        expect(subSent.status, subSent.error).toBe(200);
        expect(one(subSent.data)).toMatchObject({ status: 'sent', conversation_event_id: null });
        // Idempotente: la segunda vez, igual.
        expect(one((await sent(sub.recipient_id)).data)).toMatchObject({ status: 'sent', conversation_event_id: null });
      } finally {
        await svc('PATCH', `workspace?id=eq.${workspaceId}`, before);
      }
    });

    test('9 · baja del público: su lista, no el espacio; «nada más»: el espacio; queja y rebote: el espacio; un profesional, como el envío', async () => {
      expect(invShared, 'depende del test 12').toBeTruthy();
      const token = async (address: string) =>
        (
          await svc<{ unsubscribe_token: string; id: string; audience_subscription_id: string | null }[]>(
            'GET',
            `mailout_recipient?mailout_id=eq.${invShared.id}&address=eq.${encodeURIComponent(address)}&select=id,unsubscribe_token,audience_subscription_id`,
          )
        ).data![0];
      const suppression = async (address: string) =>
        (await pgGet<{ reason: string }>('mail_suppression', adminJwt, new URLSearchParams({ address: `eq.${address}`, select: 'reason' }))).rows;

      const m1 = await token(SIM('m1'));
      for (let i = 0; i < 2; i += 1) {
        expect((await pgRpc('mailout_unsubscribe', null, { p_token: m1.unsubscribe_token })).status).toBeLessThan(300);
      }
      const sub = await pgGet<{ status: string }>('audience_subscription', adminJwt, new URLSearchParams({ id: `eq.${m1.audience_subscription_id}`, select: 'status' }));
      expect(sub.rows).toEqual([{ status: 'unsubscribed' }]);
      expect(await suppression(SIM('m1'))).toEqual([]);
      const unsubEvents = await pgGet('audience_consent_event', adminJwt, new URLSearchParams({ subscription_id: `eq.${m1.audience_subscription_id}`, kind: 'eq.unsubscribed', select: 'id' }));
      expect(unsubEvents.rows.length, 'dos veces, un evento').toBe(1);
      const info = await pgRpc<{ unsubscribed: boolean; suppressed: boolean; audience_name: string }[]>('mailout_unsubscribe_info', null, { p_token: m1.unsubscribe_token });
      expect(info.data![0]).toMatchObject({ unsubscribed: true, suppressed: false, audience_name: `Estrenos ${RUN}` });

      expect((await pgRpc('mailout_unsubscribe_everything', null, { p_token: m1.unsubscribe_token })).status).toBeLessThan(300);
      expect(await suppression(SIM('m1'))).toEqual([{ reason: 'unsubscribe' }]);

      // «¿Ha sido un error?»: vuelve a la lista y levanta su propia exclusión.
      expect((await pgRpc('mailout_resubscribe', null, { p_token: m1.unsubscribe_token })).status).toBeLessThan(300);
      const backSub = await pgGet<{ status: string }>('audience_subscription', adminJwt, new URLSearchParams({ id: `eq.${m1.audience_subscription_id}`, select: 'status' }));
      expect(backSub.rows).toEqual([{ status: 'confirmed' }]);
      expect(await suppression(SIM('m1'))).toEqual([]);

      // Queja de una persona del público: exclusión del espacio y fuera de la lista.
      const complaint = await svc<boolean>('POST', 'rpc/mailout_record_event', {
        p_payload: { provider_event_id: `complaint-${RUN}`, recipient_id: m1.id, type: 'complaint' },
      });
      expect(complaint.data, complaint.error).toBe(true);
      expect(await suppression(SIM('m1'))).toEqual([{ reason: 'complaint' }]);
      const complained = await pgGet<{ status: string }>('audience_subscription', adminJwt, new URLSearchParams({ id: `eq.${m1.audience_subscription_id}`, select: 'status' }));
      expect(complained.rows).toEqual([{ status: 'unsubscribed' }]);

      // Rebote permanente del correo de confirmación de un alta: exclusión del espacio.
      const bounceSub = one((await subscribe(SIM('bounce'))).data)!.subscription_id!;
      await svc('POST', 'rpc/audience_confirmation_sent', { p_subscription_id: bounceSub, p_provider_message_id: `conf-${RUN}` });
      const bounce = await svc<boolean>('POST', 'rpc/mailout_record_event', {
        p_payload: { provider_event_id: `bounce-${RUN}`, provider_message_id: `conf-${RUN}`, type: 'bounce', bounce_type: 'Permanent' },
      });
      expect(bounce.data, bounce.error).toBe(true);
      expect(await suppression(SIM('bounce'))).toEqual([{ reason: 'bounce' }]);

      // Un profesional de la invitación: exclusión, base retirada y nota, como el envío.
      const pa = await token(SIM('pa'));
      expect((await pgRpc('mailout_unsubscribe', null, { p_token: pa.unsubscribe_token })).status).toBeLessThan(300);
      expect(await suppression(SIM('pa'))).toEqual([{ reason: 'unsubscribe' }]);
      const b = await pgGet<{ withdrawn_at: string | null }>('mail_basis', adminJwt, new URLSearchParams({ address: `eq.${SIM('pa')}`, select: 'withdrawn_at' }));
      expect(b.rows[0].withdrawn_at).not.toBeNull();
      const notes = await pgGet(
        'conversation_event',
        adminJwt,
        new URLSearchParams({ conversation_id: `eq.${conv.pa}`, 'metadata->>mailout': 'eq.unsubscribed', select: 'id' }),
      );
      expect(notes.rows.length).toBe(1);
    });
  });

  describe.skipIf(!externalEnvReady())('1 · un login de otro espacio', () => {
    let externalJwt: string;
    let target: string;
    let subId: string;

    beforeAll(async () => {
      const ext = requireExternalEnv();
      externalJwt = await login(ext.email, ext.password);
      target = (await invitation({ audience: listId })).row!.id;
      const sub = await pgRpc<{ subscription_id: string }[]>('add_audience_subscription', adminJwt, {
        p_audience_id: listId,
        p_address: SIM('ext'),
      });
      addresses.push(SIM('ext'));
      subId = sub.data![0].subscription_id;
    });

    test('no lee listas, textos, suscripciones, eventos, importaciones ni invitaciones; sus RPC dan 42501', async () => {
      for (const table of ['audience', 'audience_consent_text', 'audience_import', 'audience_subscription', 'audience_consent_event', 'mailout', 'mailout_recipient']) {
        const res = await pgGet(table, externalJwt, new URLSearchParams({ workspace_id: `eq.${workspaceId}`, select: 'workspace_id' }));
        expect(res.rows.length, table).toBe(0);
      }
      const calls: [string, Record<string, unknown>][] = [
        ['create_audience', { p_workspace_id: workspaceId, p_name: 'ajena' }],
        ['update_audience', { p_id: listId, p_name: 'ajena', p_description: null, p_languages: ['es'], p_default_language: 'es' }],
        ['set_audience_consent_text', { p_audience_id: listId, p_texts: { es: { consent_text: 'Texto ajeno de prueba.' } } }],
        ['set_audience_status', { p_id: listId, p_status: 'closed' }],
        ['regenerate_audience_form_key', { p_id: listId }],
        ['add_audience_subscription', { p_audience_id: listId, p_address: SIM('ajena') }],
        ['import_audience', { p_audience_id: listId, p_filename: 'x.csv', p_rows: [{ email: SIM('ajena') }], p_basis_kind: 'consent', p_source_note: 'Una fuente ajena cualquiera' }],
        ['unsubscribe_audience_subscription', { p_id: subId }],
        ['erase_audience_subscription', { p_id: subId }],
        ['audience_consent_proof', { p_subscription_id: subId }],
        ['create_invitation', { p_workspace_id: workspaceId, p_audience_id: listId }],
        ['set_invitation_audience', { p_mailout_id: target, p_audience_id: null }],
        ['set_mailout_recipients', { p_id: target, p_conversation_ids: [conv.pa] }],
        ['mailout_preview', { p_id: target }],
        ['mailout_compose_preview', { p_id: target }],
        ['queue_mailout', { p_id: target }],
        ['cancel_mailout', { p_id: target }],
      ];
      for (const [fn, args] of calls) {
        expect((await pgRpc(fn, externalJwt, args)).status, fn).toBe(403);
      }
    });
  });
});
