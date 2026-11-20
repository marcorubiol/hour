/**
 * Don't paint a page before its stylesheets (20-11-2026, the open's flash).
 *
 * On every open the home-screen app lands on `/`, which starts
 * `preloadCode('/h/today')` and then `goto`s there. Vite's preload helper
 * remembers each file it has asked for as `true`, not as the promise of its
 * load: the second import of the same nodes (the `goto`) sees the CSS as
 * «already requested» and resolves at once, while the `<link>` the first one
 * added is still loading. The page rendered with only the global styles:
 * links in their default colour and underline, no card backgrounds, no project
 * colours (Marco's two captures, 07:17 and 07:20). A hover preload, or any
 * other `preloadCode`, followed by a click does the same.
 *
 * `trackStylesheets` marks every `<link rel=stylesheet>` when it loads or
 * fails (capture listeners on the document: those events don't bubble).
 * `stylesheetsSettled` resolves once every stylesheet in the document has
 * done one or the other, or after `timeoutMs`, so a slow or broken file never
 * holds the screen for long. The root layout returns it from `onNavigate`,
 * which makes SvelteKit wait before it renders the new page.
 */

const SETTLED = 'data-settled';

let tracking = false;

function isStylesheet(el: EventTarget | null): el is HTMLLinkElement {
  return el instanceof HTMLLinkElement && el.rel === 'stylesheet';
}

/** Start marking stylesheets as they load or fail. Idempotent; browser only. */
export function trackStylesheets(doc: Document = document): void {
  if (tracking) return;
  tracking = true;
  const mark = (e: Event) => {
    if (isStylesheet(e.target)) e.target.setAttribute(SETTLED, '');
  };
  doc.addEventListener('load', mark, true);
  doc.addEventListener('error', mark, true);
}

/** A stylesheet still on its way: not marked, and no sheet parsed yet. */
function pending(link: HTMLLinkElement): boolean {
  return !link.hasAttribute(SETTLED) && link.sheet === null;
}

/** Resolves when no stylesheet in `doc` is still loading, or after `timeoutMs`. */
export function stylesheetsSettled(doc: Document = document, timeoutMs = 2500): Promise<void> | undefined {
  const waiting = [...doc.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"]')].filter(pending);
  if (waiting.length === 0) return undefined;
  const each = waiting.map(
    (link) =>
      new Promise<void>((resolve) => {
        link.addEventListener('load', () => resolve(), { once: true });
        link.addEventListener('error', () => resolve(), { once: true });
        // It may have settled between the filter and the listeners.
        if (!pending(link)) resolve();
      }),
  );
  return Promise.race([
    Promise.all(each).then(() => undefined),
    new Promise<void>((resolve) => setTimeout(resolve, timeoutMs)),
  ]);
}
