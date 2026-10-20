/**
 * The outbound half of «scope ⇄ URL» (ADR-067): the address a lens should
 * carry for the pins on screen, or null when nothing is to be written.
 *
 * `routerReady` is load-bearing, not a nicety. SvelteKit's `replaceState`
 * (shallow routing) ends in `root.$set(...)`, and `root` is assigned only
 * when the first mount RETURNS. Effects flush inside that mount, so a write
 * from the shell's first run hits an undefined root: in a build it throws
 * `Cannot read properties of undefined (reading '$set')` and the whole app
 * stays blank (in dev it is «Cannot call replaceState(...) before router is
 * initialized»). The first run writes exactly when there are saved pins and
 * the URL has no `?scope=`: a full load of any lens with a saved scope
 * (2026-10-20, prod 4ffc6b6e). Ready = the first `afterNavigate` has fired.
 */
export function scopeUrlToWrite(href: string, serialized: string, routerReady: boolean): URL | null {
  if (!routerReady) return null;
  const url = new URL(href);
  const existing = url.searchParams.get('scope');
  if (serialized === (existing ?? '')) return null;
  if (serialized) url.searchParams.set('scope', serialized);
  else url.searchParams.delete('scope');
  // URLSearchParams serializes as form-urlencoded, escaping ':' ',' '/'
  // (%3A/%2C/%2F) — all legal bare in a query per RFC 3986, and the
  // parser reads either form identically. Un-escape so the address bar
  // shows the tokens as designed: ?scope=s:muk-cia,p:muk-cia/mamemi.
  const qs = url.searchParams.toString().replace(/%3A/gi, ':').replace(/%2C/gi, ',').replace(/%2F/gi, '/');
  url.search = qs ? `?${qs}` : '';
  return url;
}
