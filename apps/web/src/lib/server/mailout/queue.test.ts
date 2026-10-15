import { describe, expect, test, vi } from 'vitest';
import { retryAt, runMailoutQueue, type ClaimedRecipient, type MailoutQueueDb } from './queue';
import { simulatedEvents, simulatorProvider } from './simulator';
import { MailoutSendError, type SendingProvider } from './provider';
import { serviceRpc } from './db';
import { recipientCounts, recipientState, type MailoutRecipientRow } from '$lib/mailout';
import type { ComposeContext } from '$lib/mailout-compose';

function claimed(over: Partial<ClaimedRecipient> = {}): ClaimedRecipient {
  return {
    recipient_id: 'r1',
    mailout_id: 'm1',
    workspace_id: 'w1',
    conversation_id: 'c1',
    address: 'success@simulator.amazonses.com',
    display_name: 'Laia Puig',
    address_kind: 'contact',
    basis_kind: 'relationship',
    unsubscribe_token: 'tok1',
    attempts: 1,
    provider: 'simulator',
    tenant_name: null,
    configuration_set: null,
    from_address: 'difusion@mamemi.example',
    from_name: 'MüK Cia',
    reply_to_address: 'difusion@mamemi.example',
    language: 'es',
    subject: 'MaMeMi para {sala}',
    body: 'Hola, {nombre}:',
    ...over,
  };
}

function context(id: string, over: Partial<ComposeContext> = {}): ComposeContext {
  return {
    recipient_id: id,
    address_kind: 'contact',
    basis_kind: 'relationship',
    contact_first_name: 'Laia',
    contact_name: 'Laia Puig',
    organization_name: 'Teatre de Salt',
    city: 'Salt',
    company_name: 'MüK Cia',
    company_city: null,
    company_website: null,
    company_phone: null,
    company_signature: null,
    privacy_url: null,
    ...over,
  };
}

function memoryDb(rows: ClaimedRecipient[], ctx: ComposeContext[] = rows.map((r) => context(r.recipient_id))) {
  const calls = {
    claim: [] as [number, string | undefined][],
    sent: [] as [string, string, string | null, string, string][],
    failures: [] as [string, string, string | null][],
    events: [] as Record<string, unknown>[],
  };
  const db: MailoutQueueDb = {
    claim: async (limit, mailoutId) => {
      calls.claim.push([limit, mailoutId]);
      return rows;
    },
    context: async () => ctx,
    recordSent: async (...args) => {
      calls.sent.push(args);
    },
    recordFailure: async (...args) => {
      calls.failures.push(args);
    },
    recordEvent: async (p) => {
      calls.events.push(p);
    },
  };
  return { db, calls };
}

const env = { MAILOUT_LINK_ORIGIN: 'https://hour.test' };
const NOW = new Date('2026-10-15T10:00:00Z');

describe('runMailoutQueue con el simulador', () => {
  test('monta, «envía», registra y deja el destinatario entregado', async () => {
    const { db, calls } = memoryDb([claimed()]);
    const spy = vi.spyOn(globalThis, 'fetch');
    const r = await runMailoutQueue(env, { db, now: () => NOW });
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
    expect(r).toMatchObject({ claimed: 1, sent: 1, failed: 0, retried: 0 });
    const [id, providerId, rfc, body, subject] = calls.sent[0];
    expect(subject).toBe('MaMeMi para Teatre de Salt');
    expect(id).toBe('r1');
    expect(providerId).toMatch(/^sim-/);
    expect(rfc).toMatch(/^<sim-.+@mailout\.simulator\.invalid>$/);
    expect(body).toBe('Hola, Laia:\n\n-- \nMüK Cia');
    expect(body).not.toContain('/u/');
    expect(calls.events).toEqual([
      expect.objectContaining({ recipient_id: 'r1', type: 'delivery', provider_event_id: `${providerId}:delivery` }),
    ]);
  });

  test('el enlace de baja y las cabeceras llevan el token del destinatario', async () => {
    const { db } = memoryDb([claimed()]);
    const sendEmail = vi.fn(simulatorProvider().sendEmail);
    const provider: SendingProvider = { ...simulatorProvider(), sendEmail };
    await runMailoutQueue(env, { db, providerFor: () => provider });
    const email = sendEmail.mock.calls[0][0];
    expect(email.headers['List-Unsubscribe']).toBe('<https://hour.test/u/tok1>');
    expect(email.headers['List-Unsubscribe-Post']).toBe('List-Unsubscribe=One-Click');
    expect(email.text).toContain('https://hour.test/u/tok1');
    expect(email.subject).toBe('MaMeMi para Teatre de Salt');
    expect(email.tags).toEqual({ recipient: 'r1', mailout: 'm1' });
  });

  test('la primera pasada pide solo su envío; el cron, de todos, por lotes', async () => {
    const a = memoryDb([]);
    await runMailoutQueue(env, { db: a.db, mailoutId: 'm9' });
    expect(a.calls.claim).toEqual([[10, 'm9']]);
    const b = memoryDb([]);
    await runMailoutQueue(env, { db: b.db });
    expect(b.calls.claim).toEqual([[10, undefined]]);
  });

  test('rebote y queja del simulador', async () => {
    const { db, calls } = memoryDb([
      claimed({ recipient_id: 'b', address: 'bounce@simulator.amazonses.com' }),
      claimed({ recipient_id: 'c', address: 'complaint@simulator.amazonses.com' }),
    ]);
    await runMailoutQueue(env, { db });
    expect(calls.events.map((e) => [e.recipient_id, e.type, e.bounce_type])).toEqual([
      ['b', 'bounce', 'Permanent'],
      ['c', 'delivery', null],
      ['c', 'complaint', null],
    ]);
  });
});

describe('fallos', () => {
  test('un campo sin valor: fallo permanente, no sale', async () => {
    const { db, calls } = memoryDb([claimed()], [context('r1', { organization_name: null })]);
    const r = await runMailoutQueue(env, { db });
    expect(r).toMatchObject({ sent: 0, failed: 1 });
    expect(calls.failures).toEqual([['r1', 'missing_fields:sala', null]]);
    expect(calls.sent).toEqual([]);
  });

  test('error pasajero del servicio: reintento con espera', async () => {
    const { db, calls } = memoryDb([claimed({ attempts: 2 })]);
    const provider: SendingProvider = {
      ...simulatorProvider(),
      sendEmail: async () => {
        throw new Error('503 throttled');
      },
    };
    const r = await runMailoutQueue(env, { db, providerFor: () => provider, now: () => NOW });
    expect(r).toMatchObject({ retried: 1, failed: 0 });
    expect(calls.failures[0]).toEqual(['r1', '503 throttled', '2026-10-15T10:05:00.000Z']);
  });

  test('contenido rechazado: sin reintento', async () => {
    const { db, calls } = memoryDb([claimed()]);
    const provider: SendingProvider = {
      ...simulatorProvider(),
      sendEmail: async () => {
        throw new MailoutSendError('MessageRejected', true);
      },
    };
    const r = await runMailoutQueue(env, { db, providerFor: () => provider });
    expect(r.failed).toBe(1);
    expect(calls.failures[0][2]).toBeNull();
  });

  test('si el correo salió y falla el registro, la fila no se toca', async () => {
    const { db, calls } = memoryDb([claimed()]);
    db.recordSent = async () => {
      throw new Error('mailout db 500');
    };
    const r = await runMailoutQueue(env, { db });
    expect(r).toMatchObject({ sent: 0, failed: 0, retried: 0 });
    expect(calls.failures).toEqual([]);
  });

  test('esperas de 1, 5, 15 y 60 minutos', () => {
    expect([1, 2, 3, 4, 5].map((n) => (Date.parse(retryAt(n, NOW)) - NOW.getTime()) / 60_000)).toEqual([1, 5, 15, 60, 60]);
  });
});

describe('el simulador y la frontera', () => {
  test('eventos por la parte local, como el simulador de SES; cualquier otra dirección se entrega', () => {
    expect(simulatedEvents('suppressionlist@simulator.amazonses.com')).toEqual([{ type: 'bounce', bounceType: 'Permanent' }]);
    expect(simulatedEvents('bounce+x@simulator.amazonses.com')[0].type).toBe('bounce');
    expect(simulatedEvents('programacio@teatre.example')).toEqual([{ type: 'delivery' }]);
  });

  test('la clave de servicio solo llama a las RPC de la lista', async () => {
    const fetchFn = vi.fn(async () => new Response('[]', { status: 200 }));
    const e = { PUBLIC_SUPABASE_URL: 'https://db.example', SUPABASE_SERVICE_ROLE_KEY: 'sb_secret_x' };
    await serviceRpc(e, 'mailout_claim', { p_limit: 1 }, fetchFn as unknown as typeof fetch);
    expect((fetchFn.mock.calls[0] as unknown as [string])[0]).toBe('https://db.example/rest/v1/rpc/mailout_claim');
    await expect(
      serviceRpc(e, 'create_mailout' as 'mailout_claim', {}, fetchFn as unknown as typeof fetch),
    ).rejects.toThrow(/not a mailout service rpc/);
  });
});

describe('estado de cada destinatario en la pantalla', () => {
  const row = (over: Partial<MailoutRecipientRow>): MailoutRecipientRow => ({
    recipient_id: 'r',
    conversation_id: 'c',
    address: 'a@b.example',
    display_name: null,
    address_kind: 'contact',
    status: 'pending',
    skip_reason: null,
    basis_kind: 'relationship',
    basis_withdrawn_at: null,
    suppressed_reason: null,
    suppressed_at: null,
    ready: true,
    ...over,
  });

  test('antes de enviar: sin email, excluido, sin base, faltan campos, listo', () => {
    expect(recipientState(row({ address: null }), false)).toBe('no_address');
    expect(recipientState(row({ suppressed_reason: 'unsubscribe' }), false)).toBe('suppressed');
    expect(recipientState(row({ basis_kind: null }), false)).toBe('no_basis');
    expect(recipientState(row({ basis_withdrawn_at: '2026-10-01' }), false)).toBe('no_basis');
    expect(recipientState(row({}), true)).toBe('missing_fields');
    expect(recipientState(row({}), false)).toBe('ready');
  });

  test('después: la cola, lo enviado y lo saltado con su razón; y los recuentos', () => {
    expect(recipientState(row({ status: 'sending' }), false)).toBe('queued');
    expect(recipientState(row({ status: 'skipped', skip_reason: 'duplicate' }), false)).toBe('duplicate');
    expect(recipientState(row({ status: 'delivered' }), false)).toBe('delivered');
    expect(recipientCounts(['delivered', 'delivered', 'bounced'])).toEqual({ delivered: 2, bounced: 1 });
  });
});
