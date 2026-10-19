/**
 * The browser tab's title, one shape for every screen (ADR-130 § 5): what the
 * screen is, most specific first, then «Hour», joined by « · ». Nothing to name is
 * «Hour» alone. A screen that sets no title keeps the previous page's in the
 * tab (the Hall said «Hour, Sign in» after a login), so every page sets one.
 */
export function docTitle(...parts: (string | null | undefined)[]): string {
  return [...parts.map((p) => p?.trim()).filter(Boolean), 'Hour'].join(' · ');
}
