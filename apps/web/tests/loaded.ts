import { expect, type Page } from '@playwright/test';

/**
 * THE PAGE HAS LOADED, AS A LAW AND NOT AS A NUMBER.
 *
 * Every lens and detail page in the shell carries `aria-busy` on its root
 * while the data it draws is still arriving (and some regions inside it, like
 * the conversations table, say their own). It is real accessibility, and it
 * is the one signal the app gives that does not depend on what the data
 * happens to contain that day.
 *
 * Why this exists: the first `expect` of a spec used to wait its 5 s for
 * something that, against production and above all right after a deploy,
 * arrived later. A different spec went red every pass and each passed alone.
 * Raising the budget was tried (15 s, 2026-10-09) and the reds just moved:
 * a bigger number is still a guess about a day's latency. So the spec waits
 * for what it means: the page has drawn its loading state, and nothing in
 * `main` is still loading.
 *
 * `timeout: 0` hands the bound to the test's own budget instead of inventing
 * one here. Call it right after a full `page.goto` (or a `waitForURL` that
 * lands on a new page): during a client-side navigation the previous page's
 * settled root can still be in the DOM for a moment.
 */
export async function waitForLoaded(page: Page): Promise<void> {
  const main = page.getByRole('main');
  await expect(main.locator('[aria-busy]').first(), 'the page has mounted').toBeAttached({
    timeout: 0,
  });
  await expect(main.locator('[aria-busy="true"]'), 'nothing on the page is still loading').toHaveCount(0, {
    timeout: 0,
  });
}
