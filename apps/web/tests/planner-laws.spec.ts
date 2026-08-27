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
    // ANSWER → REPORT → CONTROLS. The window states the date, the machine
    // reports on THAT window, and the controls that change it close the band.
    // With the meta underneath, the line summarising July sat below the
    // buttons that leave July.
    expect(head.title).toBeLessThan(head.meta);
    expect(head.meta).toBeLessThan(head.views);
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
    // `Day` names the DRAWING; `Now` (the window control beside it) names the
    // act of going to the present. Two words, two jobs — they used to be the
    // same word seventy pixels apart.
    expect(words.map((w) => w.trim().toLowerCase())).toEqual([
      'day',
      'agenda',
      'month',
      'board',
    ]);
  });

  test('THE WINDOW’S CONTROLS OPEN THE VIEW ROW, and they are the smallest things in it', async ({
    page,
  }) => {
    // Marco's prototype puts `‹ › Now` here, BEFORE the view words — and small.
    // They only move the window; the words beside them name the drawing, and a
    // control must not outweigh the thing it operates on.
    await planner(page, 'month');
    await expect(page.locator('.cal__toolbar .cal__arw')).toHaveCount(2);
    await expect(page.locator('.cal__toolbar .cal__now')).toHaveCount(1);
    // Nothing left up with the title but the title and the lens switcher.
    await expect(page.locator('.lenshead__aside')).toHaveCount(0);

    const geom = await page.evaluate(() => {
      const r = (s: string) => document.querySelector(s)?.getBoundingClientRect() ?? null;
      const arw = r('.cal__arw');
      const now = r('.cal__now');
      const first = r('.cal__view');
      const lit = r('.cal__view--on');
      const add = r('.cal__add');
      const keb = r('.cal__kebab');
      return {
        arwLeft: arw?.left ?? -1,
        nowLeft: now?.left ?? -1,
        wordLeft: first?.left ?? -1,
        arwH: Math.round(arw?.height ?? -1),
        nowH: Math.round(now?.height ?? -1),
        addH: Math.round(add?.height ?? -1),
        kebH: Math.round(keb?.height ?? -1),
        litH: Math.round(lit?.height ?? -1),
      };
    });
    // Order: arrows, then Now, then the words.
    expect(geom.arwLeft).toBeLessThan(geom.nowLeft);
    expect(geom.nowLeft).toBeLessThan(geom.wordLeft);
    // ONE ROW, ONE HEIGHT — the four controls agree, and none of them towers
    // over the lit view word.
    expect(geom.arwH).toBe(28);
    expect(geom.addH).toBe(28);
    expect(geom.kebH).toBe(28);
    expect(geom.nowH).toBeLessThanOrEqual(28);
    expect(geom.arwH, 'a control outgrew the word it operates on').toBeLessThanOrEqual(
      geom.litH + 6,
    );
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

  test('A DAY OUTSIDE THE MONTH KEEPS ITS NUMBER, AND ONLY THE NUMBER FADES', async ({
    page,
  }) => {
    // REVERSED on 2026-08-01, by Marco. The old law said the missing number
    // WAS the mark. It was right about the content and wrong about the
    // number: a venue in August is not a weaker claim and must not be fainter
    // ink — but the number is not a claim at all, it is the orientation, and
    // five blank cells at the head of a sheet ask the reader to count.
    await planner(page, 'month');
    const out = await page.evaluate(() => {
      const num = (sel: string) => {
        const el = document.querySelector(sel);
        return el ? { text: (el.textContent ?? '').trim(), color: getComputedStyle(el).color } : null;
      };
      return {
        outside: num('.cal__day--out .cal__day-num'),
        inside: num('.cal__day:not(.cal__day--out) .cal__day-num'),
        // The CONTENT of an out-of-month day is never dimmed — only the number.
        dimmedContent: [...document.querySelectorAll('.cal__day--out')].filter(
          (c) => parseFloat(getComputedStyle(c).opacity) < 1,
        ).length,
      };
    });
    expect(out.outside?.text, 'an out-of-month day lost its number').toBeTruthy();
    expect(out.dimmedContent, 'an out-of-month cell faded its content').toBe(0);
    // Alpha: the outside number is the faintest thing in the header.
    const alpha = (c: string | undefined) =>
      Number(/\/\s*([\d.]+)\s*\)/.exec(c ?? '')?.[1] ?? '1');
    expect(alpha(out.outside?.color), 'the outside number is not attenuated').toBeLessThan(
      alpha(out.inside?.color),
    );
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
        expect(m.h, `${view}: the tile grew`).toBeLessThanOrEqual(12);
        expect(m.radius, `${view}: the corner is too round for this size`).toBeLessThanOrEqual(3);
        expect(m.ring, `${view}: the ring came back`).toBe('none');
      }
    }
  });
});

test.describe('the clash', () => {
  test.skip(!EMAIL || !PASSWORD, 'Set PW_TEST_EMAIL / PW_TEST_PASSWORD.');

  test('THE MARK AND THE RULE NEVER DISAGREE ABOUT HOW BAD IT IS', async ({ page }) => {
    // One day printed a BLUE `!` on the number and a RED rule down the two
    // cards beneath it — two levels of alarm about one collision. The rule's
    // colour is now bound to the mark's own test (people/blackout → red,
    // everything else → the «decide» blue), so the two cannot drift apart.
    await planner(page, 'month');
    const days = await page.evaluate(() =>
      [...document.querySelectorAll('.cal__wkc')].flatMap((wk) =>
        [...wk.querySelectorAll('.cal__day')]
          .map((cell, i) => {
            const rules = [...cell.querySelectorAll('.slip[data-clash]')];
            if (rules.length === 0) return null;
            const num = wk.querySelectorAll('.cal__num')[i];
            const mark = num?.querySelector('.cal__mark');
            return {
              markRed: mark ? getComputedStyle(mark).color : null,
              ruleRed: rules.map((r) => getComputedStyle(r).borderLeftColor),
            };
          })
          .filter(Boolean),
      ),
    );
    // Every day that draws a rule also draws a mark: the rule is the pair, the
    // mark is the day, and a pair implies a day.
    for (const d of days) {
      expect(d!.markRed, 'a clash rule with no mark above it').not.toBeNull();
      // Same hue family on both. `!` and the rule are the same fact.
      // Third field, and NEVER the last one: `color-mix` emits an alpha
      // (`oklch(L C H / A)`), so a greedy «last number before the paren» reads
      // 0.65 as the hue and every mixed rule looks like a disagreement. The
      // law was wrong, not the drawing — checked against the real values.
      const HUE = /oklch\(\s*[\d.%]+\s+[\d.]+\s+([\d.]+)/;
      const markHue = HUE.exec(d!.markRed!)?.[1];
      for (const rule of d!.ruleRed) {
        const ruleHue = HUE.exec(rule)?.[1];
        if (markHue && ruleHue) {
          expect(Math.abs(Number(markHue) - Number(ruleHue)), 'mark and rule disagree').toBeLessThan(
            40,
          );
        }
      }
    }
  });
});

test.describe('the diary', () => {
  test.skip(!EMAIL || !PASSWORD, 'Set PW_TEST_EMAIL / PW_TEST_PASSWORD.');

  test('IT OPENS AT TODAY AND GROWS ONE MONTH PER GESTURE — never runs away', async ({ page }) => {
    // A flick of the wheel used to fetch 822 days: `html` carries
    // `scroll-behavior: smooth`, so the anchoring correction ANIMATED, never
    // landed before the next prepend measured, and the reader stayed pinned
    // at the top with the sentinel permanently in view.
    await planner(page, 'agenda');
    const span = () =>
      page.evaluate(() => {
        const d = [...document.querySelectorAll('[data-day]')]
          .map((e) => (e as HTMLElement).dataset.day ?? '')
          .sort();
        return { n: d.length, first: d[0] ?? '', y: Math.round(window.scrollY) };
      });
    const start = await span();
    // Opens on today, not on two years of history.
    expect(start.n, 'the diary opened with a runaway span').toBeLessThan(200);

    await page.mouse.move(800, 500);
    await page.mouse.wheel(0, -600);
    await page.waitForTimeout(1800);
    const back = await span();
    expect(back.n, 'scrolling up loaded nothing').toBeGreaterThan(start.n);
    expect(back.n - start.n, 'one gesture fetched more than two months').toBeLessThan(70);
    // …and the reader was pinned to their row rather than thrown backwards.
    expect(back.y, 'the prepend was not anchored').toBeGreaterThan(0);
  });

  test('`NOW` LANDS ON TODAY', async ({ page }) => {
    // A long smooth journey across a diary that is loading while it runs can
    // be cut short by one anchoring correction — measured 5.760px short.
    await planner(page, 'agenda');
    await page.mouse.move(800, 500);
    await page.mouse.wheel(0, -600);
    await page.waitForTimeout(1500);
    await page.click('.cal__now');
    const measure = () =>
      page.evaluate(() => {
        const el = document.querySelector('[data-day].is-today, [data-day]');
        const today = new Date().toISOString().slice(0, 10);
        const t = document.querySelector(`[data-day="${today}"]`);
        return t ? Math.round(t.getBoundingClientRect().top) : el ? 9999 : null;
      });
    if ((await measure()) === null) test.skip(true, 'today is not in this diary');
    // POLLED, NOT SLEPT ON. A fixed wait measures a smooth journey wherever it
    // happens to be when the clock runs out: against a deployed origin the
    // diary is still fetching while the scroll runs. The law is «it lands»,
    // not «it lands within 2.5 seconds».
    //
    // AND IT LANDS UNDER THE CHROME, NOT UNDER THE HEADER. This file had never
    // run green — the auth setup broke on 2026-07-31 and the E2E needs a
    // deployed origin — so `< 8` was a guess, and it asked for today to sit 8
    // pixels from the VIEWPORT top with 90px of sticky shell and toolbar over
    // it.
    //
    // `< fold / 2` WAS THE NEXT GUESS, and it lasted sixteen days. It was
    // written the day this first ran green, when today happened to land at
    // 277 — «the upper third» — and that number was read back as if it were
    // the law. It is not. How far down today lands depends on how much diary
    // chrome sits above it: the month heading, and the week band's own header
    // when today is the FIRST day of its band. On 2026-08-27 it was, today
    // landed at 413, and this went red at 800 tall without the app having
    // changed a line since the deploy.
    //
    // So it now asserts the law the paragraph above already stated, and only
    // that: today is ON SCREEN and CLEAR OF THE STICKY CHROME. Neither half
    // carries a number of its own — twice now a measurement taken on one day's
    // data has been written down as if it were a law.
    const fold = page.viewportSize()?.height ?? 800;
    await expect
      .poll(async () => (await measure()) ?? 9999, {
        timeout: 15_000,
        message: '`Now` did not land on today',
      })
      .toBeLessThan(fold);
    const top = (await measure())!;
    expect(top, 'today was scrolled past').toBeGreaterThanOrEqual(0);
    // …AND IT IS NOT SITTING UNDER THE SHELL. Hit-tested, not compared against
    // a chrome height: the first attempt at that measured every sticky box on
    // the page and caught the rail, which is 720 tall, so it demanded today
    // land below the fold it was meant to keep it above. The point just inside
    // today's own top edge must belong to today; if the furniture pinned over
    // the page owns it, today is buried.
    const occluded = await page.evaluate(() => {
      const key = new Date().toISOString().slice(0, 10);
      const el = document.querySelector(`[data-day="${key}"]`);
      if (!el) return true;
      const r = el.getBoundingClientRect();
      const hit = document.elementFromPoint(
        Math.round(r.left + Math.min(40, r.width / 2)),
        Math.round(r.top + 4),
      );
      return !hit || !(el === hit || el.contains(hit));
    });
    expect(occluded, 'today landed under the sticky chrome').toBe(false);
  });
});
