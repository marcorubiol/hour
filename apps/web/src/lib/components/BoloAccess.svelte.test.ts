/**
 * El acceso al bolo bajo el tablón (comms carril 2, fase 2), con datos
 * inventados: quien puede invitar ve a la gente, las invitaciones, «X va y
 * no lo ve · Invitar» y el diálogo que deja el enlace para copiar; quien no
 * puede invitar no ve ni el botón ni la propuesta.
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import { tick } from 'svelte';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import Harness from './test/BoloAccessHarness.svelte';
import type { BoloAccess } from '$lib/bolo-access';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

beforeAll(() => {
  const proto = HTMLDialogElement.prototype as HTMLDialogElement & Record<string, unknown>;
  proto.showModal = function (this: HTMLDialogElement) {
    this.setAttribute('open', '');
  };
  proto.close = function (this: HTMLDialogElement) {
    if (!this.hasAttribute('open')) return;
    this.removeAttribute('open');
    this.dispatchEvent(new Event('close'));
  };
});

async function settle() {
  for (let i = 0; i < 4; i++) {
    await tick();
    await new Promise((r) => setTimeout(r, 0));
  }
}

const BASE: BoloAccess = {
  bolo_id: 'b0000000-0000-4000-8000-000000000001',
  ends_at: '2027-04-12T22:00:00Z',
  can_invite: { minim: true, equip: true },
  can_extend: true,
  members: [
    {
      membership_id: 'm1',
      user_id: 'u1',
      person_id: 'pau',
      name: 'Pau Riera',
      preset: 'equip',
      ends_at: '2027-04-12T22:00:00Z',
      expires_with_bolo: true,
      live: true,
      can_manage: true,
    },
  ],
  invitations: [
    { id: 'i1', email: 'laia@example.test', preset: 'minim', person_id: 'laia', invited_by: null, expires_at: '2027-04-01T00:00:00Z' },
  ],
  readers: ['marco'],
};

const GOING = [
  { person_id: 'marco', name: 'Marco' },
  { person_id: 'pau', name: 'Pau Riera' },
  { person_id: 'laia', name: 'Laia' },
  { person_id: 'clara', name: 'Clara Vidal' },
];

function stubFetch(access: BoloAccess) {
  const calls: { method: string; url: string; body: unknown }[] = [];
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    calls.push({ method, url, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    if (method === 'GET') return new Response(JSON.stringify(access), { status: 200 });
    if (method === 'POST') {
      return new Response(
        JSON.stringify({ invitation: { id: 'i2', invite_url: 'http://localhost/invite#tok' } }),
        { status: 201 },
      );
    }
    return new Response(null, { status: 204 });
  });
  vi.stubGlobal('fetch', fetchMock);
  return calls;
}

describe('BoloAccess', () => {
  it('quien invita ve la gente, lo pendiente y a quien va sin verlo', async () => {
    stubFetch(BASE);
    render(Harness, { going: GOING });
    await settle();

    expect(screen.getByText('Pau Riera')).toBeTruthy();
    expect(screen.getByText(/Equipo · hasta el 12 de abril/)).toBeTruthy();
    expect(screen.getByText('laia@example.test')).toBeTruthy();
    // Marco lee, Pau tiene paquete, Laia está invitada: solo Clara se propone.
    expect(screen.getByText('Clara Vidal va y no lo ve')).toBeTruthy();
    expect(screen.queryByText('Laia va y no lo ve')).toBeNull();
    expect(screen.queryByText('Marco va y no lo ve')).toBeNull();
    expect(screen.getByRole('button', { name: 'Añadir a alguien' })).toBeTruthy();
  });

  it('«Invitar» desde quién va crea la invitación con la persona y deja el enlace', async () => {
    const calls = stubFetch(BASE);
    render(Harness, { going: GOING });
    await settle();

    await fireEvent.click(screen.getByRole('button', { name: 'Invitar a Clara Vidal al bolo' }));
    await settle();
    const email = screen.getByLabelText(/Correo/) as HTMLInputElement;
    await fireEvent.input(email, { target: { value: 'clara@example.test' } });
    await settle();
    await fireEvent.click(screen.getByRole('button', { name: 'Crear la invitación' }));
    await settle();

    const post = calls.find((c) => c.method === 'POST')!;
    expect(post.url).toBe('/api/bolos/b0000000-0000-4000-8000-000000000001/access');
    expect(post.body).toEqual({ email: 'clara@example.test', preset: 'equip', person_id: 'clara' });
    expect((screen.getByLabelText(/Enlace de invitación/) as HTMLInputElement).value).toBe('http://localhost/invite#tok');
    expect(screen.getByText(/Hour no envía el correo/)).toBeTruthy();
  });

  it('quien no puede invitar no ve el botón ni la propuesta', async () => {
    stubFetch({ ...BASE, can_invite: { minim: false, equip: false }, can_extend: false, invitations: [], readers: [] });
    render(Harness, { going: GOING });
    await settle();

    expect(screen.getByText('Pau Riera')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Añadir a alguien' })).toBeNull();
    expect(screen.queryByText(/va y no lo ve/)).toBeNull();
  });

  it('revocar una invitación la pide por su id', async () => {
    const calls = stubFetch(BASE);
    render(Harness, { going: GOING });
    await settle();

    await fireEvent.click(screen.getByRole('button', { name: 'Revocar la invitación de laia@example.test' }));
    await settle();
    expect(calls.find((c) => c.method === 'DELETE')?.body).toEqual({ kind: 'invitation', id: 'i1' });
  });
});
