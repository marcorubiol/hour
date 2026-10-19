/**
 * RLS regression: «no esta vez» saca la conversación de los envíos mientras
 * dura (ADR-138 § 3; migraciones 20261020140000_mailout_not_now_reason y
 * 20261020140100_mailout_not_now).
 *
 * Elegirla a mano en la lista no basta para escribirle: la vista previa la
 * marca `not_now` y no lista, `queue_mailout` la deja `skipped (not_now)` y
 * `mailout_claim` vuelve a mirarlo, así que marcarla después de poner el
 * envío en cola también la saca. Un «no esta vez» cuya fecha ya llegó no
 * cuenta.
 *
 * Todo en el espacio `playwright`, proyecto `zzz-e2e-collab`, con filas
 * propias (sufijo por ejecución) y direcciones del simulador de SES. Lo que
 * necesita la clave de servicio (verificar el dominio, la cola) se salta sin
 * ella.
 */

import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { envReady, login, pgGet, pgPatch, pgRpc, requireEnv } from './_helpers';

const RUN = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const SIM = (label: string) => `success+${RUN}-nn-${label}@simulator.amazonses.com`;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const one = <T>(data: T | T[] | null): T | undefined => (Array.isArray(data) ? data[0] : (data ?? undefined));

interface Preview {
  conversation_id: string;
  status: string;
  skip_reason: string | null;
  ready: boolean;
}

async function svc<T = unknown>(
  method: 'GET' | 'POST' | 'DELETE',
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

describe.skipIf(!envReady())('RLS: «no esta vez» fuera de los envíos (ADR-138 § 3)', () => {
  let adminJwt: string;
  let workspaceId: string;
  let projectId: string;
  let domainId: string | undefined;
  const conv: Record<string, string> = {};
  const mailouts: string[] = [];
  const LABELS = ['hold', 'expired', 'free'] as const;

  const yesterday = () => new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);

  async function notNow(label: string, until: string | null) {
    const res = await pgPatch(
      'conversation',
      adminJwt,
      { not_now_at: new Date(Date.now() - 2 * 86_400_000).toISOString(), not_now_until: until },
      new URLSearchParams({ id: `eq.${conv[label]}` }),
    );
    expect(res.status).toBeLessThan(300);
    expect(res.rows.length, `«no esta vez» en ${label}`).toBe(1);
  }

  async function draft(): Promise<string> {
    const res = await pgRpc<{ id: string }>('create_mailout', adminJwt, {
      p_project_id: projectId,
      p_mail_domain_id: domainId ?? null,
    });
    expect(res.status, res.error).toBe(200);
    const id = one(res.data)!.id;
    mailouts.push(id);
    const w = await pgRpc('update_mailout', adminJwt, {
      p_id: id,
      p_subject: `No esta vez ${RUN}`,
      p_body: 'Hola, {nombre}.',
      p_language: 'es',
      p_mail_domain_id: domainId ?? null,
    });
    expect(w.status, w.error).toBe(200);
    const r = await pgRpc('set_mailout_recipients', adminJwt, {
      p_id: id,
      p_conversation_ids: LABELS.map((l) => conv[l]),
    });
    expect(r.status, r.error).toBe(200);
    return id;
  }

  async function rows(id: string) {
    const res = await pgGet<{ conversation_id: string; status: string; skip_reason: string | null }>(
      'mailout_recipient',
      adminJwt,
      new URLSearchParams({ mailout_id: `eq.${id}`, select: 'conversation_id,status,skip_reason' }),
    );
    return (label: string) => res.rows.find((x) => x.conversation_id === conv[label]);
  }

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

    for (const label of LABELS) {
      const res = await pgRpc<{ id: string }>('create_conversation', adminJwt, {
        p_project_id: projectId,
        p_full_name: `RLS No esta vez ${label} ${RUN}`,
        p_email: SIM(label),
        p_organization_name: `RLS Sala no esta vez ${label} ${RUN}`,
      });
      expect(res.status, res.error).toBe(200);
      conv[label] = one(res.data)!.id;
      await pgPatch('conversation', adminJwt, { private_to: null }, new URLSearchParams({ id: `eq.${conv[label]}` }));
      const b = await pgRpc('set_mail_basis', adminJwt, {
        p_workspace_id: workspaceId,
        p_address: SIM(label),
        p_kind: 'relationship',
      });
      expect(b.status, b.error).toBe(200);
    }
    await notNow('hold', null);
    await notNow('expired', yesterday());

    if (SERVICE_KEY) {
      const dom = await pgRpc<{ id: string }>('add_mail_domain', adminJwt, {
        p_workspace_id: workspaceId,
        p_domain: `no-esta-vez-${RUN}.example.test`,
      });
      expect(dom.status, dom.error).toBe(200);
      domainId = one(dom.data)!.id;
      const ok = await svc('POST', 'rpc/mail_domain_record_status', {
        p_id: domainId,
        p_dkim_status: 'SUCCESS',
        p_mail_from_status: 'SUCCESS',
        p_dns_records: [],
      });
      expect(ok.status, ok.error).toBe(200);
    }
  });

  afterAll(async () => {
    for (const id of mailouts) await pgRpc('cancel_mailout', adminJwt, { p_id: id });
    if (domainId) await pgRpc('remove_mail_domain', adminJwt, { p_id: domainId });
    for (const id of Object.values(conv)) await pgRpc('delete_conversation', adminJwt, { p_conversation_id: id });
    if (SERVICE_KEY) {
      const list = `in.(${LABELS.map((l) => `"${SIM(l)}"`).join(',')})`;
      await svc('DELETE', `mail_basis?workspace_id=eq.${workspaceId}&address=${encodeURIComponent(list)}`);
    }
  });

  test('la vista previa de un borrador marca la vigente `not_now` y no lista; la caducada sí sale', async () => {
    const id = await draft();
    const res = await pgRpc<Preview[]>('mailout_preview', adminJwt, { p_id: id });
    expect(res.status, res.error).toBe(200);
    const by = (label: string) => (res.data as Preview[]).find((x) => x.conversation_id === conv[label]);
    expect(by('hold')).toMatchObject({ status: 'pending', skip_reason: 'not_now', ready: false });
    expect(by('expired')).toMatchObject({ status: 'pending', skip_reason: null, ready: true });
    expect(by('free')).toMatchObject({ status: 'pending', skip_reason: null, ready: true });
  });

  describe.skipIf(!SERVICE_KEY)('con la clave de servicio: la cola', () => {
    test('queue_mailout deja fuera la vigente; marcarla después también la saca de la cola', async () => {
      const id = await draft();
      const q = await pgRpc<{ status: string }>('queue_mailout', adminJwt, { p_id: id });
      expect(q.status, q.error).toBe(200);
      expect(one(q.data)?.status).toBe('queued');

      let by = await rows(id);
      expect(by('hold')).toMatchObject({ status: 'skipped', skip_reason: 'not_now' });
      expect(by('expired')).toMatchObject({ status: 'queued', skip_reason: null });
      expect(by('free')).toMatchObject({ status: 'queued', skip_reason: null });

      // Ya en cola: «no esta vez» en las dos que quedan. La toma no se lleva
      // ninguna y las deja fuera con su motivo.
      await notNow('expired', '2099-01-01');
      await notNow('free', null);
      const claim = await svc<unknown[]>('POST', 'rpc/mailout_claim', { p_limit: 10, p_mailout_id: id });
      expect(claim.status, claim.error).toBe(200);
      expect(claim.data).toEqual([]);
      by = await rows(id);
      expect(by('expired')).toMatchObject({ status: 'skipped', skip_reason: 'not_now' });
      expect(by('free')).toMatchObject({ status: 'skipped', skip_reason: 'not_now' });
    });
  });
});
