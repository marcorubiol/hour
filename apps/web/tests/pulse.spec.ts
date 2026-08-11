/**
 * THE RAIL PULSE (ADR-096) — what is happening now, and what comes next.
 *
 * Three laws, and the middle one is the reason this file exists: the block
 * must not change height between «nothing has landed» and «here is the
 * answer». It sits above the scope list, so any settling moves the whole
 * rail under the reader's cursor. It was got wrong three times while being
 * built — a reserve computed in the shell's font instead of the card's, then
 * two pixels that were not in any child's height but in a baseline — and
 * every one of those was invisible to check, unit and build.
 *
 * Measured the way it was debugged: by ABORTING the two feeds, so the empty
 * state is real and not a race.
 */

import { expect, test, type Page } from '@playwright/test';

const EMAIL = process.env.PW_TEST_EMAIL ?? '';
const PASSWORD = process.env.PW_TEST_PASSWORD ?? '';

/** Every lens carries the shell, and therefore the pulse. */
const LENSES = ['/h/planner', '/h/desk', '/h/conversations', '/h/money'];

async function pulseBox(page: Page) {
  return page.evaluate(() => {
    const el = document.querySelector('.pulse');
    if (!el) return null;
    return {
      h: Math.round(el.getBoundingClientRect().height * 100) / 100,
      text: (el as HTMLElement).innerText.replace(/\s+/g, ' ').trim(),
    };
  });
}

test.describe('the rail pulse (ADR-096)', () => {
  test.skip(!EMAIL || !PASSWORD, 'Set PW_TEST_EMAIL / PW_TEST_PASSWORD.');

  test('IT RIDES EVERY LENS — the shell says it, not the planner', async ({ page }) => {
    for (const lens of LENSES) {
      await page.goto(lens);
      await expect(page.locator('.pulse'), `no pulse on ${lens}`).toBeVisible({
        timeout: 20_000,
      });
      // Both rows are always drawn, whatever the day holds.
      await expect(page.locator('.pulse')).toContainText(/now/i);
      await expect(page.locator('.pulse')).toContainText(/next|següent|siguiente/i);
    }
  });

  test('IT DOES NOT MOVE WHEN THE ANSWER LANDS', async ({ page }) => {
    let blocked = true;
    // Conversations rather than the planner: there the two feeds belong to
    // the pulse alone, so aborting them starves nothing else on the page.
    await page.route('**/api/performances**', (r) => (blocked ? r.abort() : r.continue()));
    await page.route('**/api/dates**', (r) => (blocked ? r.abort() : r.continue()));

    await page.goto('/h/conversations');
    await expect(page.locator('.pulse')).toBeVisible({ timeout: 20_000 });
    await page.waitForTimeout(2500);
    const empty = await pulseBox(page);
    expect(empty, 'the pulse did not render with its feeds down').not.toBeNull();
    // With nothing on file it claims nothing — a dash, never the word «free».
    expect(empty!.text).toMatch(/—/);

    blocked = false;
    await page.reload();
    await expect(page.locator('.pulse')).toBeVisible({ timeout: 20_000 });
    await expect
      .poll(async () => (await pulseBox(page))?.text ?? '', { timeout: 20_000 })
      .not.toMatch(/^\s*NOW\s*—\s*NEXT\s*—\s*$/i);
    const full = await pulseBox(page);

    // The reserve is meant to DOMINATE the answer, so the two are equal. The
    // one honest exception is a row that brings a line of its own: a venue in
    // another zone adds the slip's timezone gloss, and that is content, not
    // settling — so the spec names it rather than loosening the law.
    const gloss = await page.locator('.pulse .slip__tz').count();
    if (gloss === 0) {
      expect(full!.h, `the rail jumped: ${empty!.h} → ${full!.h}`).toBe(empty!.h);
    } else {
      expect(
        full!.h,
        `the rail jumped beyond its gloss line: ${empty!.h} → ${full!.h}`,
      ).toBeLessThanOrEqual(empty!.h + 14);
    }
  });

  test('WHAT COMES NEXT IS SOMEWHERE YOU CAN GO', async ({ page }) => {
    // A performance has a page; a date does not, and the rail cannot open the
    // planner's edit dialog from another lens — so it addresses the DAY that
    // holds it. Either way the row is a link, never a dead end.
    await page.goto('/h/conversations');
    await expect(page.locator('.pulse')).toBeVisible({ timeout: 20_000 });
    await expect
      .poll(async () => (await pulseBox(page))?.text ?? '', { timeout: 20_000 })
      .not.toMatch(/^\s*NOW\s*—/i);

    const slip = page.locator('.pulse .slip');
    if ((await slip.count()) === 0) test.skip(true, 'nothing ahead for this fixture');
    const href = await slip.first().getAttribute('href');
    expect(href, 'the next thing is not reachable').toBeTruthy();
    expect(href!).toMatch(/^\/h\/(?:[\w-]+\/performance\/[\w-]+|planner\?view=day&d=\d{4}-\d{2}-\d{2})$/);

    await slip.first().click();
    await expect(page).toHaveURL(/\/h\/(?:[\w-]+\/performance\/|planner)/, { timeout: 20_000 });
  });

  test('IT SPEAKS THE PLANNER’S CLOCK, AND NEVER A RAW KEY', async ({ page }) => {
    await page.goto('/h/planner');
    await expect(page.locator('.pulse')).toBeVisible({ timeout: 20_000 });
    await expect
      .poll(async () => (await pulseBox(page))?.text ?? '', { timeout: 20_000 })
      .not.toMatch(/^\s*NOW\s*—/i);

    const text = (await pulseBox(page))!.text;
    // `t()` renders a missing key as the key itself, silently — the rail
    // borrows from three namespaces, so it is worth one assertion.
    expect(text, 'an untranslated key reached the rail').not.toMatch(
      /\b(pulse|planner|desk|hall)\.[a-z_]+/,
    );
    // Every hour here goes through `hourMark`: `20h`, `15h30` — never `15:30`,
    // which is the road sheet's clock and not the planner's.
    expect(text, 'a colon clock reached the planner').not.toMatch(/\b\d{1,2}:\d{2}\b/);
    if (/until|fins|hasta|call/i.test(text)) {
      expect(text, 'a margin hour without the planner clock').toMatch(/\d{1,2}h(\d{2})?/);
    }
  });
});
