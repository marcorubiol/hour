/**
 * RLS regression: envío en bloque, fase 3 (ADR-115; migración
 * 20261016100000_mailout_send).
 *
 *   · `mailout_compose_preview`: lo lee quien lee el envío, con lo que monta
 *     cada correo; los destinatarios de una conversación privada ajena no
 *     salen; sin leer el envío, 42501.
 *   · `mailout_send_context`: solo service_role (ni persona ni anon).
 *   · `mailout_unsubscribe_info`: por token, sin sesión; un token falso no
 *     devuelve nada; dice si la dirección ya está de baja.
 *   · Y el recorrido de la cola con la clave de servicio: poner en cola,
 *     tomar, montar, registrar el envío, y el correo en el registro de su
 *     conversación con el enlace al envío.
 *
 * En el espacio `playwright` (nunca `muk-cia`), proyecto `zzz-e2e-collab`,
 * todas las direcciones del simulador. Cada ejecución es dueña de sus filas y
 * las limpia; el acceso de la fixture limitada se restaura como estaba.
 */

import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import {
  decodeJwt,
  envReady,
  limitedEnvReady,
  login,
  pgGet,
  pgPatch,
  pgRpc,
  projectAccess,
  requireEnv,
  requireLimitedEnv,
  restoreProjectAccess,
  setFacets,
  type ProjectAccess,
} from './_helpers';

const RUN = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const SIM = (label: string) => `success+${RUN}-${label}@simulator.amazonses.com`;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const one = <T>(data: T | T[] | null): T | undefined => (Array.isArray(data) ? data[0] : (data ?? undefined));

interface ComposeRow {
  recipient_id: string;
  address_kind: string | null;
  basis_kind: string | null;
  contact_first_name: string | null;
  organization_name: string | null;
  company_name: string;
}

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

describe.skipIf(!envReady() || !limitedEnvReady())('RLS: envío en bloque, fase 3 (ADR-115)', () => {
  let adminJwt: string;
  let limitedJwt: string;
  let limitedUserId: string;
  let limitedSnapshot: ProjectAccess | undefined;
  let workspaceId: string;
  let projectId: string;
  let mailoutId: string;
  let domainId: string;
  const conv: Record<string, string> = {};
  const addresses = [SIM('a'), SIM('private')];

  async function conversation(label: string, email: string, shared = true): Promise<string> {
    const res = await pgRpc<{ id: string }>('create_conversation', adminJwt, {
      p_project_id: projectId,
      p_full_name: `Laia ${label} ${RUN}`,
      p_email: email,
      p_organization_name: `RLS Sala ${label} ${RUN}`,
    });
    expect(res.status, res.error).toBe(200);
    const id = one(res.data)!.id;
    await pgPatch('conversation', adminJwt, { private_to: shared ? null : String(decodeJwt(adminJwt).sub) }, new URLSearchParams({ id: `eq.${id}` }));
    conv[label] = id;
    return id;
  }

  beforeAll(async () => {
    const admin = requireEnv();
    adminJwt = await login(admin.email, admin.password);
    const limited = requireLimitedEnv();
    limitedJwt = await login(limited.email, limited.password);
    limitedUserId = String(decodeJwt(limitedJwt).sub);

    const projects = await pgGet<{ id: string; workspace_id: string }>(
      'project',
      adminJwt,
      new URLSearchParams({ slug: 'eq.zzz-e2e-collab', select: 'id,workspace_id' }),
    );
    projectId = projects.rows[0].id;
    workspaceId = projects.rows[0].workspace_id;
    limitedSnapshot = await projectAccess(adminJwt, projectId, limitedUserId);
    await setFacets(adminJwt, limitedSnapshot.membershipId, { converses: 'view' });

    await conversation('a', SIM('a'));
    await conversation('private', SIM('private'), false);

    const dom = await pgRpc<{ id: string }>('add_mail_domain', adminJwt, {
      p_workspace_id: workspaceId,
      p_domain: `envios-send-${RUN}.example.test`,
    });
    expect(dom.status, dom.error).toBe(200);
    domainId = one(dom.data)!.id;

    const m = await pgRpc<{ id: string }>('create_mailout', adminJwt, { p_project_id: projectId, p_mail_domain_id: domainId });
    expect(m.status, m.error).toBe(200);
    mailoutId = one(m.data)!.id;
    const upd = await pgRpc('update_mailout', adminJwt, {
      p_id: mailoutId,
      p_subject: `Propuesta para {sala} ${RUN}`,
      p_body: 'Hola, {nombre}.',
      p_language: 'ca',
      p_mail_domain_id: domainId,
    });
    expect(upd.status, upd.error).toBe(200);
    const set = await pgRpc('set_mailout_recipients', adminJwt, { p_id: mailoutId, p_conversation_ids: [conv.a, conv.private] });
    expect(set.status, set.error).toBe(200);
    for (const address of addresses) {
      const b = await pgRpc('set_mail_basis', adminJwt, { p_workspace_id: workspaceId, p_address: address, p_kind: 'relationship' });
      expect(b.status, b.error).toBe(200);
    }
  });

  afterAll(async () => {
    if (mailoutId) await pgRpc('cancel_mailout', adminJwt, { p_id: mailoutId });
    if (SERVICE_KEY && mailoutId) await svc('DELETE', `mailout?id=eq.${mailoutId}`);
    if (domainId) await pgRpc('remove_mail_domain', adminJwt, { p_id: domainId });
    for (const id of Object.values(conv)) await pgRpc('delete_conversation', adminJwt, { p_conversation_id: id });
    if (SERVICE_KEY) {
      const list = encodeURIComponent(`in.(${addresses.map((a) => `"${a}"`).join(',')})`);
      await svc('DELETE', `mail_suppression?workspace_id=eq.${workspaceId}&address=${list}`);
      await svc('DELETE', `mail_basis?workspace_id=eq.${workspaceId}&address=${list}`);
    }
    if (limitedSnapshot) await restoreProjectAccess(adminJwt, projectId, limitedUserId, limitedSnapshot);
  });

  test('compose_preview: quien edita ve los campos de cada destinatario, la privada suya incluida', async () => {
    const res = await pgRpc<ComposeRow[]>('mailout_compose_preview', adminJwt, { p_id: mailoutId });
    expect(res.status, res.error).toBe(200);
    expect(res.data!.length).toBe(2);
    const a = res.data!.find((r) => r.organization_name === `RLS Sala a ${RUN}`);
    expect(a).toMatchObject({ address_kind: 'contact', basis_kind: 'relationship', contact_first_name: 'Laia' });
    expect(a!.company_name.length).toBeGreaterThan(0);
  });

  test('compose_preview: otro miembro que lee no ve el destinatario de una privada ajena; sin leer, 42501', async () => {
    const res = await pgRpc<ComposeRow[]>('mailout_compose_preview', limitedJwt, { p_id: mailoutId });
    expect(res.status, res.error).toBe(200);
    expect(res.data!.map((r) => r.organization_name)).toEqual([`RLS Sala a ${RUN}`]);
    await setFacets(adminJwt, limitedSnapshot!.membershipId, { converses: null });
    try {
      expect((await pgRpc('mailout_compose_preview', limitedJwt, { p_id: mailoutId })).status).toBe(403);
    } finally {
      await setFacets(adminJwt, limitedSnapshot!.membershipId, { converses: 'view' });
    }
    expect((await pgRpc('mailout_compose_preview', null, { p_id: mailoutId })).status).toBeGreaterThanOrEqual(400);
  });

  test('send_context: ni una persona ni anon', async () => {
    const preview = await pgRpc<ComposeRow[]>('mailout_compose_preview', adminJwt, { p_id: mailoutId });
    const ids = preview.data!.map((r) => r.recipient_id);
    expect((await pgRpc('mailout_send_context', adminJwt, { p_recipient_ids: ids })).status).toBeGreaterThanOrEqual(400);
    expect((await pgRpc('mailout_send_context', null, { p_recipient_ids: ids })).status).toBeGreaterThanOrEqual(400);
  });

  test('unsubscribe_info: un token falso no devuelve nada', async () => {
    const res = await pgRpc<unknown[]>('mailout_unsubscribe_info', null, { p_token: 'f'.repeat(48) });
    expect(res.status, res.error).toBe(200);
    expect(res.data).toEqual([]);
  });

  test.skipIf(!SERVICE_KEY)('la cola: tomar, montar, registrar; el correo en la conversación y la baja por token', async () => {
    const domainOk = await svc('POST', 'rpc/mail_domain_record_status', {
      p_id: domainId,
      p_dkim_status: 'SUCCESS',
      p_mail_from_status: 'SUCCESS',
    });
    expect(domainOk.status, domainOk.error).toBe(200);
    const q = await pgRpc<{ status: string }>('queue_mailout', adminJwt, { p_id: mailoutId });
    expect(q.status, q.error).toBe(200);
    expect(one(q.data)!.status).toBe('queued');

    const claimed = await svc<{ recipient_id: string; unsubscribe_token: string; language: string }[]>(
      'POST',
      'rpc/mailout_claim',
      { p_limit: 10, p_mailout_id: mailoutId },
    );
    expect(claimed.status, claimed.error).toBe(200);
    expect(claimed.data!.length).toBe(2);
    const ctx = await svc<ComposeRow[]>('POST', 'rpc/mailout_send_context', {
      p_recipient_ids: claimed.data!.map((r) => r.recipient_id),
    });
    expect(ctx.status, ctx.error).toBe(200);
    expect(ctx.data!.map((r) => r.organization_name).sort()).toEqual([`RLS Sala a ${RUN}`, `RLS Sala private ${RUN}`]);

    const first = claimed.data!.find((r) => ctx.data!.find((c) => c.recipient_id === r.recipient_id)?.organization_name === `RLS Sala a ${RUN}`)!;
    const sent = await svc('POST', 'rpc/mailout_record_sent', {
      p_recipient_id: first.recipient_id,
      p_provider_message_id: `sim-${RUN}`,
      p_rfc_message_id: `<sim-${RUN}@mailout.simulator.invalid>`,
      p_body: 'Hola, Laia.',
    });
    expect(sent.status, sent.error).toBe(200);

    // El correo, en el registro de su conversación, con el envío enlazado.
    const events = await pgGet<{ kind: string; direction: string; mailout_id: string; body: string }>(
      'conversation_event',
      adminJwt,
      new URLSearchParams({
        conversation_id: `eq.${conv.a}`,
        kind: 'eq.email',
        select: 'kind,direction,body,mailout_id:metadata->>mailout_id',
      }),
    );
    expect(events.rows).toEqual([{ kind: 'email', direction: 'outbound', body: 'Hola, Laia.', mailout_id: mailoutId }]);

    // La página de baja, por token y sin sesión.
    const info = await pgRpc<{ company_name: string; language: string; unsubscribed: boolean }[]>(
      'mailout_unsubscribe_info',
      null,
      { p_token: first.unsubscribe_token },
    );
    expect(info.status, info.error).toBe(200);
    expect(info.data![0]).toMatchObject({ language: 'ca', unsubscribed: false });
    expect((await pgRpc('mailout_unsubscribe', null, { p_token: first.unsubscribe_token })).status).toBe(204);
    const after = await pgRpc<{ unsubscribed: boolean }[]>('mailout_unsubscribe_info', null, { p_token: first.unsubscribe_token });
    expect(after.data![0].unsubscribed).toBe(true);
    expect((await pgRpc('mailout_resubscribe', null, { p_token: first.unsubscribe_token })).status).toBe(204);
    const back = await pgRpc<{ unsubscribed: boolean }[]>('mailout_unsubscribe_info', null, { p_token: first.unsubscribe_token });
    expect(back.data![0].unsubscribed).toBe(false);

    // El otro falla sin reintento: no queda nada por salir y el envío termina.
    const other = claimed.data!.find((r) => r.recipient_id !== first.recipient_id)!;
    const failed = await svc('POST', 'rpc/mailout_record_failure', { p_recipient_id: other.recipient_id, p_error: 'test' });
    expect(failed.status, failed.error).toBe(200);
    const done = await pgGet<{ status: string }>('mailout', adminJwt, new URLSearchParams({ id: `eq.${mailoutId}`, select: 'status' }));
    expect(done.rows[0].status).toBe('done');
  });
});
