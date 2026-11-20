/**
 * The boot skeleton (app.html, 20-11-2026): shown from the first paint of an
 * app open until the frame has something to draw, so an open never looks
 * like a blank, broken page. `bootDone` takes it away with a short fade; it
 * is idempotent, and a page that never calls it (a crash, a route that does
 * not know about it) still loses it after `BOOT_MAX_MS`.
 */

export const BOOT_MAX_MS = 12_000;
const FADE_MS = 160;

let done = false;

export function bootDone(): void {
  if (done || typeof document === 'undefined') return;
  done = true;
  const root = document.documentElement;
  if (!root.hasAttribute('data-boot')) return;
  root.setAttribute('data-boot-leaving', '');
  setTimeout(() => {
    root.removeAttribute('data-boot');
    root.removeAttribute('data-boot-leaving');
  }, FADE_MS);
}

/** The ceiling: whatever happens, the skeleton never stays longer than this. */
export function bootDeadline(): void {
  if (typeof window === 'undefined') return;
  setTimeout(bootDone, BOOT_MAX_MS);
}
