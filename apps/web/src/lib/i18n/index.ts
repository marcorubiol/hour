import ca from './ca.json';
import en from './en.json';
import es from './es.json';
import fr from './fr.json';

const dictionaries = { ca, es, en, fr } as const;

export type Locale = keyof typeof dictionaries;

/** The one list of languages the app speaks, in the order a picker shows them. */
export const LOCALES = Object.keys(dictionaries) as Locale[];

/** BCP 47 tag each locale formats dates with (Intl). */
export const LOCALE_TAG: Record<Locale, string> = { ca: 'ca-ES', es: 'es-ES', en: 'en-GB', fr: 'fr-FR' };

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

/**
 * The session's locale, read where it lives today (the browser). English
 * when there is no browser (SSR, server routes), so a server render never
 * guesses a language.
 */
export function appLocale(): Locale {
  return detectLocale(typeof navigator !== 'undefined' ? navigator.language : null);
}

/** BCP 47 tag of the session's locale, for Intl date formatting. */
export function appLocaleTag(): string {
  return LOCALE_TAG[appLocale()];
}
