import { afterEach, describe, expect, test, vi } from 'vitest';
import { ALSO_SELECT, SUBSCRIPTION_INVITATIONS_SELECT, alsoSubscribedTo, invitationDrafts, subscriptionInvitations } from './audience';

const ENV = { PUBLIC_SUPABASE_URL: 'https://db.example', PUBLIC_SUPABASE_ANON_KEY: 'anon' };

afterEach(() => vi.unstubAllGlobals());

describe('subscriptionInvitations (tarea 112)', () => {
  test('embebe mailout por el nombre de su FK compuesta, no por la columna', () => {
    expect(SUBSCRIPTION_INVITATIONS_SELECT).toContain('mailout!mailout_recipient_mailout_fkey(subject)');
    expect(SUBSCRIPTION_INVITATIONS_SELECT).not.toContain(':mailout_id(');
  });

  test('pide las de la suscripción y devuelve el asunto de cada envío', async () => {
    const fetchFn = vi.fn(async (_url: string) =>
      new Response(
        JSON.stringify([
          { id: 'r1', mailout_id: 'm1', status: 'sent', sent_at: '2026-11-01T10:00:00Z', mailout: { subject: 'Estreno' } },
          { id: 'r2', mailout_id: 'm2', status: 'pending', sent_at: null, mailout: null },
        ]),
        { status: 200 },
      ),
    );
    vi.stubGlobal('fetch', fetchFn);
    const out = await subscriptionInvitations(ENV, 'jwt', 's1');
    const url = new URL(fetchFn.mock.calls[0][0]);
    expect(url.pathname).toBe('/rest/v1/mailout_recipient');
    expect(url.searchParams.get('select')).toBe(SUBSCRIPTION_INVITATIONS_SELECT);
    expect(url.searchParams.get('audience_subscription_id')).toBe('eq.s1');
    expect(out).toEqual([
      { recipient_id: 'r1', mailout_id: 'm1', subject: 'Estreno', status: 'sent', sent_at: '2026-11-01T10:00:00Z' },
      { recipient_id: 'r2', mailout_id: 'm2', subject: null, status: 'pending', sent_at: null },
    ]);
  });

  test('una lectura que falla se propaga: no se convierte en una lista vacía', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{"code":"PGRST200"}', { status: 400 })));
    await expect(subscriptionInvitations(ENV, 'jwt', 's1')).rejects.toThrow();
  });
});

describe('alsoSubscribedTo (tarea 103)', () => {
  test('busca la dirección en las listas del espacio, sin la baja, y quita la lista desde la que se mira', async () => {
    const fetchFn = vi.fn(async (_url: string) =>
      new Response(
        JSON.stringify([
          { audience_id: 'a1', status: 'confirmed', audience: { name: 'Estrenos' } },
          { audience_id: 'a2', status: 'pending', audience: { name: 'Barcelona' } },
        ]),
        { status: 200 },
      ),
    );
    vi.stubGlobal('fetch', fetchFn);
    const out = await alsoSubscribedTo(ENV, 'jwt', 'w1', ' Ana@Example.test ', 'a1');
    const url = new URL(fetchFn.mock.calls[0][0]);
    expect(url.pathname).toBe('/rest/v1/audience_subscription');
    expect(url.searchParams.get('select')).toBe(ALSO_SELECT);
    expect(url.searchParams.get('workspace_id')).toBe('eq.w1');
    expect(url.searchParams.get('address')).toBe('eq.ana@example.test');
    expect(url.searchParams.get('status')).toBe('neq.unsubscribed');
    expect(out).toEqual([{ audience_id: 'a2', name: 'Barcelona', status: 'pending' }]);
  });

  test('embebe la lista por el nombre de su FK compuesta', () => {
    expect(ALSO_SELECT).toContain('audience!audience_subscription_audience_fkey(name)');
  });

  test('sin dirección no pregunta', async () => {
    const fetchFn = vi.fn();
    vi.stubGlobal('fetch', fetchFn);
    expect(await alsoSubscribedTo(ENV, 'jwt', 'w1', '  ')).toEqual([]);
    expect(fetchFn).not.toHaveBeenCalled();
  });
});

describe('invitationDrafts (tarea 103)', () => {
  test('los borradores de invitación del espacio, con el nombre de la lista que ya llevan', async () => {
    const fetchFn = vi.fn(async (url: string) => {
      const path = new URL(url).pathname;
      const body =
        path === '/rest/v1/mailout'
          ? [
              { id: 'm1', subject: 'Estreno', created_at: '2026-11-03T10:00:00Z', audience_id: 'a2' },
              { id: 'm2', subject: null, created_at: '2026-11-02T10:00:00Z', audience_id: null },
            ]
          : [{ id: 'a2', name: 'Barcelona' }];
      return new Response(JSON.stringify(body), { status: 200 });
    });
    vi.stubGlobal('fetch', fetchFn);
    const out = await invitationDrafts(ENV, 'jwt', 'w1');
    const first = new URL(fetchFn.mock.calls[0][0]);
    expect(first.searchParams.get('kind')).toBe('eq.invitation');
    expect(first.searchParams.get('status')).toBe('eq.draft');
    expect(first.searchParams.get('workspace_id')).toBe('eq.w1');
    expect(new URL(fetchFn.mock.calls[1][0]).searchParams.get('id')).toBe('in.(a2)');
    expect(out).toEqual([
      { id: 'm1', subject: 'Estreno', created_at: '2026-11-03T10:00:00Z', audience: { id: 'a2', name: 'Barcelona' } },
      { id: 'm2', subject: null, created_at: '2026-11-02T10:00:00Z', audience: null },
    ]);
  });
});
