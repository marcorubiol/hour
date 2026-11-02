import { test, expect } from '@playwright/test';

const SB_URL = process.env.PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

/**
 * E2E: el alta pública del público (punto 98, fase 2; plan
 * 2026-11-01-audience § 3), con el envío simulado (ADR-111): no sale ningún
 * correo.
 *
 * Solo en el espacio `playwright` (nunca `muk-cia`), que es
 * `mailout_simulator_only`, con direcciones del simulador. El spec pone con la
 * clave de servicio lo que la fase 3 hará en pantalla (una lista abierta con
 * su texto y un dominio del público verificado) y lo quita al acabar.
 *
 * Cómo saca el enlace de confirmación (ADR-175): el token solo existe en el
 * correo (la base guarda su hash), así que el spec no lo lee del formulario.
 *   1. Apuntarse por la página: la respuesta es «te hemos enviado un correo»
 *      y la suscripción queda `pending` con el correo apuntado
 *      (`confirm_provider_message_id` del simulador): el correo salió por el
 *      adaptador.
 *   2. Confirmar: el spec pide su propio token a `audience_subscribe` (la RPC
 *      de máquina que llama el formulario) para otra dirección, y abre
 *      /c/<token> como lo abriría la persona.
 *   3. Darse de baja: una invitación en borrador con esa persona como
 *      destinataria da el token de /u/<token>; baja de la lista, «no recibir
 *      nada más» y volver a apuntarse.
 *
 * Contra un origen desplegado (PW_BASE_URL), nunca contra `vite preview`.
 */

const RUN = Date.now().toString(36);
const FORM_ADDRESS = `success+e2e-aud-${RUN}@simulator.amazonses.com`;
const CONFIRM_ADDRESS = `success+e2e-aud-${RUN}-c@simulator.amazonses.com`;

async function service<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(new URL(`/rest/v1/${path}`, SB_URL), {
    ...init,
    headers: {
      apikey: SERVICE_KEY!,
      Authorization: `Bearer ${SERVICE_KEY}`,
      'content-type': 'application/json',
      Prefer: 'return=representation',
      ...(init.headers ?? {}),
    },
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${init.method ?? 'GET'} ${path}: ${res.status} ${text}`);
  return (text ? JSON.parse(text) : null) as T;
}

interface Fixture {
  workspaceId: string;
  privacyBefore: string | null;
  domainId: string;
  audienceId: string;
  formKey: string;
  textId: string;
  mailoutId: string | null;
}

test.describe('audience sign-up (simulated)', () => {
  test.skip(!SB_URL || !SERVICE_KEY, 'Set PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY.');
  test.describe.configure({ mode: 'serial' });

  const fx = {} as Fixture;

  test.beforeAll(async () => {
    const [ws] = await service<{ id: string; privacy_url: string | null; mailout_simulator_only: boolean }[]>(
      'workspace?slug=eq.playwright&select=id,privacy_url,mailout_simulator_only',
    );
    // Lo que protege a la gente real: este espacio no sale del simulador.
    expect(ws.mailout_simulator_only).toBe(true);
    fx.workspaceId = ws.id;
    fx.privacyBefore = ws.privacy_url;
    if (!ws.privacy_url) {
      await service(`workspace?id=eq.${ws.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ privacy_url: 'https://example.test/privacidad' }),
      });
    }
    const [domain] = await service<{ id: string }[]>('mail_domain', {
      method: 'POST',
      body: JSON.stringify({
        workspace_id: ws.id,
        domain: `publico-e2e-${RUN}.example.test`,
        purpose: 'audience',
        provider: 'simulator',
        from_local_part: 'hola',
        dkim_status: 'SUCCESS',
        mail_from_status: 'SUCCESS',
        verified_at: new Date().toISOString(),
      }),
    });
    fx.domainId = domain.id;
    const [aud] = await service<{ id: string; form_key: string }[]>('audience', {
      method: 'POST',
      body: JSON.stringify({ workspace_id: ws.id, name: `E2E Estrenos ${RUN}`, languages: ['es'], default_language: 'es' }),
    });
    fx.audienceId = aud.id;
    fx.formKey = aud.form_key;
    const [text] = await service<{ id: string }[]>('audience_consent_text', {
      method: 'POST',
      body: JSON.stringify({
        workspace_id: ws.id,
        audience_id: aud.id,
        version: 1,
        language: 'es',
        consent_text: `Quiero recibir invitaciones de prueba (${RUN}).`,
      }),
    });
    fx.textId = text.id;
    await service(`audience?id=eq.${aud.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ current_text_version: 1, status: 'open' }),
    });
    fx.mailoutId = null;
  });

  test.afterAll(async () => {
    if (!fx.workspaceId) return;
    // Cada paso corre aunque falle el anterior: la política y el dominio vuelven siempre.
    const steps: (() => Promise<unknown>)[] = [];
    if (fx.mailoutId) steps.push(() => service(`mailout?id=eq.${fx.mailoutId}`, { method: 'DELETE' }));
    for (const address of [FORM_ADDRESS, CONFIRM_ADDRESS]) {
      steps.push(() =>
        service(`mail_suppression?workspace_id=eq.${fx.workspaceId}&address=eq.${encodeURIComponent(address)}`, {
          method: 'DELETE',
        }),
      );
    }
    if (fx.audienceId) steps.push(() => service(`audience?id=eq.${fx.audienceId}`, { method: 'DELETE' }));
    if (fx.domainId) steps.push(() => service(`mail_domain?id=eq.${fx.domainId}`, { method: 'DELETE' }));
    if (!fx.privacyBefore) {
      steps.push(() =>
        service(`workspace?id=eq.${fx.workspaceId}`, { method: 'PATCH', body: JSON.stringify({ privacy_url: null }) }),
      );
    }
    const errors: unknown[] = [];
    for (const step of steps) {
      try {
        await step();
      } catch (err) {
        errors.push(err);
      }
    }
    if (errors.length) throw errors[0];
  });

  test('sign up from the form: same answer, a pending subscription and the email through the simulator', async ({ page }) => {
    await page.goto(`/public/audience/${fx.formKey}`);
    await expect(page.getByText(`Quiero recibir invitaciones de prueba (${RUN}).`)).toBeVisible();
    await page.getByLabel('Correo electrónico').fill(FORM_ADDRESS);
    await page.getByLabel('Nombre').fill('E2E');
    // Sin la casilla del consentimiento, el navegador no envía (required).
    await page.getByText(`Quiero recibir invitaciones de prueba (${RUN}).`).click();
    await page.getByText('Tengo 14 años o más.').click();
    await page.getByRole('button', { name: 'Apuntarme' }).click();
    await expect(page.getByRole('status')).toHaveText(/Te hemos enviado un correo/);

    await expect
      .poll(async () => {
        const [s] = await service<{ status: string; confirm_sent_count: number; confirm_provider_message_id: string | null }[]>(
          `audience_subscription?audience_id=eq.${fx.audienceId}&address=eq.${encodeURIComponent(FORM_ADDRESS)}&select=status,confirm_sent_count,confirm_provider_message_id`,
        );
        return s ? `${s.status}:${s.confirm_sent_count}:${s.confirm_provider_message_id?.startsWith('sim-')}` : 'none';
      })
      .toBe('pending:1:true');

    // Otra vez la misma dirección: la misma respuesta y ningún correo más (24 horas).
    await page.goto(`/public/audience/${fx.formKey}`);
    await page.getByLabel('Correo electrónico').fill(FORM_ADDRESS);
    await page.getByText(`Quiero recibir invitaciones de prueba (${RUN}).`).click();
    await page.getByText('Tengo 14 años o más.').click();
    await page.getByRole('button', { name: 'Apuntarme' }).click();
    await expect(page.getByRole('status')).toHaveText(/Te hemos enviado un correo/);
    const [again] = await service<{ confirm_sent_count: number }[]>(
      `audience_subscription?audience_id=eq.${fx.audienceId}&address=eq.${encodeURIComponent(FORM_ADDRESS)}&select=confirm_sent_count`,
    );
    expect(again.confirm_sent_count).toBe(1);

    // Una dirección fuera del simulador en un espacio solo-simulador: la misma
    // respuesta, y ni fila ni correo (ADR-175).
    const real = `e2e-aud-${RUN}@example.test`;
    await page.goto(`/public/audience/${fx.formKey}`);
    await page.getByLabel('Correo electrónico').fill(real);
    await page.getByText(`Quiero recibir invitaciones de prueba (${RUN}).`).click();
    await page.getByText('Tengo 14 años o más.').click();
    await page.getByRole('button', { name: 'Apuntarme' }).click();
    await expect(page.getByRole('status')).toHaveText(/Te hemos enviado un correo/);
    expect(
      await service<unknown[]>(`audience_subscription?audience_id=eq.${fx.audienceId}&address=eq.${encodeURIComponent(real)}`),
    ).toHaveLength(0);
  });

  test('the embed is framable; the plain form is not', async ({ request }) => {
    const embed = await request.get(`/public/audience/${fx.formKey}/embed`);
    expect(embed.headers()['content-security-policy']).toContain('frame-ancestors *');
    expect(embed.headers()['x-frame-options']).toBeUndefined();
    const plain = await request.get(`/public/audience/${fx.formKey}`);
    expect(plain.headers()['content-security-policy']).toContain("frame-ancestors 'none'");
    expect(plain.headers()['x-frame-options']).toBe('DENY');
  });

  test('confirm from /c/<token>: the GET does not confirm, the button does', async ({ page }) => {
    const [row] = await service<{ subscription_id: string; token: string }[]>('rpc/audience_subscribe', {
      method: 'POST',
      body: JSON.stringify({
        p_key: fx.formKey,
        p_address: CONFIRM_ADDRESS,
        p_name: 'E2E',
        p_language: 'es',
        p_text_id: fx.textId,
        p_age_confirmed: true,
        p_ip: '203.0.113.7',
        p_user_agent: 'playwright',
        p_channel: 'form',
      }),
    });
    expect(row.token).toMatch(/^[0-9a-f]{64}$/);

    await page.goto(`/c/${row.token}`);
    await expect(page.getByText(/Confirma que quieres recibir las invitaciones/)).toBeVisible();
    const [before] = await service<{ status: string }[]>(`audience_subscription?id=eq.${row.subscription_id}&select=status`);
    expect(before.status).toBe('pending');

    await page.getByRole('button', { name: 'Sí, quiero recibirlas' }).click();
    await expect(page.getByRole('status')).toHaveText(/Hecho\. Te llegarán las invitaciones/);
    const [after] = await service<{ status: string }[]>(`audience_subscription?id=eq.${row.subscription_id}&select=status`);
    expect(after.status).toBe('confirmed');
    const events = await service<{ kind: string }[]>(
      `audience_consent_event?subscription_id=eq.${row.subscription_id}&select=kind&order=occurred_at`,
    );
    expect(events.map((e) => e.kind)).toEqual(['requested', 'confirmed']);

    // Un token que no existe se pinta como caducado.
    await page.goto(`/c/${'0'.repeat(64)}`);
    await expect(page.getByText('Este enlace ha caducado.', { exact: false })).toBeVisible();

    // ── La baja (/u/<token>) de esa persona en una invitación ──
    const [mailout] = await service<{ id: string }[]>('mailout', {
      method: 'POST',
      body: JSON.stringify({ workspace_id: fx.workspaceId, kind: 'invitation', audience_id: fx.audienceId, status: 'draft' }),
    });
    fx.mailoutId = mailout.id;
    const [recipient] = await service<{ unsubscribe_token: string }[]>('mailout_recipient', {
      method: 'POST',
      body: JSON.stringify({
        mailout_id: mailout.id,
        workspace_id: fx.workspaceId,
        audience_subscription_id: row.subscription_id,
        address: CONFIRM_ADDRESS,
        address_kind: 'subscriber',
        status: 'pending',
      }),
    });
    const status = async () =>
      (await service<{ status: string }[]>(`audience_subscription?id=eq.${row.subscription_id}&select=status`))[0].status;

    await page.goto(`/u/${recipient.unsubscribe_token}`);
    await expect(page.getByText(`¿Darte de baja de «E2E Estrenos ${RUN}»`, { exact: false })).toBeVisible();
    await page.getByRole('button', { name: 'Darme de baja' }).click();
    await expect(page.getByText(`Te has dado de baja de «E2E Estrenos ${RUN}»`, { exact: false })).toBeVisible();
    expect(await status()).toBe('unsubscribed');
    // La baja de una lista no excluye la dirección del espacio.
    expect(await service<unknown[]>(`mail_suppression?workspace_id=eq.${fx.workspaceId}&address=eq.${encodeURIComponent(CONFIRM_ADDRESS)}`)).toHaveLength(0);

    await page.getByRole('button', { name: /No recibir nada más de/ }).click();
    await expect(page.getByText('Ya no te llegará nada más de', { exact: false })).toBeVisible();
    expect(await service<unknown[]>(`mail_suppression?workspace_id=eq.${fx.workspaceId}&address=eq.${encodeURIComponent(CONFIRM_ADDRESS)}`)).toHaveLength(1);

    await page.getByRole('button', { name: /Volver a apuntarme/ }).click();
    await expect(page.getByText(`Vuelves a estar en «E2E Estrenos ${RUN}»`, { exact: false })).toBeVisible();
    expect(await status()).toBe('confirmed');
    expect(await service<unknown[]>(`mail_suppression?workspace_id=eq.${fx.workspaceId}&address=eq.${encodeURIComponent(CONFIRM_ADDRESS)}`)).toHaveLength(0);
  });
});
