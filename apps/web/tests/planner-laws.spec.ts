import { test, expect, type Page } from '@playwright/test';

const EMAIL = process.env.PW_TEST_EMAIL;
const PASSWORD = process.env.PW_TEST_PASSWORD;

/**
 * THE PLANNER'S LAWS, AS ASSERTIONS — the port of the design prototype's
 * `calAudit()` (ADR-095, and the completeness critic's find).
 *
 * The design document says of itself that it is NOT the specification: eight of
 * its own laws turned out to be false on screen. Its answer was ~50 assertions
 * that walk the RENDERED DOM, and that suite is the most portable thing the
 * prototype has — it is what stops a UI pass from re-breaking what it just
 * fixed.
 *
 * WHY PLAYWRIGHT AND NOT VITEST. These laws are about GEOMETRY: whether an
 * hour wrapped, whether a name was clipped, whether two things print in the
 * same place, whether a control is on screen in a view that does not own it.
 * None of that is decidable from a component's props — it needs a browser that
 * has laid the page out. The laws that ARE decidable from data live in unit
 * tests already (`day-strip.test.ts`, `month-events.test.ts`, `planner.test.ts`).
 *
 * Every one of these caught a real defect on 2026-07-31, by eye, before it was
 * written down here. That is the point: what the eye caught once, this catches
 * every time.
 *
 * Runs against a deployed origin (`PW_BASE_URL`), never `vite preview`.
 */

const SPACE = 's:playwright';

async function planner(page: Page, view: string, extra = '') {
  await page.goto(`/h/planner?view=${view}&scope=${SPACE}${extra}`);
  // The head is the one thing every projection renders.
  await expect(page.locator('.cal, .lenshead').first()).toBeVisible({ timeout: 20_000 });
  await page.waitForTimeout(1200);
}

test.describe('planner laws (ADR-095)', () => {
  test.skip(!EMAIL || !PASSWORD, 'Set PW_TEST_EMAIL / PW_TEST_PASSWORD.');

  test('AN HOUR IS NEVER BROKEN IN TWO', async ({ page }) => {
    // A range is one word: `white-space: normal` on the line makes the en-dash
    // inside `10h–10h30` a break opportunity, and it printed as `10h–` / `10h30`.
    await planner(page, 'month');
    const broken = await page.evaluate(() => {
      const bad: string[] = [];
      for (const el of document.querySelectorAll<HTMLElement>('.slip__t, .ag__time, .ds__hr')) {
        const cs = getComputedStyle(el);
        const line = parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.2;
        // More than one line box means the hour wrapped.
        if (el.getBoundingClientRect().height > line * 1.6) bad.push(el.textContent ?? '');
      }
      return bad;
    });
    expect(broken, 'these hours wrapped onto a second line').toEqual([]);
  });

  test('NO VIEW TRUNCATES A NAME', async ({ page }) => {
    // «Teatre Nacional de Cataluny…» is a name you cannot look up. A row may
    // grow; the month clamps to three lines, which is a different thing from
    // cutting one line short.
    await planner(page, 'agenda');
    const clipped = await page.evaluate(() => {
      const bad: string[] = [];
      for (const el of document.querySelectorAll<HTMLElement>('.ag__title, .ds__n')) {
        const cs = getComputedStyle(el);
        if (cs.textOverflow === 'ellipsis' && cs.whiteSpace === 'nowrap') {
          bad.push(el.textContent?.slice(0, 30) ?? '');
        }
      }
      return bad;
    });
    expect(clipped, 'these names are set to be cut with an ellipsis').toEqual([]);
  });

  test('THE HEAD RUNS ON THREE SCALES, IN ORDER', async ({ page }) => {
    // window (the answer) · view (the drawing) · meta (the machine). Getting
    // the ORDER wrong is what put a 9.5px mono line between the two serif
    // scales and cut the head in half; getting the SIZES wrong is what made
    // the biggest body on the page a control and the smallest the answer.
    await planner(page, 'month');
    const head = await page.evaluate(() => {
      const top = (s: string) => {
        const el = document.querySelector(s);
        return el ? Math.round(el.getBoundingClientRect().top) : -1;
      };
      const px = (s: string) => {
        const el = document.querySelector(s);
        return el ? Math.round(parseFloat(getComputedStyle(el).fontSize)) : -1;
      };
      return {
        title: top('.lenshead__title'),
        views: top('.cal__views'),
        meta: top('.cal__meta'),
        titlePx: px('.lenshead__title'),
        // THE LIT WORD, not the first one: 21px is the view band's scale and
        // it belongs to the word that is true, not to all four.
        viewPx: px('.cal__view--on'),
        viewOffPx: px('.cal__view:not(.cal__view--on)'),
        metaPx: px('.cal__meta'),
      };
    });
    expect(head.title).toBeLessThan(head.views);
    expect(head.views).toBeLessThan(head.meta);
    expect(head.titlePx).toBeGreaterThan(head.viewPx);
    expect(head.viewPx).toBeGreaterThan(head.metaPx);
    // …and the lit word keeps a STEP over its sisters. All four at one size
    // made a row of controls weigh as much as the date above it, and left a
    // 1.5px rule as the only thing saying which drawing you were in.
    expect(head.viewOffPx, 'the view axis lost its step').toBeLessThan(head.viewPx);
  });

  test('THE VIEW WORDS KEEP THE DESIGN’S ORDER', async ({ page }) => {
    // It never changes with the state, and it is the order the keys 1 2 3 4
    // follow — so a reader who learns one has learned the other.
    await planner(page, 'month');
    const words = await page.locator('.cal__view').allInnerTexts();
    expect(words.map((w) => w.trim().toLowerCase())).toEqual([
      'today',
      'agenda',
      'month',
      'board',
    ]);
  });

  test('THE ARROWS AND `today` RIDE WITH THE TITLE', async ({ page }) => {
    // They are the controls OF the date. Down in the row of views they read as
    // a fourth way to change the drawing.
    await planner(page, 'month');
    await expect(page.locator('.lenshead__aside button')).toHaveCount(3);
    await expect(page.locator('.cal__toolbar button', { hasText: /^‹|›$/ })).toHaveCount(0);
  });

  test('THE DATE IS SAID ONCE', async ({ page }) => {
    // The page title IS the date. It used to be repeated in the toolbar,
    // BETWEEN the two arrows, so a control you press repeatedly had a
    // variable-width label in the middle of it.
    await planner(page, 'month');
    const title = (await page.locator('h1, .lenshead__title').first().innerText()).trim();
    const month = title.split(/\s+/)[0];
    const repeats = await page.evaluate((m) => {
      const head = document.querySelector('.cal, main');
      if (!head) return 0;
      let n = 0;
      for (const el of head.querySelectorAll<HTMLElement>('button, span, h1, h2')) {
        if (el.children.length === 0 && (el.textContent ?? '').trim().startsWith(m)) n++;
      }
      return n;
    }, month);
    expect(repeats, `"${month}" is printed more than once in the head`).toBeLessThanOrEqual(1);
  });

  test('A DIAL EXISTS ONLY IN THE VIEW THAT OWNS IT', async ({ page }) => {
    // A URL carrying `lanes=person` over the Month is a URL that lies.
    await planner(page, 'month');
    await expect(page.locator('.cal__dial')).toHaveCount(0);
    expect(page.url()).not.toContain('lanes=');

    await planner(page, 'board');
    await expect(page.locator('.cal__dial')).toHaveCount(1);
    expect(page.url()).toContain('lanes=');
  });

  test('THE PLANNER HAS NO FILTER — narrowing is scope, and only scope', async ({ page }) => {
    await planner(page, 'month');
    await expect(page.locator('.cal__filter, .cal__filter-btn')).toHaveCount(0);
    // …and the legend is not a per-project filter any more either.
    await expect(page.locator('.cal__legend-item')).toHaveCount(0);
  });

  test('A DAY OUTSIDE THE MONTH DRAWS ITS CONTENT AND NEVER ITS NUMBER', async ({ page }) => {
    await planner(page, 'month');
    const numbered = await page.evaluate(
      () =>
        document.querySelectorAll('.cal__day--out .cal__day-num').length,
    );
    expect(numbered, 'an out-of-month cell printed its number').toBe(0);
  });

  test('THE CELL CAPS AT THREE, AND THE REST IS A DOOR', async ({ page }) => {
    // Without the cap the row height is set by the fullest day, so a quiet week
    // could never look short — which is half of what a month is for.
    await planner(page, 'month');
    const over = await page.evaluate(() => {
      const bad: number[] = [];
      document.querySelectorAll('.cal__day').forEach((cell, i) => {
        if (cell.querySelectorAll(':scope > .slip, :scope > .cal__event').length > 3) bad.push(i);
      });
      return bad;
    });
    expect(over, 'these cells drew more than three slips').toEqual([]);
  });

  test('EVERY VIEW WORD IS WIRED', async ({ page }) => {
    // An inert control on screen is a promise the drawing cannot keep.
    await planner(page, 'month');
    const inert = await page.evaluate(() =>
      [...document.querySelectorAll<HTMLButtonElement>('.cal__view')].filter((b) => b.disabled).length,
    );
    expect(inert).toBe(0);
    // All four projections are reachable.
    await expect(page.locator('.cal__view')).toHaveCount(4);
  });

  test('THE FOUR VIEWS SURVIVE A RELOAD — the state is in the URL', async ({ page }) => {
    for (const view of ['day', 'month', 'agenda', 'board']) {
      await planner(page, view);
      await page.reload();
      await page.waitForTimeout(1000);
      expect(page.url(), `${view} did not survive the reload`).toContain(`view=${view}`);
    }
  });

  test('A LEGACY LINK STILL OPENS — carrils/espai are translated, once', async ({ page }) => {
    // A link somebody sent last month is not a bug.
    await page.goto(`/h/planner?view=carrils&group=persona&scope=${SPACE}`);
    await page.waitForTimeout(1500);
    expect(page.url()).toContain('view=board');
    expect(page.url()).toContain('lanes=person');
    expect(page.url(), 'the old vocabulary was written back').not.toContain('group=');
  });
});

/* ══ THE SHEET · what the month is made of ═════════════════════════════════
   Four laws that were repo convention until the design was read against the
   drawing side by side (2026-07-31). Each one is a place where a component
   default quietly outranked the design's own rule. */
test.describe('the sheet', () => {
  test.skip(!EMAIL || !PASSWORD, 'Set PW_TEST_EMAIL / PW_TEST_PASSWORD.');

  test('THE SHEET IS PAPER, NOT A WIDGET — no frame, no fill, no clipped corner', async ({
    page,
  }) => {
    // A bordered, rounded, `overflow: hidden` panel is the shape of a
    // component. A month is a ruled sheet: the rules of the grid are the only
    // lines on it. The fill also painted OVER the column ruling.
    await planner(page, 'month');
    const box = await page.evaluate(() => {
      const el = document.querySelector('.cal__grid');
      if (!el) return null;
      const cs = getComputedStyle(el);
      return {
        border: parseFloat(cs.borderTopWidth),
        radius: parseFloat(cs.borderTopLeftRadius),
        overflow: cs.overflowX,
      };
    });
    expect(box).not.toBeNull();
    expect(box!.border).toBe(0);
    expect(box!.radius).toBe(0);
    expect(box!.overflow, 'a clipped sheet cannot show a popover').not.toBe('hidden');
  });

  test('THE CLOCK IS THE PLANNER’S — `20h30`, never `20:30`, in every drawing', async ({
    page,
  }) => {
    // One clock across the four views. The agenda used to build its own hours
    // straight from `dualTime` and print the wire format beside a month that
    // printed the Planner's.
    for (const view of ['month', 'agenda']) {
      await planner(page, view);
      const colons = await page.evaluate(() =>
        [...document.querySelectorAll('.slip__t, .ag__time')]
          .map((el) => el.textContent?.trim() ?? '')
          .filter((s) => /\d:\d/.test(s)),
      );
      expect(colons, `${view} printed a wire clock`).toEqual([]);
    }
  });

  test('TODAY IS INK AND A WASH — never a filled pill', async ({ page }) => {
    // Colour is project identity and nothing else. A black disc on the one
    // date the reader did not have to look up outranked every gig on the
    // sheet.
    await planner(page, 'month');
    const num = page.locator('.cal__day--today .cal__day-num').first();
    if ((await num.count()) === 0) test.skip(true, 'today is not on this sheet');
    const paint = await num.evaluate((el) => {
      const cs = getComputedStyle(el);
      return { bg: cs.backgroundColor, radius: parseFloat(cs.borderTopLeftRadius) };
    });
    expect(paint.bg).toMatch(/rgba\(0, 0, 0, 0\)|transparent/);
    expect(paint.radius).toBe(0);
  });

  test('ONE MARK, ONE MEANING — a day says THAT there is a call, never how bad', async ({
    page,
  }) => {
    // It used to fork into `!` and `?` by whether a clock was running, which
    // read as two kinds of problem where there is one seen at two moments.
    // WHEN it is due is the hold chip's job, in words, inside the slip.
    await planner(page, 'month');
    const glyphs = await page.evaluate(() => [
      ...new Set([...document.querySelectorAll('.cal__mark')].map((el) => el.textContent?.trim())),
    ]);
    expect(glyphs.filter((g) => g !== '!'), 'a second glyph is a second meaning').toEqual([]);
  });

  test('A RUN OF DAYS IS ONE ELEMENT, and it carries each day’s own hours', async ({ page }) => {
    // The whole argument for storing a rehearsal block as per-day rows. The
    // month used to draw the group as a chip in the first day and leave the
    // others an orphan time box with no name attached to it.
    await planner(page, 'month');
    const runs = await page.evaluate(() =>
      [...document.querySelectorAll('.cal__run')].map((el) => ({
        span: getComputedStyle(el).gridColumnStart + '/' + getComputedStyle(el).gridColumnEnd,
        days: el.querySelectorAll('.cal__run-d').length,
        named: (el.querySelector('.cal__run-h b')?.textContent ?? '').length > 0,
      })),
    );
    for (const r of runs) {
      expect(r.days, 'a run with fewer than two day cells is not a run').toBeGreaterThan(1);
      expect(r.named, 'a run drew its hours and never its name').toBe(true);
    }
  });
});

test.describe('the monogram', () => {
  test.skip(!EMAIL || !PASSWORD, 'Set PW_TEST_EMAIL / PW_TEST_PASSWORD.');

  test('THE PLANNER’S MONOGRAM IS THE DENSE TREATMENT — small, square, no ring', async ({
    page,
  }) => {
    // At 13px a 1px inset ring takes 15% of the tile and closes on the
    // letters until `MM` reads as a smudge. The tint alone carries the
    // identity at this size, which is the whole job.
    for (const view of ['month', 'agenda']) {
      await planner(page, view);
      const marks = await page.evaluate(() =>
        [...document.querySelectorAll('.mark--mini .mark__chip')].map((el) => {
          const cs = getComputedStyle(el);
          return {
            h: Math.round(el.getBoundingClientRect().height),
            radius: parseFloat(cs.borderTopLeftRadius),
            ring: cs.boxShadow,
          };
        }),
      );
      for (const m of marks) {
        expect(m.h, `${view}: the tile grew`).toBeLessThanOrEqual(14);
        expect(m.radius, `${view}: the corner is too round for this size`).toBeLessThanOrEqual(3);
        expect(m.ring, `${view}: the ring came back`).toBe('none');
      }
    }
  });
});
