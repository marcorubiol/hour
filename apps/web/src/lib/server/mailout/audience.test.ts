import { afterEach, describe, expect, test, vi } from 'vitest';
import {
  addByHand,
  composeConfirmation,
  confirmSubscription,
  confirmUrl,
  ipBucket,
  sendConfirmation,
  signup,
  SIGNUP_RULE,
  type ConfirmationContext,
  type SignupInput,
} from './audience';
import type { OutgoingEmail, SendingProvider } from './provider';

const ENV = { PUBLIC_SUPABASE_URL: 'https://db.example', PUBLIC_SUPABASE_ANON_KEY: 'anon', SUPABASE_SERVICE_ROLE_KEY: 'sb_secret_x' };
const KEY = 'a'.repeat(32);
const TOKEN = 'b'.repeat(64);

function ctx(over: Partial<ConfirmationContext> = {}): ConfirmationContext {
  return {
    address: 'success@simulator.amazonses.com',
    name: 'Ana',
    language: 'es',
    audience_name: 'Estrenos en Cataluña',
    company_name: 'MüK Cia',
    logo_url: '/m/ws/w1/logo/abc-480x128.png',
    form_key: KEY,
    provider: 'simulator',
    from_address: 'hola@publico.muk.example',
    from_name: 'MüK Cia',
    tenant_name: null,
    configuration_set: null,
    ...over,
  };
}

/** Un fetch de PostgREST: responde por nombre de RPC y apunta cada llamada. */
function rpcFetch(answers: Record<string, unknown>) {
  const calls: { rpc: string; body: Record<string, unknown> }[] = [];
  const fn = vi.fn(async (url: string, init: RequestInit) => {
    const rpc = url.split('/rpc/')[1];
    calls.push({ rpc, body: JSON.parse(String(init.body)) });
    return new Response(JSON.stringify(answers[rpc] ?? null), { status: 200 });
  });
  return { fetchFn: fn as unknown as typeof fetch, calls };
}

function input(over: Partial<SignupInput> = {}): SignupInput {
  return {
    key: KEY,
    email: ' Ana@Example.test ',
    name: 'Ana',
    language: 'es',
    textId: 't1',
    consent: true,
    age: true,
    honeypot: '',
    channel: 'form',
    ip: '203.0.113.7',
    userAgent: 'UA',
    pageUrl: null,
    ...over,
  };
}

/** Un KV en memoria, para el limitador. */
function memoryKv(): KVNamespace {
  const m = new Map<string, string>();
  return {
    get: async (k: string) => m.get(k) ?? null,
    put: async (k: string, v: string) => void m.set(k, v),
  } as unknown as KVNamespace;
}

describe('the confirmation email, per language (plan § 6.2)', () => {
  const cases = [
    ['es', 'Confirma que quieres recibir invitaciones de MüK Cia', 'Si no has sido tú'],
    ['ca', 'Confirma que vols rebre invitacions de MüK Cia', 'Si no has estat tu'],
    ['en', 'Confirm you want invitations from MüK Cia', "If it wasn't you"],
    ['fr', 'Confirmez que vous souhaitez recevoir les invitations de MüK Cia', "Si ce n'était pas vous"],
  ] as const;

  test.each(cases)('%s: subject, link and list in text and HTML', (language, subject, tail) => {
    const link = confirmUrl('https://hour.zerosense.studio', TOKEN);
    const mail = composeConfirmation(ctx({ language }), link, 'https://hour.zerosense.studio');
    expect(mail.subject).toBe(subject);
    expect(mail.text).toContain(link);
    expect(mail.text).toContain('Estrenos en Cataluña');
    expect(mail.text).toContain(tail);
    expect(mail.text).not.toMatch(/\{(company|list|link)\}/);
    expect(mail.html).toContain(`<html lang="${language}">`);
    expect(mail.html).toContain(`href="${link}"`);
  });

  test('the HTML wears the company logo (ADR-172), absolute; without it, no header image', () => {
    const withLogo = composeConfirmation(ctx(), 'https://x/c/t', 'https://hour.zerosense.studio');
    expect(withLogo.html).toContain('src="https://hour.zerosense.studio/m/ws/w1/logo/abc-480x128.png"');
    const without = composeConfirmation(ctx({ logo_url: null }), 'https://x/c/t', 'https://hour.zerosense.studio');
    expect(without.html).not.toContain('<img');
  });

  test('the link is /c/<token> on the app origin', () => {
    expect(confirmUrl('https://hour.zerosense.studio/', TOKEN)).toBe(`https://hour.zerosense.studio/c/${TOKEN}`);
  });
});

describe('sending the confirmation', () => {
  test('goes out through the audience identity and records the provider id and the simulated events', async () => {
    const { fetchFn, calls } = rpcFetch({ audience_confirmation_context: [ctx({ address: 'bounce@simulator.amazonses.com' })] });
    const sent: OutgoingEmail[] = [];
    const provider: SendingProvider = {
      kind: 'simulator',
      registerDomain: vi.fn(),
      checkDomain: vi.fn(),
      sendEmail: async (e) => {
        sent.push(e);
        return { providerMessageId: 'sim-1', rfcMessageId: null, events: [{ type: 'bounce', bounceType: 'Permanent' }] };
      },
    };
    expect(await sendConfirmation(ENV, 's1', TOKEN, { fetchFn, providerFor: () => provider })).toBe(true);
    expect(sent).toHaveLength(1);
    expect(sent[0].from).toBe('hola@publico.muk.example');
    expect(sent[0].to).toBe('bounce@simulator.amazonses.com');
    expect(sent[0].text).toContain(`https://hour.zerosense.studio/c/${TOKEN}`);
    expect(calls.map((c) => c.rpc)).toEqual(['audience_confirmation_context', 'audience_confirmation_sent', 'mailout_record_event']);
    expect(calls[1].body).toEqual({ p_subscription_id: 's1', p_provider_message_id: 'sim-1' });
    expect(calls[2].body.p_payload).toMatchObject({ provider_message_id: 'sim-1', type: 'bounce', bounce_type: 'Permanent' });
    expect(calls[2].body.p_payload).not.toHaveProperty('recipient_id');
  });

  test('with no route nothing goes out and the quota comes back', async () => {
    const { fetchFn, calls } = rpcFetch({ audience_confirmation_context: [ctx({ provider: null, from_address: null })] });
    const sendEmail = vi.fn();
    const provider = { kind: 'simulator', sendEmail } as unknown as SendingProvider;
    expect(await sendConfirmation(ENV, 's1', TOKEN, { fetchFn, providerFor: () => provider })).toBe(false);
    expect(sendEmail).not.toHaveBeenCalled();
    expect(calls.map((c) => c.rpc)).toEqual(['audience_confirmation_context', 'audience_confirmation_failed']);
  });

  test('a provider that refuses the email gives the quota back and the error goes up', async () => {
    const { fetchFn, calls } = rpcFetch({ audience_confirmation_context: [ctx()] });
    const provider = {
      kind: 'ses',
      sendEmail: async () => {
        throw new Error('ses down');
      },
    } as unknown as SendingProvider;
    await expect(sendConfirmation(ENV, 's1', TOKEN, { fetchFn, providerFor: () => provider })).rejects.toThrow('ses down');
    expect(calls.map((c) => c.rpc)).toEqual(['audience_confirmation_context', 'audience_confirmation_failed']);
    expect(calls[1].body).toEqual({ p_subscription_id: 's1' });
  });
});

describe('signing up (plan § 3.2, § 3.3)', () => {
  test('a valid sign-up calls audience_subscribe with what the Worker saw, and sends the email deferred', async () => {
    const { fetchFn, calls } = rpcFetch({
      audience_subscribe: [{ subscription_id: 's1', token: TOKEN, language: 'es' }],
      audience_confirmation_context: [ctx()],
    });
    const deferred: Promise<unknown>[] = [];
    const sent: OutgoingEmail[] = [];
    const provider = {
      kind: 'simulator',
      sendEmail: async (e: OutgoingEmail) => {
        sent.push(e);
        return { providerMessageId: 'sim-2', rfcMessageId: null, events: [] };
      },
    } as unknown as SendingProvider;
    const r = await signup(
      ENV,
      input({ channel: 'embed', pageUrl: 'https://muk.example/' }),
      (p) => deferred.push(p),
      fetchFn,
      () => provider,
    );
    expect(r).toEqual({ ok: true });
    expect(calls[0]).toEqual({
      rpc: 'audience_subscribe',
      body: {
        p_key: KEY,
        p_address: 'Ana@Example.test',
        p_name: 'Ana',
        p_language: 'es',
        p_text_id: 't1',
        p_age_confirmed: true,
        p_ip: '203.0.113.7',
        p_user_agent: 'UA',
        p_channel: 'embed',
        p_page_url: 'https://muk.example/',
      },
    });
    expect(deferred).toHaveLength(1);
    await Promise.all(deferred);
    // El enlace del correo lleva el token que dio la RPC.
    expect(sent[0].text).toContain(`/c/${TOKEN}`);
    expect(calls.map((c) => c.rpc)).toContain('audience_confirmation_sent');
  });

  test('no token (already confirmed, over the limits, closed list): same answer, no email', async () => {
    const { fetchFn, calls } = rpcFetch({ audience_subscribe: [{ subscription_id: null, token: null, language: null }] });
    const defer = vi.fn();
    expect(await signup(ENV, input(), defer, fetchFn)).toEqual({ ok: true });
    expect(defer).not.toHaveBeenCalled();
    expect(calls.map((c) => c.rpc)).toEqual(['audience_subscribe']);
  });

  test('the honeypot and an unknown-shaped key answer the same and touch nothing', async () => {
    const { fetchFn, calls } = rpcFetch({});
    expect(await signup(ENV, input({ honeypot: 'http://spam' }), vi.fn(), fetchFn)).toEqual({ ok: true });
    expect(await signup(ENV, input({ key: 'nope' }), vi.fn(), fetchFn)).toEqual({ ok: true });
    expect(calls).toHaveLength(0);
  });

  test('email, consent and age are checked before anything else', async () => {
    const { fetchFn, calls } = rpcFetch({});
    expect(await signup(ENV, input({ email: 'not-an-email' }), vi.fn(), fetchFn)).toEqual({ ok: false, error: 'email' });
    expect(await signup(ENV, input({ consent: false }), vi.fn(), fetchFn)).toEqual({ ok: false, error: 'consent' });
    expect(await signup(ENV, input({ age: false }), vi.fn(), fetchFn)).toEqual({ ok: false, error: 'age' });
    expect(calls).toHaveLength(0);
  });

  test('the IP limiter answers busy past its window budget', async () => {
    const { fetchFn } = rpcFetch({ audience_subscribe: [{ subscription_id: null, token: null, language: null }] });
    const env = { ...ENV, RATE_LIMIT: memoryKv() };
    for (let i = 0; i < SIGNUP_RULE.limit; i++) {
      expect(await signup(env, input(), vi.fn(), fetchFn)).toEqual({ ok: true });
    }
    expect(await signup(env, input(), vi.fn(), fetchFn)).toEqual({ ok: false, error: 'busy' });
    // Otra IP sigue pudiendo.
    expect(await signup(env, input({ ip: '198.51.100.1' }), vi.fn(), fetchFn)).toEqual({ ok: true });
  });
});

describe('the limiter key', () => {
  test('IPv4 as is; IPv6 by its /64, however it is written', () => {
    expect(ipBucket('203.0.113.7')).toBe('203.0.113.7');
    expect(ipBucket('2001:db8:85a3:1:aaaa:bbbb:cccc:dddd')).toBe('2001:db8:85a3:1::/64');
    expect(ipBucket('2001:0db8:85a3:0001::1')).toBe('2001:db8:85a3:1::/64');
    expect(ipBucket('2001:db8::1')).toBe('2001:db8:0:0::/64');
    expect(ipBucket(null)).toBe('unknown');
  });
});

describe('confirming (/c/<token>)', () => {
  test('a malformed token never reaches the database', async () => {
    const { fetchFn, calls } = rpcFetch({});
    expect(await confirmSubscription(ENV, 'abc', null, null, fetchFn)).toBe(false);
    expect(calls).toHaveLength(0);
  });

  test('passes IP and agent to audience_confirm and returns its answer', async () => {
    const { fetchFn, calls } = rpcFetch({ audience_confirm: true });
    expect(await confirmSubscription(ENV, TOKEN, '203.0.113.7', 'UA', fetchFn)).toBe(true);
    expect(calls[0]).toEqual({ rpc: 'audience_confirm', body: { p_token: TOKEN, p_ip: '203.0.113.7', p_user_agent: 'UA' } });
  });

  test('busy past the limiter', async () => {
    const { fetchFn } = rpcFetch({ audience_confirm: false });
    const env = { ...ENV, RATE_LIMIT: memoryKv() };
    let last: boolean | 'busy' = false;
    for (let i = 0; i < 31; i++) last = await confirmSubscription(env, TOKEN, '203.0.113.7', 'UA', fetchFn);
    expect(last).toBe('busy');
  });
});

describe('adding a person by hand (task 101)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  /** PostgREST for both keys: the JWT RPC and table reads by global fetch, the service RPCs by fetchFn. */
  function pgFetch(answers: Record<string, unknown>) {
    const calls: { path: string; body: Record<string, unknown> | null; auth: string | null }[] = [];
    const fn = vi.fn(async (url: string, init: RequestInit = {}) => {
      const path = new URL(url).pathname.replace('/rest/v1/', '');
      const headers = new Headers(init.headers);
      calls.push({ path, body: init.body ? JSON.parse(String(init.body)) : null, auth: headers.get('authorization') });
      return new Response(JSON.stringify(answers[path.replace('rpc/', '')] ?? null), { status: 200 });
    });
    vi.stubGlobal('fetch', fn);
    return { fetchFn: fn as unknown as typeof fetch, calls };
  }

  const okProvider: SendingProvider = {
    kind: 'simulator',
    registerDomain: vi.fn(),
    checkDomain: vi.fn(),
    sendEmail: async () => ({ providerMessageId: 'sim-9', rfcMessageId: null, events: [] }),
  };

  test('asks the base with the JWT, takes the token with the service key and sends the confirmation', async () => {
    const { fetchFn, calls } = pgFetch({
      add_audience_subscription: [{ subscription_id: 's1', send_confirmation: true }],
      audience_confirmation_token: TOKEN,
      audience_confirmation_context: [ctx()],
    });
    const r = await addByHand(ENV, 'user-jwt', 'a1', { address: 'ana@example.test', name: ' Ana ', language: 'ca' }, {
      fetchFn,
      providerFor: () => okProvider,
    });
    expect(r).toEqual({ subscription_id: 's1', outcome: 'sent' });
    expect(calls[0]).toMatchObject({
      path: 'rpc/add_audience_subscription',
      body: { p_audience_id: 'a1', p_address: 'ana@example.test', p_name: 'Ana', p_language: 'ca' },
      auth: 'Bearer user-jwt',
    });
    expect(calls.map((c) => c.path)).toEqual([
      'rpc/add_audience_subscription',
      'rpc/audience_confirmation_token',
      'rpc/audience_confirmation_context',
      'rpc/audience_confirmation_sent',
    ]);
    expect(calls[1].body).toEqual({ p_subscription_id: 's1' });
  });

  test('no confirmation asked: says whether she was confirmed or within the quota', async () => {
    const confirmed = pgFetch({
      add_audience_subscription: [{ subscription_id: 's1', send_confirmation: false }],
      audience_subscription: [{ status: 'confirmed' }],
    });
    expect(await addByHand(ENV, 'jwt', 'a1', { address: 'a@b.cd' }, { fetchFn: confirmed.fetchFn })).toEqual({
      subscription_id: 's1',
      outcome: 'confirmed',
    });
    expect(confirmed.calls.map((c) => c.path)).toEqual(['rpc/add_audience_subscription', 'audience_subscription']);
    vi.unstubAllGlobals();
    const recent = pgFetch({
      add_audience_subscription: [{ subscription_id: 's1', send_confirmation: false }],
      audience_subscription: [{ status: 'pending' }],
    });
    expect((await addByHand(ENV, 'jwt', 'a1', { address: 'a@b.cd' }, { fetchFn: recent.fetchFn }))?.outcome).toBe('recent');
  });

  test('no route and a provider that refuses are told apart, and neither throws', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const noRoute = pgFetch({
      add_audience_subscription: [{ subscription_id: 's1', send_confirmation: true }],
      audience_confirmation_token: TOKEN,
      audience_confirmation_context: [ctx({ provider: null, from_address: null })],
    });
    expect((await addByHand(ENV, 'jwt', 'a1', { address: 'a@b.cd' }, { fetchFn: noRoute.fetchFn }))?.outcome).toBe('no_route');
    vi.unstubAllGlobals();
    const refused = pgFetch({
      add_audience_subscription: [{ subscription_id: 's1', send_confirmation: true }],
      audience_confirmation_token: TOKEN,
      audience_confirmation_context: [ctx()],
    });
    const down = {
      kind: 'ses',
      sendEmail: async () => {
        throw new Error('ses down');
      },
    } as unknown as SendingProvider;
    const r = await addByHand(ENV, 'jwt', 'a1', { address: 'a@b.cd' }, { fetchFn: refused.fetchFn, providerFor: () => down });
    expect(r?.outcome).toBe('failed');
    expect(refused.calls.map((c) => c.path)).toContain('rpc/audience_confirmation_failed');
  });

  test('a token that no longer comes (the quota moved in between) is «recent», and nothing is sent', async () => {
    const { fetchFn, calls } = pgFetch({
      add_audience_subscription: [{ subscription_id: 's1', send_confirmation: true }],
      audience_confirmation_token: null,
    });
    expect((await addByHand(ENV, 'jwt', 'a1', { address: 'a@b.cd' }, { fetchFn }))?.outcome).toBe('recent');
    expect(calls.map((c) => c.path)).toEqual(['rpc/add_audience_subscription', 'rpc/audience_confirmation_token']);
  });
});
