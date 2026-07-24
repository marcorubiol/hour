/**
 * Render-time URL allow-list for user/tenant-controlled links.
 *
 * `v.url()` at the API boundary only runs `new URL()`, which accepts
 * `javascript:` and `data:` — so a stored material/website URL can carry a
 * script payload. The CSP (`script-src 'self'`) blocks the navigation today,
 * but CSP must not be the only barrier: any link sink that renders
 * tenant-authored URLs should pass through here so the scheme is vetted at
 * the point of use, independent of how the value was stored (API, seed,
 * import, migration).
 *
 * Returns the URL only for the safe schemes; otherwise `undefined`, which on
 * an `<a href={...}>` yields a non-navigable link rather than a live sink.
 */
const SAFE_SCHEMES = new Set(['http:', 'https:', 'mailto:', 'tel:']);

export function safeHref(raw: string | null | undefined): string | undefined {
  if (!raw) return undefined;
  const value = raw.trim();
  if (!value) return undefined;
  // Protocol-relative ('//host') and path/anchor-relative links are same-origin
  // by resolution and carry no dangerous scheme — let them through as-is.
  if (value.startsWith('/') || value.startsWith('#') || value.startsWith('?')) return value;
  try {
    const scheme = new URL(value).protocol;
    return SAFE_SCHEMES.has(scheme) ? value : undefined;
  } catch {
    return undefined;
  }
}
