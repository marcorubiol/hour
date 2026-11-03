import { afterEach, describe, expect, test, vi } from 'vitest';
import { SUBSCRIPTION_INVITATIONS_SELECT, subscriptionInvitations } from './audience';

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
