import { test, expect, type Page } from '@playwright/test';
import { waitForLoaded } from './loaded';
import { forgetConversations } from './forget';

const EMAIL = process.env.PW_TEST_EMAIL;
const PASSWORD = process.env.PW_TEST_PASSWORD;
const SB_URL = process.env.PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

/**
 * E2E: el público y sus invitaciones, fase 3 (ADR-173; plan del público § 6.1
 * y § 7), con el envío simulado (ADR-111): no sale ningún correo.
 *
 * Solo en el espacio `playwright` (nunca `muk-cia`: sus conversaciones son
 * reales). Recorrido: dominios de la difusión y del público verificados (por
 * la API, el simulador) → vista Público → «Nueva lista» → importar un CSV con
 * base, fuente y declaración (la primera del espacio queda en revisión: la
 * aprueba la clave de servicio, como haría Marco) → «Escribir una invitación»
 * → «Añadir profesionales» desde Conversaciones con una conversación propia →
 * apuntar su base → «Enviar a 2» → `delivered` en la ficha de la persona de
 * la lista y el correo «de la invitación» en el registro de la conversación.
 *
 * Contra un origen con Supabase (vite dev con su base, o desplegado), nunca
 * contra `vite preview`. Necesita la clave de servicio para aprobar la
 * importación si es la primera del espacio.
 */

const RUN = Date.now().toString(36);
const LIST = `E2E Estrenos ${RUN}`;
const ORG = `E2E Sala invitación ${RUN}`;
const SUBSCRIBER = `success+aud-${RUN}@simulator.amazonses.com`;
const PRO = `success+pro-${RUN}@simulator.amazonses.com`;

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

async function serviceRpc<T>(name: string, args: Record<string, unknown>): Promise<T> {
  const res = await fetch(new URL(`/rest/v1/rpc/${name}`, SB_URL), {
    method: 'POST',
    headers: { apikey: SERVICE_KEY!, Authorization: `Bearer ${SERVICE_KEY}`, 'content-type': 'application/json' },
    body: JSON.stringify(args),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${name} ${res.status}: ${text}`);
  return (text ? JSON.parse(text) : null) as T;
}

async function serviceDelete(path: string): Promise<void> {
  const res = await fetch(new URL(`/rest/v1/${path}`, SB_URL), {
    method: 'DELETE',
    headers: { apikey: SERVICE_KEY!, Authorization: `Bearer ${SERVICE_KEY}` },
  });
  if (!res.ok) throw new Error(`DELETE ${path} ${res.status}: ${await res.text()}`);
}

type Domain = { id: string; verified_at: string | null; purpose: 'outreach' | 'audience' };

/** Un dominio verificado de ese propósito: el que haya, o uno propio que se quita al final. */
async function verifiedDomain(page: Page, workspaceId: string, purpose: Domain['purpose'], own: string[]): Promise<void> {
  const list = await api<{ items: Domain[] }>(page, 'GET', `/api/mailout/domains?workspace_id=${workspaceId}`);
  if (list.data.items.some((d) => d.purpose === purpose && d.verified_at)) return;
  const added = await api<{ item: { id: string } }>(page, 'POST', '/api/mailout/domains', {
    workspace_id: workspaceId,
    purpose,
    domain: `${purpose === 'audience' ? 'publico.' : ''}inv-e2e-${RUN}.example.test`,
  });
  expect(added.status, JSON.stringify(added.data)).toBe(201);
  own.push(added.data.item.id);
  expect((await api(page, 'POST', `/api/mailout/domains/${added.data.item.id}/check`)).status).toBe(200);
}

test.describe('audience invitation (simulated)', () => {
  test.skip(!EMAIL || !PASSWORD, 'Set PW_TEST_EMAIL / PW_TEST_PASSWORD.');

  test('list → import → invitation to a list and a conversation → delivered → record', async ({ page }) => {
    test.setTimeout(180_000);
    await page.goto('/h/conversations?etiqueta=audience');
    await waitForLoaded(page);

    const workspaces = await api<{ items: { id: string; slug: string }[] }>(page, 'GET', '/api/workspaces');
    const workspaceId = workspaces.data.items.find((w) => w.slug === 'playwright')!.id;
    const ownDomains: string[] = [];
    await verifiedDomain(page, workspaceId, 'outreach', ownDomains);
    await verifiedDomain(page, workspaceId, 'audience', ownDomains);

    const projects = await api<{ items: { id: string; slug: string }[] }>(page, 'GET', '/api/projects');
    const projectId = projects.data.items.find((p) => p.slug === 'zzz-e2e-collab')!.id;
    const created = await api<{ conversation: { id: string } }>(page, 'POST', '/api/conversations', {
      project_id: projectId,
      person: { full_name: `Laia Invitación ${RUN}`, email: PRO, organization_name: ORG },
    });
    expect(created.status, JSON.stringify(created.data)).toBe(201);
    const conversationId = created.data.conversation.id;
    let audienceId: string | null = null;
    let mailoutId: string | null = null;

    try {
      // ── Vista Público: «Nueva lista» ──
      await page.reload();
      await waitForLoaded(page);
      const panel = page.getByTestId('audience-panel');
      await expect(panel).toBeVisible({ timeout: 15_000 });
      await panel.getByRole('button', { name: /New list|Nueva lista|Llista nova|Nouvelle liste/ }).click();
      const dialog = page.getByRole('dialog');
      await dialog.getByLabel(/List name|Nombre de la lista|Nom de la llista|Nom de la liste/).fill(LIST);
      if (await dialog.getByRole('combobox').count()) await dialog.getByRole('combobox').selectOption(workspaceId);
      await dialog.getByRole('button', { name: /Create list|Crear la lista|Crear la llista|Créer la liste/ }).click();
      await page.waitForURL(/\/h\/playwright\/audience\/[0-9a-f-]{36}$/, { timeout: 15_000 });
      audienceId = page.url().split('/').pop()!;
      const screen = page.getByTestId('audience-list');
      await expect(screen).toContainText(LIST);
      await expect(page.getByTestId('audience-status')).toHaveAttribute('data-status', 'draft');

      // ── Importar: base y fuente obligatorias, y la declaración ──
      const imp = page.getByTestId('audience-import');
      await imp.getByTestId('audience-import-file').setInputFiles({
        name: 'publico.csv',
        mimeType: 'text/csv',
        buffer: Buffer.from(`email;nombre\n${SUBSCRIBER};Núria\nno-es-correo;X\n`),
      });
      await expect(imp.getByTestId('audience-import-read')).toContainText('publico.csv');
      const go = imp.getByRole('button', { name: /Import 2|Importar 2|Importar-ne 2|Importer 2/ });
      await expect(go).toBeDisabled();
      await imp.getByRole('radio').first().check({ force: true });
      await imp.getByLabel(/Where does this list come from|De dónde sale|D'on surt|D'où vient/).fill('Formulario de la web con casilla, e2e');
      await expect(go).toBeDisabled();
      await imp.getByRole('checkbox').check({ force: true });
      await expect(go).toBeEnabled();
      await go.click();
      const result = imp.getByTestId('audience-import-result');
      await expect(result).toBeVisible({ timeout: 15_000 });
      await expect(result).toContainText(/1 imported|1 importadas|1 importades|1 importés/);

      // La primera importación del espacio queda en revisión: la aprueba Marco.
      const imports = await api<{ imports: { id: string; status: string }[] }>(page, 'GET', `/api/audience/${audienceId}`);
      const pending = imports.data.imports.find((i) => i.status === 'review');
      if (pending) {
        test.skip(!SB_URL || !SERVICE_KEY, 'La primera importación del espacio necesita la clave de servicio para aprobarse.');
        await serviceRpc('audience_approve_import', { p_import_id: pending.id });
      }
      await page.reload();
      await expect(page.getByTestId('audience-people')).toContainText(SUBSCRIBER, { timeout: 15_000 });

      // ── Escribir una invitación con la lista ──
      await screen.getByRole('button', { name: /Write an invitation|Escribir una invitación|Escriure una invitació|Écrire une invitation/ }).click();
      await page.waitForURL(/\/h\/playwright\/mailout\/[0-9a-f-]{36}$/, { timeout: 15_000 });
      const mailoutUrl = page.url();
      mailoutId = mailoutUrl.split('/').pop()!;
      const mo = page.getByTestId('mailout');
      await expect(mo).toBeVisible({ timeout: 15_000 });
      await expect(mo.getByTestId('mailout-simulated')).toBeVisible();
      await expect(mo.getByTestId('invitation-audience-count')).toContainText('1');

      // ── Añadir profesionales: Conversaciones en modo selección, y vuelta ──
      await mo.getByRole('button', { name: /Add professionals|Añadir profesionales|Afegir professionals|Ajouter des professionnels/ }).click();
      await page.waitForURL(/invitacion=/, { timeout: 15_000 });
      await waitForLoaded(page);
      await page.getByRole('searchbox').fill(ORG);
      const row = page.locator('[data-testid="conversation-row"]', { hasText: ORG });
      await expect(row).toHaveCount(1, { timeout: 15_000 });
      await row.getByRole('checkbox').check({ force: true });
      await page.getByRole('button', { name: /Add 1 to the invitation|Añadir 1 a la invitación|Afegir-ne 1 a la invitació|Ajouter 1 à l'invitation/ }).click();
      await page.waitForURL(mailoutUrl, { timeout: 15_000 });

      // ── Redactar, la base del profesional, enviar a 2 ──
      await mo.getByLabel(/^(Subject|Asunto|Assumpte|Objet)$/).fill('Estreno de MaMeMi');
      await mo.locator('#mailout-body').fill('Hola, {nombre}:\n\nOs invitamos al estreno.');
      const pros = mo.getByTestId('mailout-recipients');
      await pros.getByRole('button', { name: /Record basis|Apuntar base|Noter la base/ }).click();
      await page.getByRole('dialog').getByRole('button', { name: /^(Save|Guardar|Desar|Enregistrer)$/ }).click();
      await expect(pros.locator('[data-state="ready"]')).toHaveCount(1, { timeout: 15_000 });
      await expect(mo.locator('.mo__saved')).toContainText(/saved|guardado|desat|enregistré/i, { timeout: 15_000 });

      await mo.getByRole('button', { name: /Send to 2|Enviar a 2|Envoyer à 2/ }).click();
      const sent = page.waitForResponse((r) => r.request().method() === 'POST' && /\/api\/mailout\/[^/]+\/send$/.test(r.url()));
      await page.getByRole('dialog').getByRole('button', { name: /Send to 2|Enviar a 2|Envoyer à 2/ }).click();
      expect((await sent).ok(), 'la invitación entra en cola').toBe(true);
      await expect(async () => {
        await page.reload();
        await expect(page.getByTestId('mailout-status')).toHaveAttribute('data-status', 'done', { timeout: 3_000 });
      }).toPass({ timeout: 90_000 });
      await expect(page.getByTestId('invitation-audience-recipients').locator('[data-state="delivered"]')).toHaveCount(1);
      await expect(page.getByTestId('mailout-recipients').locator('[data-state="delivered"]')).toHaveCount(1);

      // ── `delivered` en la ficha de la persona de la lista ──
      await page.goto(`/h/playwright/audience/${audienceId}`);
      await page.getByTestId('audience-people').getByRole('button', { name: new RegExp(SUBSCRIBER.replace(/[.+]/g, '\\$&')) }).click();
      await expect(page.getByTestId('audience-person-invitations').locator('[data-state="delivered"]')).toHaveCount(1, {
        timeout: 15_000,
      });

      // ── El correo, en el registro de la conversación, «de la invitación» ──
      await page.goto(`/h/playwright/conversation/${conversationId}`);
      const link = page.getByTestId('event-mailout');
      await expect(link).toBeVisible({ timeout: 15_000 });
      await expect(link).toContainText(/Estreno de MaMeMi/);
      await link.click();
      await expect(page).toHaveURL(mailoutUrl);
    } finally {
      await forgetConversations(page, [conversationId]);
      if (audienceId && SB_URL && SERVICE_KEY) {
        // Ninguna RPC borra una lista ni un envío: lo hace la clave de servicio.
        // El envío primero (sus destinatarios y eventos caen con él); la lista
        // después (textos, importaciones, suscripciones y su prueba, en cascada).
        await serviceDelete(`mailout?audience_id=eq.${audienceId}`);
        if (mailoutId) await serviceDelete(`mailout?id=eq.${mailoutId}`);
        await serviceDelete(`audience?id=eq.${audienceId}`);
      } else if (audienceId) {
        // Sin la clave: borrar los datos de cada persona (admin) y archivar.
        // Quedan la lista archivada, su importación y la invitación enviada.
        const subs = await api<{ subscriptions: { id: string }[] }>(page, 'GET', `/api/audience/${audienceId}`);
        for (const s of subs.data?.subscriptions ?? []) await api(page, 'DELETE', `/api/audience/subscription/${s.id}`);
        await api(page, 'PATCH', `/api/audience/${audienceId}`, { action: 'status', status: 'archived' });
      }
      for (const id of ownDomains) await api(page, 'DELETE', `/api/mailout/domains/${id}`);
      if (SB_URL && SERVICE_KEY) {
        const addr = encodeURIComponent(`"${PRO}"`);
        await serviceDelete(`mail_basis?workspace_id=eq.${workspaceId}&address=eq.${addr}`);
      }
    }
  });
});
