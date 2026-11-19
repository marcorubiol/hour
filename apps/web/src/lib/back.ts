/**
 * «Volver» on a record's whole page (ADR-228, fase 3 de ADR-223): back goes
 * where you were, not to a fixed place. The app counts its own link
 * navigations since the document loaded (`noteNavigation`, fed by the /h
 * layout): above 0 there is an entry under this one that is the app's (the
 * lens you came from). With none (a pasted link, a new tab, a reload) it
 * falls to the fallback, Hoy. `history.state`'s index is no help: SvelteKit
 * starts it at a timestamp, not at 0.
 *
 * Only link clicks count (they always push an entry); `goto` may replace
 * the entry, so it counts for nothing and the fallback stays the safe side.
 * A Back or Forward (popstate) moves the count by its `delta`.
 */
let depth = 0;

export interface NavigationNote {
  type: string;
  delta?: number;
}

export function noteNavigation(nav: NavigationNote): void {
  if (nav.type === 'link') depth += 1;
  else if (nav.type === 'popstate' && typeof nav.delta === 'number') depth = Math.max(0, depth + nav.delta);
}

export function hasAppEntryBefore(): boolean {
  return depth > 0;
}

/** For tests. */
export function resetNavigationDepth(): void {
  depth = 0;
}

/** Click handler for a «Volver» link whose `href` is the fallback: it
    steps back through the history when there is an app entry to step to,
    and lets the link go to the fallback otherwise. */
export function backThroughHistory(event: MouseEvent): void {
  if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
  if (!hasAppEntryBefore()) return;
  event.preventDefault();
  history.back();
}
