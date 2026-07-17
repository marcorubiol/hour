import ca from './ca.json';
import en from './en.json';
import es from './es.json';

const dictionaries = { en, es, ca } as const;

export type Locale = keyof typeof dictionaries;

/**
 * Dictionary lookup with {name} interpolation. Missing keys fall back to
 * the English dictionary, then to the key itself — a sparse locale file
 * never blanks the UI.
 */
export function t(
  key: string,
  locale: Locale = 'en',
  params?: Record<string, string | number>,
): string {
  const dict = dictionaries[locale] as Record<string, string>;
  const fallback = dictionaries.en as Record<string, string>;
  let out = dict[key] ?? fallback[key] ?? key;
  if (params) {
    for (const [name, value] of Object.entries(params)) {
      out = out.replaceAll(`{${name}}`, String(value));
    }
  }
  return out;
}

/**
 * Best-available locale for this session. TODO: the intended source is
 * user_profile.locale (the column exists in the DB, unwired to the client
 * yet — screen-data-spec § profile); until it's plumbed, the browser's
 * language decides.
 */
export function detectLocale(language: string | null | undefined): Locale {
  const base = (language ?? '').toLowerCase().split('-')[0];
  return base in dictionaries ? (base as Locale) : 'en';
}
