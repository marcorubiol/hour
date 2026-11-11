/**
 * The two named cuts of the app (tarea 134). A media query cannot read a
 * custom property, so the CSS writes these values literally and
 * `styles/breakpoints-guard.test.ts` keeps every `@media` on them; script
 * reads them from here.
 *
 *   mobile     below 48rem: one column, the lens bar at the bottom, the
 *              phone's type scale (tokens.css). `max-width: 47.999rem` /
 *              `min-width: 48rem`.
 *   two panes  from 75rem: a list and the open record side by side
 *              (Conversaciones, ADR-176).
 *
 * Any other width in a media query carries a `cut:` comment right above it
 * saying why (the rail at 64rem, the login's two columns at 55rem).
 */
export const MOBILE_UNDER = '48rem';
export const TWO_PANES_FROM = '75rem';

export const MOBILE_QUERY = `(max-width: 47.999rem)`;
export const TWO_PANES_QUERY = `(min-width: ${TWO_PANES_FROM})`;
