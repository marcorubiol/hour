import { test, expect, request as pwRequest, type Page } from '@playwright/test';
import { waitForLoaded } from './loaded';
import { forgetConversations } from './forget';

const EMAIL = process.env.PW_TEST_EMAIL;
const PASSWORD = process.env.PW_TEST_PASSWORD;
const SB_URL = process.env.PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

/**
 * E2E: envío en bloque, fase 3 (plan § 10 y § 11, ADR-115), con el envío
 * simulado (ADR-111): no sale ningún correo.
 *
 * Solo en el espacio `playwright` (nunca `muk-cia`), proyecto `zzz-e2e-collab`,
 * con una conversación propia cuyo contacto es una dirección del simulador.
 * Recorrido: dominio verificado (por la API, el simulador) → Conversations en
 * modo selección → «Escribir a 1» → asunto y cuerpo con campos → «Apuntar
 * base» → vista previa con el pie → prueba → «Enviar a 1» → entregado → el
 * correo en el registro de la conversación con el enlace al envío. Con la
 * clave de servicio en el entorno, además la página de baja por su token y
 * el POST de un clic sin Origin (RFC 8058). Limpia lo suyo.
 *
 * Contra un origen con Supabase (vite dev con su base, o desplegado), nunca
 * contra `vite preview`.
 */

const RUN = Date.now().toString(36);
const ORG = `E2E Sala envío ${RUN}`;
const ADDRESS = `success+e2e-${RUN}@simulator.amazonses.com`;

async function api<T>(page: Page, method: string, path: string, body?: unknown): Promise<{ status: number; data: T }> {
  return page.evaluate(
    async ([m, p, b]) => {
      const r = await fetch(p as string, {
        method: m as string,
        headers: { 'content-type': 'application/json' },
        body: b === undefined ? undefined : JSON.stringify(b),
      });
      const text = await r.text();
      return { status: r.status, data: (text ? JSON.parse(text) : null) as T };
    },
    [method, path, body] as const,
  );
}

async function service<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(new URL(`/rest/v1/${path}`, SB_URL), {
    ...init,
    headers: { apikey: SERVICE_KEY!, Authorization: `Bearer ${SERVICE_KEY}`, 'content-type': 'application/json' },
  });
  const text = await res.text();
  return (text ? JSON.parse(text) : null) as T;
}

test.describe('mailout (simulated)', () => {
  test.skip(!EMAIL || !PASSWORD, 'Set PW_TEST_EMAIL / PW_TEST_PASSWORD.');

  test('select → write → basis → preview → test → send → delivered → record', async ({ page }) => {
    test.setTimeout(120_000);

    await page.goto('/h/conversations?etiqueta=sales');
    await waitForLoaded(page);

    // ── Lo que pone el spec: dominio verificado y una conversación suya ──
    const workspaces = await api<{ items: { id: string; slug: string }[] }>(page, 'GET', '/api/workspaces');
    const workspaceId = workspaces.data.items.find((w) => w.slug === 'playwright')!.id;
    const domains = await api<{ items: { id: string; verified_at: string | null }[] }>(
      page,
      'GET',
      `/api/mailout/domains?workspace_id=${workspaceId}`,
    );
    let domainId = domains.data.items.find((d) => d.verified_at)?.id ?? null;
    let ownDomain = false;
    if (!domainId) {
      const added = await api<{ item: { id: string } }>(page, 'POST', '/api/mailout/domains', {
        workspace_id: workspaceId,
        domain: `envios-e2e-send-${RUN}.example.test`,
      });
      expect(added.status).toBe(201);
      domainId = added.data.item.id;
      ownDomain = true;
      expect((await api(page, 'POST', `/api/mailout/domains/${domainId}/check`)).status).toBe(200);
    }
    const projects = await api<{ items: { id: string; slug: string }[] }>(page, 'GET', '/api/projects');
    const projectId = projects.data.items.find((p) => p.slug === 'zzz-e2e-collab')!.id;
    const created = await api<{ conversation: { id: string } }>(page, 'POST', '/api/conversations', {
      project_id: projectId,
      person: { full_name: `Laia Envío ${RUN}`, email: ADDRESS, organization_name: ORG },
      status: 'contacted',
    });
    expect(created.status, JSON.stringify(created.data)).toBe(201);
    const conversationId = created.data.conversation.id;

    try {
      // ── Conversations: modo selección y «Escribir a 1» ──
      await page.reload();
      await waitForLoaded(page);
      await page.getByRole('searchbox').fill(ORG);
      const row = page.locator('[data-testid="conversation-row"]', { hasText: ORG });
      await expect(row).toHaveCount(1, { timeout: 15_000 });
      await page.getByRole('button', { name: /^(Select|Seleccionar|Sélectionner)$/ }).click();
      // The painted box sits over the input (Checkbox); a click on it is the user's.
      await row.getByRole('checkbox').check({ force: true });
      const write = page.getByRole('button', { name: /Write to 1|Escribir a 1|Escriure a 1|Écrire à 1/ });
      await expect(write).toBeEnabled();
      await write.click();
      await page.waitForURL(/\/h\/playwright\/mailout\/[0-9a-f-]{36}$/, { timeout: 15_000 });

      const screen = page.getByTestId('mailout');
      await expect(screen).toBeVisible({ timeout: 15_000 });
      await expect(screen.getByTestId('mailout-simulated')).toBeVisible();
      await expect(screen).not.toContainText(/\bSES\b|tenant|proveedor|provider/i);

      // ── Redactar ──
      await screen.getByLabel(/^(Subject|Asunto|Assumpte|Objet)$/).fill('Propuesta para {sala}');
      await screen.locator('#mailout-body').fill('Hola, {nombre}.\n\n¿Os encaja hablar de fechas?');

      // ── La base: sin ella no sale ──
      const recipients = screen.getByTestId('mailout-recipients');
      await expect(recipients.locator('[data-state="no_basis"]')).toHaveCount(1);
      await recipients.getByRole('button', { name: /Record basis|Apuntar base|Noter la base/ }).click();
      await page.getByRole('dialog').getByRole('button', { name: /^(Save|Guardar|Desar|Enregistrer)$/ }).click();
      await expect(recipients.locator('[data-state="ready"]')).toHaveCount(1, { timeout: 15_000 });

      // ── Vista previa: campos, firma y pie con la baja ──
      const preview = screen.getByTestId('mailout-preview');
      await expect(preview).toContainText(`Propuesta para ${ORG}`);
      await expect(preview).toContainText('Hola, Laia.');
      await expect(preview).toContainText('/u/');
      await expect(screen.locator('.mo__saved')).toContainText(/saved|guardado|desat|enregistré/i, { timeout: 15_000 });

      // ── Prueba: simulada, a tu propio email ──
      await screen.getByRole('button', { name: /Send me a test|Enviarme una prueba|Enviar-me una prova|M'envoyer un test/ }).click();
      await expect(page.getByText(new RegExp(EMAIL!.replace(/[.+]/g, '\\$&')))).toBeVisible({ timeout: 15_000 });

      // ── Enviar a 1, con confirmación ──
      await screen.getByRole('button', { name: /Send to 1|Enviar a 1|Envoyer à 1/ }).click();
      // Recargar antes de la respuesta cancela la petición en el Worker y el envío no entra en cola.
      const sent = page.waitForResponse((r) => r.request().method() === 'POST' && /\/api\/mailout\/[^/]+\/send$/.test(r.url()));
      await page.getByRole('dialog').getByRole('button', { name: /Send to 1|Enviar a 1|Envoyer à 1/ }).click();
      expect((await sent).ok(), 'el envío entra en cola').toBe(true);
      await expect(async () => {
        await page.reload();
        await expect(page.getByTestId('mailout-status')).toHaveAttribute('data-status', 'done', { timeout: 3_000 });
      }).toPass({ timeout: 60_000 });
      await expect(page.getByTestId('mailout-recipients').locator('[data-state="delivered"]')).toHaveCount(1);
      await expect(page.getByTestId('mailout-counts')).toBeVisible();
      const mailoutUrl = page.url();

      // ── El correo, en el registro de su conversación, enlazado al envío ──
      await page.goto(`/h/playwright/conversation/${conversationId}`);
      const link = page.getByTestId('event-mailout');
      await expect(link).toBeVisible({ timeout: 15_000 });
      await expect(page.getByText(`Propuesta para ${ORG}`)).toBeVisible();
      await link.click();
      await expect(page).toHaveURL(mailoutUrl);

      // ── Baja por token y un clic sin Origin (solo con la clave de servicio) ──
      if (SB_URL && SERVICE_KEY) {
        const rows = await service<{ unsubscribe_token: string }[]>(
          `mailout_recipient?conversation_id=eq.${conversationId}&select=unsubscribe_token`,
        );
        const token = rows[0].unsubscribe_token;
        const anon = await pwRequest.newContext({ baseURL: new URL(page.url()).origin });
        // Lo que manda Gmail: un formulario, sin cookies y sin Origin.
        const oneClick = await anon.post(`/u/${token}`, { form: { 'List-Unsubscribe': 'One-Click' } });
        expect(oneClick.status()).toBe(200);
        await anon.dispose();

        const undo = /Receive them again|Volver a recibirlos|Tornar a rebre-les|Les recevoir/;
        await page.goto(`/u/${token}`);
        await page.getByRole('button', { name: undo }).click();
        await expect(page.getByRole('button', { name: /Unsubscribe me|Darme de baja|Donar-me de baixa|Me désinscrire/ })).toHaveCount(0);
        await page.goto(`/u/${token}`);
        await page.getByRole('button', { name: /Unsubscribe me|Darme de baja|Donar-me de baixa|Me désinscrire/ }).click();
        await expect(page.getByRole('button', { name: undo })).toBeVisible();

        // El registro dice la baja en su idioma.
        await page.goto(`/h/playwright/conversation/${conversationId}`);
        await expect(page.getByText(/Unsubscribed from mailouts|Se dio de baja de los envíos|Es va donar de baixa|S'est désinscrit/).first()).toBeVisible({ timeout: 15_000 });
      }
      await page.goto('/u/' + '0'.repeat(48));
      await expect(page.getByRole('main')).toContainText(/not valid|no es válido|no és vàlid|n'est pas valide/);
    } finally {
      await forgetConversations(page, [conversationId]);
      if (ownDomain && domainId) await api(page, 'DELETE', `/api/mailout/domains/${domainId}`);
      if (SB_URL && SERVICE_KEY) {
        const addr = encodeURIComponent(`"${ADDRESS}"`);
        await service(`mail_suppression?workspace_id=eq.${workspaceId}&address=eq.${addr}`, { method: 'DELETE' });
        await service(`mail_basis?workspace_id=eq.${workspaceId}&address=eq.${addr}`, { method: 'DELETE' });
      }
    }
  });
});
