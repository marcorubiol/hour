/**
 * «Volver» on a record's whole page (ADR-228, fase 3 de ADR-223): back goes
 * where you were, not to a fixed place. SvelteKit writes the entry's index
 * in `history.state`; above 0 there is an entry under this one that is the
 * app's (the lens you came from, a vistazo's page). With none (a pasted
 * link, a new tab) it falls to the fallback, Hoy.
 */
const HISTORY_INDEX = 'sveltekit:history';

export function hasAppEntryBefore(): boolean {
  if (typeof history === 'undefined') return false;
  const index = (history.state as Record<string, unknown> | null)?.[HISTORY_INDEX];
  return typeof index === 'number' && index > 0;
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
