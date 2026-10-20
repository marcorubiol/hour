import { test, expect, type Page } from '@playwright/test';
import { waitForLoaded } from './loaded';

const EMAIL = process.env.PW_TEST_EMAIL;
const PASSWORD = process.env.PW_TEST_PASSWORD;

/**
 * ADR-084 §1 — crear una función que dura VARIOS DÍAS, desde la pantalla.
 *
 * La tubería (RPC + endpoint) la fija `tests/rls/performance-series.test.ts`.
 * Lo que no tenía guardián es la puerta: que el alta rápida haga de un día
 * con «+ hasta» una tanda, y que al enviar salga UNA tanda y no N funciones
 * sueltas.
 *
 * Y fija la decisión de pantalla que va con ello (ADR-139 p3): **un solo
 * control de fecha**. El día y su «hasta», nunca un segundo «Date»: dejar dos
 * sería preguntar dos veces lo mismo con dos respuestas posibles.
 *
 * Todo en el workspace `playwright`, sobre el proyecto de fixtures, con días
 * de 2031 que no chocan con nada. Autolimpiante (ADR-052).
 */

const FIXTURE_SPACE_TOKEN = 's:playwright';
/** zzz-e2e-collab — el proyecto estable del fixture (mismo que date-edit). */
const FIXTURE_PROJECT_ID = '019f21d2-7482-77e6-9ad9-27d881cff305';
/**
 * Lunes a miércoles A PROPÓSITO. La banda se recorta por semana ISO —una tanda
 * que pasa del domingo no es un elemento, son dos, uno por semana— y eso es
 * comportamiento correcto y viejo, heredado de las tandas de `date`. Un tramo
 * que cruzase domingo probaría ESO en vez de lo que este fichero quiere fijar.
 * El 5 de mayo de 2031 es lunes.
 */
const FROM = '2031-05-05';
const TO = '2031-05-07';
const EXPECTED_DAYS = ['2031-05-05', '2031-05-06', '2031-05-07'];

type Perf = { id: string; performed_at: string; series_id: string | null; venue_name: string | null };

async function runsInWindow(page: Page, venue: string): Promise<Perf[]> {
  return page.evaluate(async ({ v, from, to }) => {
    const r = await fetch(`/api/performances?status=any&from=${from}&to=${to}&limit=200`);
    const j = (await r.json()) as { items?: Perf[] };
    return (j.items ?? []).filter((p) => p.venue_name === v);
  }, { v: venue, from: FROM, to: TO });
}

test.describe('a performance that lasts several days (ADR-084 §1)', () => {
  test.skip(!EMAIL || !PASSWORD, 'Set PW_TEST_EMAIL / PW_TEST_PASSWORD.');
  test.describe.configure({ mode: 'serial' });

  const venue = `E2E Run ${Date.now()}`;
  let made: string[] = [];

  test.afterAll(async ({ browser }) => {
    const page = await browser.newPage();
    await page.goto('/h/desk');
    for (const id of made) {
      await page.evaluate((i) => fetch(`/api/performances/${i}`, { method: 'DELETE' }), id);
    }
    await page.close();
  });

  test('ONE DATE CONTROL, and one run comes out — not N loose gigs', async ({ page }) => {
    test.setTimeout(90_000);
    await page.goto(`/h/planner?view=month&scope=${FIXTURE_SPACE_TOKEN}`);
    await waitForLoaded(page);
    await page.getByRole('button', { name: /date/i }).first().click();

    const dlg = page.locator('dialog[open]');
    await expect(dlg).toBeVisible();

    // El alta abre en «performance»: la línea grande es la sala.
    await dlg.locator('.qa__title').fill(venue);

    // Por id y no por etiqueta: el nombre visible del proyecto no es un
    // contrato. El bloque de la ficha «proyecto» tiene un solo desplegable.
    await dlg.locator('[data-chip="owner"]').click();
    await dlg.locator('.qa__panel select').first().selectOption(FIXTURE_PROJECT_ID);

    // UN SOLO CONTROL DE FECHA (ADR-139 p3): el día, y «+ hasta» lo hace tanda.
    await dlg.locator('[data-chip="when"]').click();
    const dates = dlg.locator('.qa__panel input[type="date"]');
    await expect(dates, 'one day, asked once').toHaveCount(1);
    await dates.nth(0).fill(FROM);
    await dlg.getByRole('button', { name: /^\+ (until|hasta|fins|jusqu)/i }).click();
    await expect(dates, 'the day and its «until», never a second «Date»').toHaveCount(2);
    await dates.nth(1).fill(TO);

    await dlg.getByRole('button', { name: /^(add|añadir|afegeix|ajouter)$/i }).click();
    await expect(dlg).toBeHidden({ timeout: 20_000 });

    // La mitad que la pantalla no puede afirmar: UNA serie, no tres sueltas.
    const rows = await runsInWindow(page, venue);
    made = rows.map((r) => r.id);
    expect(rows.map((r) => r.performed_at).sort(), 'one row per day').toEqual(EXPECTED_DAYS);
    const series = new Set(rows.map((r) => r.series_id));
    expect(series.size, 'the three must share ONE series').toBe(1);
    expect([...series][0], 'and it must not be null').toBeTruthy();
  });

  test('the month draws it as ONE band, not three cards', async ({ page }) => {
    test.setTimeout(90_000);
    await page.goto(`/h/planner?view=month&ym=2031-05&scope=${FIXTURE_SPACE_TOKEN}`);
    await waitForLoaded(page);
    await expect(page.locator('.cal__run').first()).toBeVisible();
    const seen = await page.evaluate((v) => {
      const runs = [...document.querySelectorAll('.cal__run')].filter((el) =>
        (el.textContent ?? '').includes(v),
      );
      return {
        bands: runs.length,
        days: runs[0]?.querySelectorAll('.cal__run-d').length ?? 0,
        links: runs[0]?.querySelectorAll('a.cal__run-d').length ?? 0,
        cards: [...document.querySelectorAll('.cal__day .slip')].filter((el) =>
          (el.textContent ?? '').includes(v),
        ).length,
      };
    }, venue);
    expect(seen.bands, 'the run is one element').toBe(1);
    expect(seen.days, 'and it carries a cell per day').toBe(3);
    // Una función TIENE página, así que cada día de la banda es un enlace.
    expect(seen.links, 'each day of a gig run is a link, not a button').toBe(3);
    expect(seen.cards, 'and it does not ALSO draw as loose cards').toBe(0);
  });
});
