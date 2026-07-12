import { test, expect, type Page } from '@playwright/test';

const EMAIL = process.env.PW_TEST_EMAIL;
const PASSWORD = process.env.PW_TEST_PASSWORD;

/**
 * E2E — line detail as module composition (ADR-056): create a line through
 * the template picker (⌘K action), assert the template's module stack
 * renders, capture a contact from the line's Contacts module (line_id
 * auto-assigned), register+remove a material, add+remove a module.
 *
 * The fixture LINE is STABLE and reused across runs — lines have no
 * delete path (no DELETE policy; ADR-048 forbids soft-delete by PATCH),
 * so the first run creates it through the picker (that IS the coverage)
 * and later runs assert against it. Everything else self-cleans.
 *
 * Scoping (ADR-052 discipline): every API read/sweep is bound to the
 * playwright workspace fixtures + zzz prefixes. The real muk-cia data —
 * including difusion-2026-27 — is never touched.
 */

const LINE_NAME = 'ZZZ E2E Modules';
const CONTACT_NAME = 'ZZZ E2E Line Contact';
const CONTACT_EMAIL = 'zzz-e2e-line-contact@hour.test';

async function login(page: Page) {
  await page.goto('/login');
  await page.locator('input[type=email]').fill(EMAIL!);
  await page.locator('input[type=password]').fill(PASSWORD!);
  await page.getByRole('button', { name: /sign in/i }).click();
  await page.waitForURL(/\/h\//);
}

type LineRow = { id: string; slug: string | null; name: string };

/** The stable fixture line, if a previous run already created it. */
async function findFixtureLine(page: Page): Promise<LineRow | null> {
  return page.evaluate(async ({ name }) => {
    const jwt = localStorage.getItem('hour_jwt');
    const headers = { Authorization: `Bearer ${jwt}` };
    const ws = await fetch('/api/workspaces', { headers });
    const wsId = ((await ws.json()) as { items: { id: string; slug: string }[] }).items.find(
      (w) => w.slug === 'playwright',
    )?.id;
    if (!wsId) return null;
    const res = await fetch(`/api/lines?workspace_ids=${wsId}&status=any`, { headers });
    const items = ((await res.json()) as { items: LineRow[] }).items;
    return items.find((l) => l.name === name) ?? null;
  }, { name: LINE_NAME }) as Promise<LineRow | null>;
}

test.describe.configure({ mode: 'serial' });

test.describe('line detail — module composition', () => {
  test.skip(!EMAIL || !PASSWORD, 'Set PW_TEST_EMAIL / PW_TEST_PASSWORD.');

  test('template picker creates the line (first run) and the stack renders', async ({ page }) => {
    test.setTimeout(120_000);
    await login(page);

    let line = await findFixtureLine(page);

    if (!line) {
      // Create through the picker: ⌘K → New line… → Booking template.
      await page.keyboard.press(process.platform === 'darwin' ? 'Meta+k' : 'Control+k');
      await page.getByRole('option', { name: /New line…/ }).click();
      const dialog = page.locator('dialog[open]');
      await expect(dialog).toBeVisible();
      await dialog.getByRole('radio', { name: /Booking/ }).click();
      await dialog.getByLabel('Project').selectOption({ label: 'ZZZ e2e collab' });
      await dialog.getByLabel('Name').fill(LINE_NAME);
      await dialog.getByRole('button', { name: /create/i }).click();
      await page.waitForURL(/\/line\//, { timeout: 15_000 });
    } else {
      await page.goto(`/h/playwright/project/zzz-e2e-collab/line/${line.slug ?? line.id}`);
    }

    // Booking template stack: Contacts · Calendar · Materials · Notes.
    await expect(page.getByRole('heading', { name: LINE_NAME })).toBeVisible({ timeout: 15_000 });
    for (const label of ['Contacts', 'Calendar', 'Materials', 'Notes']) {
      await expect(page.locator(`#mod-${label.toLowerCase()}`)).toBeVisible();
    }

    line = await findFixtureLine(page);
    expect(line, 'fixture line resolvable through /api/lines').not.toBeNull();
  });

  test('line-context contact capture auto-assigns line_id, then self-cleans', async ({ page }) => {
    test.setTimeout(120_000);
    await login(page);
    const line = await findFixtureLine(page);
    expect(line).not.toBeNull();
    await page.goto(`/h/playwright/project/zzz-e2e-collab/line/${line!.slug ?? line!.id}`);

    // Crash recovery: soft-delete a leftover fixture conversation.
    await page.evaluate(async ({ email, lineId }) => {
      const jwt = localStorage.getItem('hour_jwt');
      const headers = { Authorization: `Bearer ${jwt}` };
      const list = await fetch(`/api/engagements?status=any&line_id=${lineId}`, { headers });
      const items = (
        (await list.json()) as { items: { id: string; person: { email: string | null } | null }[] }
      ).items.filter((i) => i.person?.email === email);
      for (const i of items) {
        await fetch(`/api/engagements/${i.id}`, { method: 'DELETE', headers });
      }
    }, { email: CONTACT_EMAIL, lineId: line!.id });

    // Capture from the module — no Line select needed: the context IS the line.
    await page.locator('#mod-contacts').getByRole('button', { name: 'Add contact' }).click();
    const dialog = page.locator('dialog[open]');
    await dialog.getByLabel('Full name').fill(CONTACT_NAME);
    await dialog.getByLabel('Email').fill(CONTACT_EMAIL);
    await dialog.getByRole('button', { name: /^add$/i }).click();
    await expect(dialog).not.toBeVisible({ timeout: 10_000 });

    await expect(page.locator('#mod-contacts')).toContainText(CONTACT_NAME, { timeout: 10_000 });

    // Verify the line assignment through the API, then self-clean.
    const check = await page.evaluate(async ({ email, lineId }) => {
      const jwt = localStorage.getItem('hour_jwt');
      const headers = { Authorization: `Bearer ${jwt}` };
      const list = await fetch(`/api/engagements?status=any&line_id=${lineId}`, { headers });
      const items = (
        (await list.json()) as {
          items: { id: string; line_id: string | null; person: { email: string | null } | null }[];
        }
      ).items;
      const mine = items.find((i) => i.person?.email === email);
      if (!mine) return { found: false as const };
      const del = await fetch(`/api/engagements/${mine.id}`, { method: 'DELETE', headers });
      return { found: true as const, lineId: mine.line_id, delStatus: del.status };
    }, { email: CONTACT_EMAIL, lineId: line!.id });

    expect(check.found).toBe(true);
    if (check.found) {
      expect(check.lineId).toBe(line!.id);
      expect(check.delStatus).toBe(204);
    }
  });

  test('materials register + remove, add + remove a module', async ({ page }) => {
    test.setTimeout(120_000);
    await login(page);
    const line = await findFixtureLine(page);
    expect(line).not.toBeNull();

    // Crash recovery: line.modules persists — a run killed after the add
    // step leaves People in the stack and the add-menu item gone forever.
    // Reset to the booking template shape via the whitelist PATCH.
    await page.evaluate(async ({ lineId }) => {
      const jwt = localStorage.getItem('hour_jwt');
      await fetch(`/api/lines/${lineId}`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${jwt}`, 'content-type': 'application/json' },
        body: JSON.stringify({ modules: ['contacts', 'calendar', 'materials', 'notes'] }),
      });
    }, { lineId: line!.id });

    await page.goto(`/h/playwright/project/zzz-e2e-collab/line/${line!.slug ?? line!.id}`);

    // Materials: register a link, see the row, remove it.
    await page
      .locator('#mod-materials')
      .getByRole('button', { name: /register material/i })
      .click();
    const dialog = page.locator('dialog[open]');
    await dialog.getByLabel(/kind/i).selectOption({ label: 'Dossier' });
    await dialog.getByLabel(/url/i).fill('https://example.test/zzz-e2e-dossier.pdf');
    await dialog.getByRole('button', { name: /register|create|add/i }).click();
    await expect(dialog).not.toBeVisible({ timeout: 10_000 });
    await expect(page.locator('#mod-materials')).toContainText('Dossier', { timeout: 10_000 });

    // Remove it (self-clean) via the row menu.
    await page.locator('#mod-materials tbody tr').first().getByRole('button').last().click();
    await page.getByRole('menuitem', { name: /remove/i }).click();
    await expect(page.locator('#mod-materials tbody tr')).toHaveCount(0, { timeout: 10_000 });

    // Add the People module, then remove it — the stack round-trips.
    await page.getByRole('button', { name: /add module/i }).click();
    await page.getByRole('menuitem', { name: /People/ }).click();
    await expect(page.locator('#mod-people')).toBeVisible({ timeout: 10_000 });

    await page
      .locator('#mod-people')
      .getByRole('button', { name: /module actions/i })
      .click();
    await page.getByRole('menuitem', { name: /remove module/i }).click();
    await expect(page.locator('#mod-people')).not.toBeVisible({ timeout: 10_000 });
  });
});
