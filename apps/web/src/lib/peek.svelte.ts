/**
 * The vistazo's navigation (ADR-139 p1 A): open, follow, close. The pure
 * vocabulary is `$lib/peek`.
 *
 * Opening pushes a shallow entry (no load runs, the lens underneath keeps
 * its state and its scroll) whose `page.state.peekDepth` counts how many
 * peeks deep we are. Closing goes back that many entries, so Esc returns to
 * exactly where you were, and Back after a peek that followed a link steps
 * to the previous peek, like any page. A peek that came in with the address
 * (a pasted link, a reload) has no entries under it: closing rewrites the
 * address without it.
 *
 * Shallow routing never moves `page.url` (see tests/scope-url.spec.ts), so
 * the truth is `location.href`, read again whenever `page.state` or
 * `page.url` changes.
 */

import { goto, pushState, replaceState } from '$app/navigation';
import { page } from '$app/state';
import { MOBILE_QUERY } from './breakpoints';
import { PEEK_PARAM, fullHref, parsePeek, samePeek, withPeek, type PeekTarget } from './peek';

type PeekState = App.PageState & { peekDepth?: number };

function depthOf(state: unknown): number {
  const d = (state as PeekState | undefined)?.peekDepth;
  return typeof d === 'number' && d > 0 ? d : 0;
}

/** What the address bar has open now (reactive inside `$derived`). */
export function currentPeek(): PeekTarget | null {
  void page.url;
  void page.state;
  if (typeof location === 'undefined') return null;
  return parsePeek(new URL(location.href).searchParams.get(PEEK_PARAM));
}

export function openPeek(t: PeekTarget): void {
  // On a phone a thing with a page opens its page (ADR-248, `peekOpensFrom`).
  if (t.kind !== 'date' && t.kind !== 'bolo' && typeof matchMedia === 'function' && matchMedia(MOBILE_QUERY).matches) {
    const href = fullHref(t);
    if (href) {
      void goto(href);
      return;
    }
  }
  const here = new URL(location.href);
  if (samePeek(parsePeek(here.searchParams.get(PEEK_PARAM)), t)) return;
  pushState(withPeek(here, t), { ...page.state, peekDepth: depthOf(page.state) + 1 });
}

export function closePeek(): void {
  const depth = depthOf(page.state);
  if (depth > 0) {
    history.go(-depth);
    return;
  }
  const here = new URL(location.href);
  if (!here.searchParams.has(PEEK_PARAM)) return;
  replaceState(withPeek(here, null), { ...page.state, peekDepth: 0 });
}
