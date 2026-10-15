import { test, expect, type Page } from '@playwright/test';

const EMAIL = process.env.PW_TEST_EMAIL;
const PASSWORD = process.env.PW_TEST_PASSWORD;

/**
 * E2E: envío en bloque, fase 2 (plan § 5 y § 11): el dominio de envío en
 * Ajustes · Correo, con el envío simulado (ADR-111).
 *
 * Solo en el espacio `playwright` (nunca `muk-cia`). La fixture es owner de
 * ese espacio, así que ve el asistente. Alta de un dominio de pruebas,
 * registros DNS (3 de firma, MX y SPF de rebotes, DMARC sugerido), aviso de
 * modo de prueba, «Comprobar» → Verificado, remitente, y al final quita el
 * dominio. Si una ejecución anterior dejó uno, lo quita primero.
 *
 * Contra un origen desplegado (`PW_BASE_URL`), nunca contra `vite preview`.
 */

async function workspaceId(page: Page): Promise<string> {
  return page.evaluate(async () => {
    const r = await fetch('/api/workspaces');
    const body = (await r.json()) as { items: { id: string; slug: string }[] };
    return body.items.find((w) => w.slug === 'playwright')!.id;
  });
}

async function removeDomains(page: Page, ws: string): Promise<void> {
  await page.evaluate(async (id) => {
    const r = await fetch(`/api/mailout/domains?workspace_id=${id}`);
    if (!r.ok) return;
    const body = (await r.json()) as { items: { id: string }[] };
    for (const d of body.items) await fetch(`/api/mailout/domains/${d.id}`, { method: 'DELETE' });
  }, ws);
}

test.describe('sending domain (simulated)', () => {
  test.skip(!EMAIL || !PASSWORD, 'Set PW_TEST_EMAIL / PW_TEST_PASSWORD.');

  test('add → DNS records → check → verified → sender → remove', async ({ page }) => {
    test.setTimeout(60_000);
    const domain = `envios-e2e-${Date.now().toString(36)}.example.test`;

    // Ajustes no tiene raíz `aria-busy` (waitForLoaded): se espera a la sección.
    await page.goto('/h/playwright/settings?section=mail');
    await expect(page.getByTestId('mailout-domain')).toBeVisible({ timeout: 15_000 });
    const ws = await workspaceId(page);
    await removeDomains(page, ws);
    await page.reload();

    const section = page.getByTestId('mailout-domain');
    await expect(section).toBeVisible();
    await expect(section.getByTestId('mailout-simulated')).toBeVisible();

    // Alta: el remitente por defecto es difusion@.
    await section.getByLabel(/^Domain$|^Dominio$|^Domini$|^Domaine$/).fill(`https://www.${domain}/`);
    await expect(section.locator('#md-local')).toHaveValue('difusion');
    await section.getByRole('button', { name: /Add domain|Añadir dominio|Afegir domini|Ajouter le domaine/ }).click();

    // Registros: 3 CNAME de firma, MX y TXT de rebotes en bounce., DMARC sugerido.
    const records = section.getByTestId('mailout-dns-record');
    await expect(records).toHaveCount(6, { timeout: 15_000 });
    await expect(records.filter({ hasText: `._domainkey.${domain}` })).toHaveCount(3);
    await expect(records.filter({ hasText: `bounce.${domain}` })).toHaveCount(2);
    await expect(records.filter({ hasText: `_dmarc.${domain}` })).toHaveCount(1);
    await expect(section.getByTestId('mailout-domain-state')).toContainText(/Pending|Pendiente|Pendent|En attente/);

    // Ninguna palabra del servicio que envía en la pantalla (plan § 3.3).
    await expect(section).not.toContainText(/\bSES\b|tenant|proveedor|provider/i);

    // Comprobar: el simulador lo da por verificado.
    await section.getByRole('button', { name: /^(Check|Comprobar|Comprovar|Vérifier)$/ }).click();
    await expect(section.getByTestId('mailout-domain-state')).toContainText(/Verified|Verificado|Verificat|Vérifié/, {
      timeout: 15_000,
    });

    // Remitente: se cambia y persiste.
    const row = section.getByTestId('mailout-domain-row');
    await expect(row).toContainText(domain);
    const local = section.locator('.md-addr input').first();
    await local.fill('gira');
    const save = section.getByRole('button', { name: /^(Save|Guardar|Desar|Enregistrer)$/ });
    await save.click();
    await expect(save, 'guardado: el botón se va').toHaveCount(0, { timeout: 15_000 });
    await page.reload();
    await expect(page.getByTestId('mailout-domain').locator('.md-addr input').first()).toHaveValue('gira', {
      timeout: 15_000,
    });

    // Limpieza por la pantalla.
    await page
      .getByTestId('mailout-domain')
      .getByRole('button', { name: /Remove domain|Quitar dominio|Treure el domini|Retirer le domaine/ })
      .click();
    await expect(page.getByTestId('mailout-domain-row')).toHaveCount(0, { timeout: 15_000 });
  });
});
