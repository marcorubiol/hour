import { test, expect, type Page } from '@playwright/test';
import { waitForLoaded } from './loaded';
import { clearAgenda, plantAgenda, type PlantedAgenda } from './agenda-fixture';

const EMAIL = process.env.PW_TEST_EMAIL;
const PASSWORD = process.env.PW_TEST_PASSWORD;

/**
 * THE AGENDA (ADR-211): days with something, from top to bottom. A trip is a
 * leg between days, three free nights are one line, the week is a rule and
 * never a word, the month stays said while you scroll, and what a
 * performance of the next two weeks still needs is said beside it in amber.
 * The `playwright` space is empty from today on, so the spec plants its own
 * fortnight (`agenda-fixture.ts`: performances, one trip) and takes it back
 * after; the skips stay only as a guard against a plant the API refused.
 *
 * Runs against a deployed origin (`PW_BASE_URL`), never `vite preview`.
 */

async function agenda(page: Page) {
  await page.goto('/h/planner?view=agenda&scope=s:playwright');
  await waitForLoaded(page);
}

test.describe('the agenda (ADR-211)', () => {
  test.skip(!EMAIL || !PASSWORD, 'Set PW_TEST_EMAIL / PW_TEST_PASSWORD.');

  let made: PlantedAgenda | null = null;

  test.beforeAll(async ({ browser }) => {
    test.setTimeout(120_000);
    const page = await browser.newPage();
    await page.goto('/h/desk');
    made = await plantAgenda(page);
    await page.close();
  });

  test.afterAll(async ({ browser }) => {
    test.setTimeout(120_000);
    const page = await browser.newPage();
    await page.goto('/h/desk');
    await clearAgenda(page, made);
    await page.close();
  });

  test('ONLY DAYS WITH SOMETHING, AND «WEEK» IS SAID NOWHERE', async ({ page }) => {
    await agenda(page);
    const main = page.locator('main');
    expect(await main.innerText()).not.toMatch(/\b(week|semana|setmana|semaine)\b/i);
    await expect(page.locator('.ag__week, .ag__monthdiv-btn')).toHaveCount(0);
    // Every day row holds a thing, a step, a call or a note: never nothing.
    const empty = await page.evaluate(
      () =>
        [...document.querySelectorAll<HTMLElement>('[data-testid="agenda-day"]')].filter(
          (d) => !d.querySelector('[data-testid="agenda-row"], [data-testid="planner-steps"], .ag__card, .ag__note, .ag__fold'),
        ).length,
    );
    expect(empty, 'day rows with nothing in them').toBe(0);
  });

  test('A TRIP IS A LEG, NOT A ROW', async ({ page }) => {
    await agenda(page);
    const legs = page.getByTestId('agenda-leg');
    test.skip((await legs.count()) === 0, 'no trip in the window');
    await expect(page.getByTestId('agenda-row').locator('[data-kind="travel_day"]')).toHaveCount(0);
    expect(await legs.first().innerText()).toMatch(/→|\s/);
  });

  test('WHAT IS OPEN IS GREY, AMBER ONLY WITH HURRY, AND ONLY IN THE NEXT TWO WEEKS', async ({ page }) => {
    await agenda(page);
    const words = page.getByTestId('agenda-missing');
    test.skip((await words.count()) === 0, 'nothing missing in the window');
    const days = await words.evaluateAll((els) =>
      els.map((el) => el.closest<HTMLElement>('[data-day]')?.dataset.day ?? ''),
    );
    const today = new Date().toISOString().slice(0, 10);
    const last = new Date(Date.now() + 15 * 86_400_000).toISOString().slice(0, 10);
    for (const d of days) expect(d >= today && d <= last, `amber on ${d}`).toBe(true);
    const urgent = page.locator('[data-testid="agenda-missing"].missing-word--urgent');
    test.skip((await urgent.count()) === 0, 'nothing with hurry in the window');
    const ink = await urgent.first().evaluate((el) => {
      const probe = document.createElement('span');
      probe.style.color = 'var(--missing-ink)';
      el.appendChild(probe);
      const want = getComputedStyle(probe).color;
      probe.remove();
      return { got: getComputedStyle(el).color, want };
    });
    expect(ink.got).toBe(ink.want);
  });

  test('THE MONTH STAYS SAID: the title row sticks while the list scrolls', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 800 });
    await agenda(page);
    const head = page.locator('.lenshead');
    const before = (await head.boundingBox())?.y ?? -1;
    await page.mouse.wheel(0, 1500);
    await page.waitForTimeout(300);
    const after = (await head.boundingBox())?.y ?? -1;
    test.skip(await page.evaluate(() => window.scrollY < 100), 'the list is too short to scroll');
    expect(after, 'the title row left the screen').toBeGreaterThanOrEqual(0);
    expect(after).toBeLessThanOrEqual(before);
  });

  test('THE ＋ OF A DAY NEVER SITS ON ITS NUMBER (390 px)', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await agenda(page);
    const adds = page.locator('[data-testid="agenda-day"] .ag__note-add');
    test.skip((await adds.count()) === 0, 'no day with a ＋ in the window');
    const hits = await page.evaluate(() =>
      [...document.querySelectorAll<HTMLElement>('[data-testid="agenda-day"]')].flatMap((d) => {
        const add = d.querySelector<HTMLElement>('.ag__note-add');
        const num = d.querySelector('.ag__num');
        if (!add || !num) return [];
        const n = num.getBoundingClientRect();
        // The glyph's box, not the 44 px target: the target may reach the date's air.
        const r = document.createRange();
        r.selectNodeContents(add);
        const g = r.getBoundingClientRect();
        return g.top < n.bottom && g.bottom > n.top && g.left < n.right && g.right > n.left ? [d.dataset.day] : [];
      }),
    );
    expect(hits, 'days whose ＋ is drawn on the number').toEqual([]);
  });

  test('THE «·» GOES DOWN WITH ITS AMBER WORD, never hangs at a line end (390 px)', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await agenda(page);
    const words = page.getByTestId('agenda-missing');
    test.skip((await words.count()) === 0, 'nothing missing in the window');
    // Each separator and its word share one line box: a wrap moves both.
    const split = await page.evaluate(() =>
      [...document.querySelectorAll<HTMLElement>('.ag__miss')].filter((el) => {
        const r = document.createRange();
        r.selectNodeContents(el);
        // The «·» box is taller than the word's, so tops differ on one line:
        // a wrap is a box that starts below where the first one ends.
        const [first, ...rest] = [...r.getClientRects()];
        return rest.some((b) => b.top >= first.bottom - 1);
      }).length,
    );
    expect(split, 'separators split from their word').toBe(0);
  });
});
