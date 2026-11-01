/**
 * How long a real phone waits for Hoy (ADR-157).
 *
 * Sentry's pageload transaction already carries the Web Vitals (LCP, FCP,
 * TTFB, CLS). What it cannot know is when Hoy has drawn its data: this adds
 * `hoy.content`, the milliseconds from the document's start to the Desk's
 * first `aria-busy` false, the same law the E2E waits for. Only for an open
 * that lands on Hoy (the home-screen app's `/`, or `/h/desk` itself): after a
 * client-side navigation the document's clock means nothing.
 *
 * It is a number on the transaction, with one flag (whether the frame
 * painted from the device cache). No URL, no id, nothing about the person.
 */

import { getActiveSpan, getRootSpan, setMeasurement } from '@sentry/sveltekit';

const LANDS_ON_HOY = new Set(['/', '/h', '/h/desk']);
let marked = false;

export function markHoyContent(fromDevice: boolean): void {
  if (marked) return;
  marked = true;
  const nav = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined;
  if (!nav || !LANDS_ON_HOY.has(new URL(nav.name).pathname)) return;
  const active = getActiveSpan();
  if (!active) return;
  const root = getRootSpan(active);
  root.setAttribute('hoy.from_device', fromDevice);
  setMeasurement('hoy.content', Math.round(performance.now()), 'millisecond', root);
}
