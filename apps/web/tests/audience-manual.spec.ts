import { test, expect, type Page } from '@playwright/test';
import { waitForLoaded } from './loaded';

const EMAIL = process.env.PW_TEST_EMAIL;
const PASSWORD = process.env.PW_TEST_PASSWORD;
const SB_URL = process.env.PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

/**
 * E2E: alta a mano (tarea 101) y lo de la tarea 103 («añadir a un borrador»
 * desde la lista y «también está apuntada a» en la ficha de una persona), con
 * el envío simulado (ADR-111): la confirmación sale al simulador.
 *
 * Solo en el espacio `playwright`, con filas propias: dos listas, una
 * dirección del simulador y una invitación en borrador, todas con el sello
 * de la pasada; se borran al final con la clave de servicio (ninguna RPC
 * borra una lista ni un envío). Necesita `.env` además de `.env.test`.
 * Contra un origen desplegado, nunca contra `vite preview`.
 */

const RUN = Date.now().toString(36);
const LIST_A = `E2E A mano ${RUN}`;
const LIST_B = `E2E Otra lista ${RUN}`;
const PERSON = `success+man-${RUN}@simulator.amazonses.com`;

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

async function serviceDelete(path: string): Promise<void> {
  const res = await fetch(new URL(`/rest/v1/${path}`, SB_URL), {
    method: 'DELETE',
    headers: { apikey: SERVICE_KEY!, Authorization: `Bearer ${SERVICE_KEY}` },
  });
  if (!res.ok) throw new Error(`DELETE ${path} ${res.status}: ${await res.text()}`);
}

type Domain = { id: string; verified_at: string | null; purpose: 'outreach' | 'audience' };

/** El dominio del público verificado: el que haya, o uno propio que se quita al final. */
async function audienceDomain(page: Page, workspaceId: string, own: string[]): Promise<void> {
  const list = await api<{ items: Domain[] }>(page, 'GET', `/api/mailout/domains?workspace_id=${workspaceId}`);
  if (list.data.items.some((d) => d.purpose === 'audience' && d.verified_at)) return;
  const added = await api<{ item: { id: string } }>(page, 'POST', '/api/mailout/domains', {
    workspace_id: workspaceId,
    purpose: 'audience',
    domain: `publico.man-e2e-${RUN}.example.test`,
  });
  expect(added.status, JSON.stringify(added.data)).toBe(201);
  own.push(added.data.item.id);
  expect((await api(page, 'POST', `/api/mailout/domains/${added.data.item.id}/check`)).status).toBe(200);
}

/** Una lista en borrador con su texto vigente (lo que confirmará la persona). */
async function listWithText(page: Page, workspaceId: string, name: string): Promise<string> {
  const created = await api<{ id: string }>(page, 'POST', '/api/audience', { workspace_id: workspaceId, name, languages: ['es'] });
  expect(created.status, JSON.stringify(created.data)).toBe(201);
  const texts = await api(page, 'PATCH', `/api/audience/${created.data.id}`, {
    action: 'texts',
    texts: { es: { consent_text: 'Quiero recibir invitaciones de prueba e2e.', info_text: null } },
  });
  expect(texts.status, JSON.stringify(texts.data)).toBe(200);
  return created.data.id;
}

test.describe('audience: by hand and existing drafts (simulated)', () => {
  test.skip(!EMAIL || !PASSWORD, 'Set PW_TEST_EMAIL / PW_TEST_PASSWORD.');
  test.skip(!SB_URL || !SERVICE_KEY, 'Las filas de la pasada se borran con la clave de servicio (.env).');

  test('apuntar a mano → confirmación al simulador → también apuntada → añadir a un borrador', async ({ page }) => {
    test.setTimeout(120_000);
    await page.goto('/h/conversations?view=envios');
    await waitForLoaded(page);

    const workspaces = await api<{ items: { id: string; slug: string }[] }>(page, 'GET', '/api/workspaces');
    const workspaceId = workspaces.data.items.find((w) => w.slug === 'playwright')!.id;
    const ownDomains: string[] = [];
    const lists: string[] = [];
    let mailoutId: string | null = null;

    try {
      await audienceDomain(page, workspaceId, ownDomains);
      const listA = await listWithText(page, workspaceId, LIST_A);
      lists.push(listA);
      const listB = await listWithText(page, workspaceId, LIST_B);
      lists.push(listB);

      // ── 101 en la página de la lista: «Apuntar a alguien» ──
      await page.goto(`/h/playwright/audience/${listA}`);
      await expect(page.getByTestId('audience-list')).toContainText(LIST_A, { timeout: 15_000 });
      await page.getByRole('button', { name: /Add someone|Apuntar a alguien|Apuntar algú|Inscrire quelqu'un/ }).click();
      const add = page.getByRole('dialog');
      const go = add.getByRole('button', { name: /^(Add|Apuntar|Inscrire)$/ });
      await add.getByLabel(/^(Email|Correo|Correu|E-mail)/).fill('no-es-correo');
      await expect(go).toBeDisabled();
      await add.getByLabel(/^(Email|Correo|Correu|E-mail)/).fill(PERSON);
      await add.getByLabel(/Name, if given|Nombre, si lo da|Nom, si el dona|Nom, s'il est donné/).fill('Núria');
      const posted = page.waitForResponse((r) => r.request().method() === 'POST' && r.url().endsWith(`/api/audience/${listA}/people`));
      await go.click();
      const res = await posted;
      expect(res.status()).toBe(201);
      expect((await res.json()).outcome, 'la confirmación sale por el simulador').toBe('sent');
      const people = page.getByTestId('audience-people');
      await expect(people).toContainText(PERSON, { timeout: 15_000 });
      const row = people.locator('li', { hasText: PERSON });
      await expect(row.locator('[data-status="pending"]')).toHaveCount(1);
      await expect(row).toContainText(/By hand|Added by hand|A mano|A mà|Ajouté à la main/);

      // Otra vez la misma dirección: no se le manda otra en 24 horas.
      const again = await api<{ outcome: string }>(page, 'POST', `/api/audience/${listA}/people`, { address: PERSON });
      expect(again.data.outcome).toBe('recent');

      // ── 101 desde Envíos: «Apuntar» en la fila de la otra lista ──
      await page.goto('/h/conversations?view=envios');
      await waitForLoaded(page);
      const panel = page.getByTestId('audience-panel');
      await panel
        .locator('li', { hasText: LIST_B })
        .getByRole('button', { name: /Add someone|Apuntar a alguien|Apuntar algú|Inscrire quelqu'un/ })
        .click();
      await page.getByRole('dialog').getByLabel(/^(Email|Correo|Correu|E-mail)/).fill(PERSON);
      await page.getByRole('dialog').getByRole('button', { name: /^(Add|Apuntar|Inscrire)$/ }).click();
      await expect(page.getByRole('dialog')).toBeHidden({ timeout: 15_000 });

      // ── 103: «También está apuntada a» en su ficha de la lista A ──
      await page.goto(`/h/playwright/audience/${listA}`);
      await page.getByTestId('audience-people').getByRole('button', { name: new RegExp(PERSON.replace(/[.+]/g, '\\$&')) }).click();
      const also = page.getByRole('dialog').getByTestId('audience-also');
      await expect(also).toContainText(LIST_B, { timeout: 15_000 });
      await expect(also).not.toContainText(LIST_A);
      await page.keyboard.press('Escape');

      // ── 103: «Añadir a un borrador» desde la lista A ──
      const draft = await api<{ id: string }>(page, 'POST', '/api/mailout/invitation', { workspace_id: workspaceId, audience_id: listB });
      expect(draft.status, JSON.stringify(draft.data)).toBe(201);
      mailoutId = draft.data.id;
      await page.getByRole('button', { name: /Add to a draft|Añadir a un borrador|Afegir a un esborrany|Ajouter à un brouillon/ }).click();
      const pick = page.getByRole('dialog').getByTestId('audience-drafts');
      const option = pick.getByRole('radio', { name: new RegExp(LIST_B) });
      await expect(option).toHaveCount(1, { timeout: 15_000 });
      await option.check({ force: true });
      await page.getByRole('dialog').getByRole('button', { name: /Add the list|Añadir la lista|Afegir la llista|Ajouter la liste/ }).click();
      await page.waitForURL(new RegExp(`/h/playwright/mailout/${mailoutId}$`), { timeout: 15_000 });
      const detail = await api<{ mailout: { audience_id: string | null } }>(page, 'GET', `/api/mailout/${mailoutId}`);
      expect(detail.data.mailout.audience_id).toBe(listA);
    } finally {
      try {
        for (const id of ownDomains) await api(page, 'DELETE', `/api/mailout/domains/${id}`);
      } finally {
        if (mailoutId) await serviceDelete(`mailout?id=eq.${mailoutId}`);
        // La lista se lleva en cascada textos, suscripciones y su prueba.
        for (const id of lists) await serviceDelete(`audience?id=eq.${id}`);
      }
    }
  });
});
