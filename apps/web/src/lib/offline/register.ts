/**
 * Service Worker registration — D-PRE-13 (silent updates, install on next
 * tab restart, no banners).
 *
 * vite-plugin-pwa generates `virtual:pwa-register` which under the hood
 * calls `navigator.serviceWorker.register('/sw.js')` with our config.
 * We use the explicit form so we can:
 *
 *   1. Skip registration under Playwright (`navigator.webdriver`) — keeps
 *      the smoke test deterministic and avoids polluting the test
 *      browser's SW state across runs.
 *   2. Provide empty `onNeedRefresh` / `onOfflineReady` callbacks — Workbox
 *      defaults would surface UI prompts; we silently let the new SW move
 *      to "waiting" and activate on the next tab open (skipWaiting:false
 *      from vite.config.ts).
 *
 * Idempotent — calling twice does nothing extra.
 */

import { browser } from '$app/environment';

let registered = false;

export async function registerServiceWorker(): Promise<void> {
  if (registered) return;
  if (!browser) return;
  if (!('serviceWorker' in navigator)) return;
  // Playwright + Selenium + WebdriverIO all set this. Skip SW in test runs.
  if (navigator.webdriver) return;

  registered = true;

  const { registerSW } = await import('virtual:pwa-register');
  registerSW({
    immediate: false,
    onNeedRefresh() {
      // Silent — D-PRE-13. The waiting SW will activate on next tab open.
    },
    onOfflineReady() {
      // Silent — first-install offline-ready notification suppressed.
    },
  });
}
