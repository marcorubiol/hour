import { expect, test, type Page } from '@playwright/test';
import { waitForLoaded } from './loaded';

const EMAIL = process.env.PW_TEST_EMAIL ?? '';
const PASSWORD = process.env.PW_TEST_PASSWORD ?? '';

/**
 * CREAR DESDE LA CELDA DEL MES (ADR-139, después). El «+» de la celda, el
 * doble clic en su hueco y `N` con el foco en el día abren el alta rápida con
 * ESE día puesto; lo creado se deshace desde el aviso, y «Deshacer» lo borra
 * de verdad (la API ya no lo devuelve).
 *
 * Todo en el workspace `playwright`, sobre el proyecto de fixtures, en junio
 * de 2031, que no choca con nada. Autolimpiante (ADR-052): si «Deshacer»
 * falla, `afterAll` borra lo que lleve la marca.
 */

const SCOPE = 's:playwright';
/** zzz-e2e-collab — el proyecto estable del fixture (mismo que date-edit). */
const FIXTURE_PROJECT_ID = '019f21d2-7482-77e6-9ad9-27d881cff305';
const MONTH = '2031-06';
const DAY = '2031-06-11';
/** A day filled past the cell's cap of three, for the «+N más» door. */
const FULL_DAY = '2031-06-18';
const MARK = 'E2E Month cell';

type Perf = { id: string; venue_name: string | null; performed_at: string };

async function madeOn(page: Page, venue: string): Promise<Perf[]> {
  return page.evaluate(
    async ({ v, day }) => {
      const r = await fetch(`/api/performances?status=any&from=${day}&to=${day}&limit=200`);
      const j = (await r.json()) as { items?: Perf[] };
      return (j.items ?? []).filter((p) => p.venue_name === v);
    },
    { v: venue, day: DAY },
  );
}

async function openMonth(page: Page) {
  await page.goto(`/h/planner?view=month&ym=${MONTH}&scope=${SCOPE}`);
  await waitForLoaded(page);
}

/** The quick add is open, on that day: the one date control says it. */
async function expectDialogOn(page: Page, iso: string) {
  const dlg = page.locator('dialog[open]');
  await expect(dlg).toBeVisible();
  await dlg.locator('[data-chip="when"]').click();
  await expect(dlg.locator('.qa__panel input[type="date"]').first()).toHaveValue(iso);
  return dlg;
}

test.describe('Month — create on the cell’s day (ADR-139, después)', () => {
  test.skip(!EMAIL || !PASSWORD, 'Set PW_TEST_EMAIL / PW_TEST_PASSWORD.');
  test.describe.configure({ mode: 'serial' });

  test.afterAll(async ({ browser }) => {
    const page = await browser.newPage();
    await page.goto('/h/desk');
    const left = await page.evaluate(
      async ({ mark, day, last }) => {
        const r = await fetch(`/api/performances?status=any&from=${day}&to=${last}&limit=200`);
        const j = (await r.json()) as { items?: { id: string; venue_name: string | null }[] };
        return (j.items ?? []).filter((p) => p.venue_name?.startsWith(mark)).map((p) => p.id);
      },
      { mark: MARK, day: DAY, last: FULL_DAY },
    );
    for (const id of left) {
      await page.evaluate((i) => fetch(`/api/performances/${i}`, { method: 'DELETE' }), id);
    }
    await page.close();
  });

  test('the cell’s «+» opens the quick add on its day; «Undo» takes it back', async ({ page }) => {
    test.setTimeout(90_000);
    const venue = `${MARK} ${Date.now()}`;
    await openMonth(page);

    const cell = page.locator(`.cal__day[data-day="${DAY}"]`);
    await cell.hover();
    // Its name says the day in words, so a screen reader hears where it adds.
    await page.getByRole('button', { name: 'Add on 11 June' }).click();

    const dlg = await expectDialogOn(page, DAY);
    await dlg.locator('.qa__title').fill(venue);
    await dlg.locator('[data-chip="owner"]').click();
    await dlg.locator('.qa__panel select').first().selectOption(FIXTURE_PROJECT_ID);
    await dlg.getByRole('button', { name: /^add$/i }).click();
    await expect(dlg).toBeHidden({ timeout: 20_000 });

    // Made on the cell's day, and drawn there.
    await expect.poll(async () => (await madeOn(page, venue)).length, { timeout: 15_000 }).toBe(1);
    await expect(cell.locator('.slip', { hasText: venue })).toBeVisible({ timeout: 15_000 });

    // «Undo» on the notice deletes it for real.
    await page.getByRole('button', { name: /^undo$/i }).click();
    await expect.poll(async () => (await madeOn(page, venue)).length, { timeout: 15_000 }).toBe(0);
    await expect(cell.locator('.slip', { hasText: venue })).toHaveCount(0, { timeout: 15_000 });
  });

  test('a double click on the free space opens it on that day; a single click does not', async ({ page }) => {
    await openMonth(page);
    const cell = page.locator(`.cal__day[data-day="${DAY}"]`);
    // The cell's own box, away from anything it holds: its lower edge.
    const box = (await cell.boundingBox())!;
    await page.mouse.click(box.x + box.width / 2, box.y + box.height - 4);
    await expect(page.locator('dialog[open]')).toHaveCount(0);
    await page.mouse.dblclick(box.x + box.width / 2, box.y + box.height - 4);
    await expectDialogOn(page, DAY);
    await page.keyboard.press('Escape');
    await expect(page.locator('dialog[open]')).toHaveCount(0);
  });

  test('the keyboard: `N` on a focused day opens it there, not on the month’s first', async ({ page }) => {
    await openMonth(page);
    await page.locator(`.cal__num[data-day="${DAY}"] button.cal__day-num`).focus();
    await page.keyboard.press('n');
    await expectDialogOn(page, DAY);
    await page.keyboard.press('Escape');
  });

  test('«+N more» on a full cell opens that Day, not the quick add', async ({ page }) => {
    test.setTimeout(90_000);
    await page.goto('/h/desk');
    const stamp = Date.now();
    await page.evaluate(
      async ({ project, day, base }) => {
        for (let i = 1; i <= 5; i++) {
          const r = await fetch('/api/performances', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ project_id: project, performed_at: day, venue_name: `${base} ${i}` }),
          });
          if (!r.ok) throw new Error(`create performance ${r.status}`);
        }
      },
      { project: FIXTURE_PROJECT_ID, day: FULL_DAY, base: `${MARK} full ${stamp}` },
    );
    await openMonth(page);
    const more = page.locator(`.cal__day[data-day="${FULL_DAY}"] [data-testid="month-more"]`);
    await expect(more).toBeVisible({ timeout: 15_000 });
    await more.click();
    await expect(page.locator('dialog[open]')).toHaveCount(0);
    await expect(page).toHaveURL(new RegExp(`view=day.*d=${FULL_DAY}|d=${FULL_DAY}.*view=day`));
  });
});
