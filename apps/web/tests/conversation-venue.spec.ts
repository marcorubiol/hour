import { test, expect } from '@playwright/test';
import { waitForLoaded } from './loaded';
import { openInFull } from './peek';

const EMAIL = process.env.PW_TEST_EMAIL;
const PASSWORD = process.env.PW_TEST_PASSWORD;

/**
 * E2E — ADR-102, fase 2: la conversación es con la organización.
 *
 * 1. Desde la lente, el alta con solo la organización (sin persona) crea la
 *    conversación; la fila la titula la organización, enlazada a la ficha.
 * 2. El campo Organización va primero y autocompleta con las del espacio.
 * 3. El alta de una persona de esa organización en el mismo proyecto ofrece
 *    «Añadir como contacto» y la deja de contacto de la que ya existe.
 * 4. Por la API, con la misma sesión: el segundo alta con esa organización es
 *    un 409 que nombra la primera; la búsqueda encuentra por contacto; cambiar
 *    el papel no borra el `since`; un papel de más de 200 caracteres es 400;
 *    el contacto, que entró de principal, no se cierra sin nombrar otro.
 *
 * Fixture: `playwright`, proyecto `ZZZ e2e collab`; organización y persona
 * `ZZZ E2E Venue` propias. Se recoge al empezar (por si una pasada murió a
 * medias) y se borra al final; la siguiente pasada la revive. Nunca toca
 * `muk-cia`. Solo contra un origen desplegado con 20261011800000.
 */
const ORG = 'ZZZ E2E Venue';
const CONTACT = { full_name: 'ZZZ E2E Venue Contact', email: 'zzz-e2e-venue@hour.test' };

test.describe('conversation with the venue', () => {
  test.skip(!EMAIL || !PASSWORD, 'Set PW_TEST_EMAIL / PW_TEST_PASSWORD.');

  test('create by organization, 409 names it, search, contacts, person file', async ({ page }) => {
    test.setTimeout(120_000);

    await page.goto('/h/conversations?etiqueta=sales');
    await waitForLoaded(page);

    const sweep = () =>
      page.evaluate(async (org) => {
        const list = await fetch(`/api/conversations?status=any&q=${encodeURIComponent(org)}`);
        const items = ((await list.json()) as { items: Array<{ id: string; organization: { name: string } | null }> }).items;
        for (const i of items.filter((x) => x.organization?.name === org)) {
          await fetch(`/api/conversations/${i.id}`, { method: 'DELETE' });
        }
      }, ORG);
    await sweep();

    // 1. La lente: solo la organización. La fila la titula y abre la ficha.
    await page.getByRole('button', { name: 'Add conversation' }).click();
    let dialog = page.locator('dialog[open]');
    await dialog.getByLabel('ZZZ e2e collab').check({ force: true });
    await dialog.getByLabel('Organization').fill(ORG);
    await dialog.getByRole('button', { name: 'Add conversation' }).click();
    await expect(dialog).not.toBeVisible({ timeout: 10_000 });
    await page.getByPlaceholder('People or organizations…').fill(ORG);
    const link = page.locator('main table').getByRole('link', { name: ORG, exact: true });
    await expect(link).toBeVisible({ timeout: 10_000 });
    await link.click();
    // The vistazo first (ADR-139 p1), then the page.
    await openInFull(page);
    await expect(page).toHaveURL(/\/conversation\//);
    await expect(page.locator('h1')).toContainText(ORG);
    await page.goto('/h/conversations');
    await waitForLoaded(page);

    // 2. El alta: Organización primero, con las del espacio para autocompletar.
    await page.getByRole('button', { name: 'Add conversation' }).click();
    dialog = page.locator('dialog[open]');
    await dialog.getByLabel('ZZZ e2e collab').check({ force: true });
    const labels = await dialog.locator('.conversations__form-grid').first().locator('label').allTextContents();
    expect(labels[0]).toContain('Organization');
    const orgInput = dialog.getByLabel('Organization');
    const listId = await orgInput.getAttribute('list');
    expect(listId).toBeTruthy();
    await expect(page.locator(`datalist#${listId} option[value="${ORG}"]`)).toHaveCount(1);

    // 3. Una persona de esa organización en el mismo proyecto: «Añadir como contacto».
    await orgInput.fill(ORG);
    await dialog.getByLabel('Full name').fill(CONTACT.full_name);
    await dialog.getByLabel('Email').fill(CONTACT.email);
    await dialog.getByRole('button', { name: 'Add conversation' }).click();
    const join = dialog.getByRole('button', { name: 'Add as contact' });
    await expect(join).toBeVisible({ timeout: 10_000 });
    await join.click();
    await expect(dialog).not.toBeVisible({ timeout: 10_000 });

    // 4. La API.
    const r = await page.evaluate(
      async ({ org, contact }) => {
        const json = { 'content-type': 'application/json' };
        const find = async (q: string) =>
          ((await (await fetch(`/api/conversations?status=any&q=${encodeURIComponent(q)}`)).json()) as {
            items: Array<{
              id: string;
              project_id: string;
              workspace_id: string;
              organization: { name: string } | null;
              contacts: Array<{ person_id: string; since: string | null; until: string | null; role: string | null }>;
            }>;
          }).items.filter((i) => i.organization?.name === org);

        const [conv] = await find(org);
        if (!conv) return { found: false as const };

        const dup = await fetch('/api/conversations', {
          method: 'POST',
          headers: json,
          body: JSON.stringify({ project_id: conv.project_id, organization: { name: org } }),
        });
        const dupBody = (await dup.json()) as { conversation_id?: string };

        // El contacto que añadió «Añadir como contacto».
        const full = (await (await fetch(`/api/conversations/${conv.id}`)).json()) as {
          item: { contacts: Array<{ person_id: string; person: { email: string | null } | null }> };
        };
        const personId = full.item.contacts.find((c) => c.person?.email === contact.email)?.person_id ?? null;
        const joined = personId !== null;

        const add = await fetch(`/api/conversations/${conv.id}/contacts`, {
          method: 'POST',
          headers: json,
          body: JSON.stringify({ person_id: personId, role: 'programación', since: '2026-01-01' }),
        });
        // Cambiar el papel no borra el `since`.
        const role = await fetch(`/api/conversations/${conv.id}/contacts`, {
          method: 'POST',
          headers: json,
          body: JSON.stringify({ person_id: personId, role: 'dirección' }),
        });
        const long = await fetch(`/api/conversations/${conv.id}/contacts`, {
          method: 'POST',
          headers: json,
          body: JSON.stringify({ person_id: personId, role: 'x'.repeat(201) }),
        });
        const byContact = await find(contact.full_name);
        const after = byContact[0]?.contacts.find((c) => c.person_id === personId);

        const close = await fetch(`/api/conversations/${conv.id}/contacts`, {
          method: 'PATCH',
          headers: json,
          body: JSON.stringify({ person_id: personId }),
        });

        const del = await fetch(`/api/conversations/${conv.id}`, { method: 'DELETE' });
        return {
          found: true as const,
          id: conv.id,
          joined,
          dupStatus: dup.status,
          dupId: dupBody.conversation_id ?? null,
          addStatus: add.status,
          roleStatus: role.status,
          longStatus: long.status,
          contactFound: byContact.length,
          since: after?.since ?? null,
          role: after?.role ?? null,
          closeStatus: close.status,
          delStatus: del.status,
        };
      },
      { org: ORG, contact: CONTACT },
    );

    expect(r.found).toBe(true);
    if (!r.found) return;
    expect(r.joined).toBe(true);
    expect(r.dupStatus).toBe(409);
    expect(r.dupId).toBe(r.id);
    expect(r.addStatus).toBe(200);
    expect(r.roleStatus).toBe(200);
    expect(r.longStatus).toBe(400);
    expect(r.contactFound).toBe(1);
    expect(r.since).toBe('2026-01-01');
    expect(r.role).toBe('dirección');
    // Entró como principal (la conversación no tenía): el principal no se cierra sin nombrar otro.
    expect(r.closeStatus).toBe(400);
    expect(r.delStatus).toBeLessThan(300);
  });
});
