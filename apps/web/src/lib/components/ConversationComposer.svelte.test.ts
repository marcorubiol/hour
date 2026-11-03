/**
 * El cuadro de escribir dice quién lo lee antes de escribir (ADR-177 § 6):
 * cada destino cambia la frase y el verbo; al abrir sale el destino de esa
 * conversación, no el último usado en otra, y una nota a medias vuelve en
 * nota. Datos inventados.
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import { tick } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Harness from './test/ConversationComposerHarness.svelte';
import type { MailAccountsResponse } from '$lib/mail';

const MAIL: MailAccountsResponse = {
  items: [
    {
      id: 'a1',
      workspace_id: 'w1',
      scope: 'personal',
      owner_user_id: 'u1',
      provider: 'google',
      address: 'nuria@muk.test',
      status: 'active',
      sync_from: '2026-10-01',
      last_synced_at: null,
      last_error: null,
      messages_ingested: 0,
      connected_by: 'u1',
      created_at: '2026-10-01T00:00:00Z',
    },
  ],
  can_manage_shared: false,
  configured: true,
  signatures: { personal: '', workspace: '' },
};
const NO_MAIL: MailAccountsResponse = { ...MAIL, items: [] };

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 404 })));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

async function settle() {
  for (let i = 0; i < 4; i++) {
    await tick();
    await new Promise((r) => setTimeout(r, 0));
  }
}

const reads = () => screen.getByTestId('composer-reads').textContent?.replace(/\s+/g, ' ').trim();
const pressed = (id: string) => screen.getByTestId(id).getAttribute('aria-pressed');

describe('ConversationComposer', () => {
  it('cada destino dice quién lo lee y su verbo, nunca «Enviar» a secas', async () => {
    render(Harness, { convId: 'c-verbs', mail: MAIL });
    await settle();

    expect(pressed('composer-to-mail')).toBe('true');
    expect(screen.getByTestId('composer-to-mail').textContent).toContain('Correo a Laia');
    expect(reads()).toBe('Sale por correo a laia@teatrellum.test.');
    expect(screen.getByRole('button', { name: 'Enviar correo a Laia' })).toBeTruthy();

    await fireEvent.click(screen.getByTestId('composer-to-team'));
    await settle();
    expect(reads()).toBe('Laia Puig no lo ve. Se queda en Hour, para el equipo.');
    expect(screen.getByTestId('thread-composer').classList.contains('composer--team')).toBe(true);
    expect(screen.getByRole('button', { name: 'Guardar nota' })).toBeTruthy();

    await fireEvent.click(screen.getByTestId('composer-to-log'));
    await settle();
    expect(screen.getByRole('button', { name: 'Apuntar llamada' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Enviar' })).toBeNull();
  });

  it('otra conversación abre en su destino; la nota a medias vuelve en nota', async () => {
    const view = render(Harness, { convId: 'c-a', mail: MAIL });
    await settle();
    await fireEvent.click(screen.getByTestId('composer-to-team'));
    await settle();
    await fireEvent.input(screen.getByRole('textbox'), { target: { value: 'Ojo, la furgo llega tarde' } });
    await settle();

    await view.rerender({ convId: 'c-b', mail: MAIL });
    await settle();
    expect(pressed('composer-to-mail')).toBe('true');

    await view.rerender({ convId: 'c-a', mail: MAIL });
    await settle();
    expect(pressed('composer-to-team')).toBe('true');
    expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toBe('Ojo, la furgo llega tarde');
  });

  it('lo enviado mientras se cambia de conversación no vuelve como borrador', async () => {
    let release: (r: Response) => void = () => {};
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) =>
        init?.method === 'POST' && String(url).endsWith('/api/messages')
          ? new Promise<Response>((r) => (release = r))
          : new Response('{}', { status: 404 }),
      ),
    );
    const view = render(Harness, { convId: 'c-flight', mail: MAIL });
    await settle();
    await fireEvent.click(screen.getByTestId('composer-to-team'));
    await fireEvent.input(screen.getByRole('textbox'), { target: { value: 'Ya va' } });
    await settle();
    await fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Enter' });
    await settle();

    await view.rerender({ convId: 'c-other', mail: MAIL });
    await settle();
    release(new Response(JSON.stringify({ message: { id: 'm1' } }), { status: 201 }));
    await settle();

    await view.rerender({ convId: 'c-flight', mail: MAIL });
    await settle();
    expect(pressed('composer-to-mail')).toBe('true');
    expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toBe('');
  });

  it('con varios contactos, la nota nombra a todos', async () => {
    render(Harness, { convId: 'c-many', mail: MAIL, outsiders: ['Laia Puig', 'Jordi Sastre'] });
    await settle();
    await fireEvent.click(screen.getByTestId('composer-to-team'));
    await settle();
    expect(reads()).toBe('Laia Puig y Jordi Sastre no lo ven. Se queda en Hour, para el equipo.');
    const field = screen.getByRole('textbox');
    expect(field.getAttribute('aria-describedby')).toContain(screen.getByTestId('composer-reads').id);
  });

  it('sin buzón lo dice y cae a la nota', async () => {
    render(Harness, { convId: 'c-nomail', mail: NO_MAIL });
    await settle();
    expect(pressed('composer-to-team')).toBe('true');
    expect(reads()).toBe('Sin correo: conecta un buzón para escribir. Laia Puig no lo ve. Se queda en Hour, para el equipo.');
  });
});
