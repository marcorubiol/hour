import en from './en.json';
import { currentTrade, DEFAULT_TRADE, type Trade } from './trade.svelte';

export { currentTrade, setTrade, tradeOf, TRADES, type Trade } from './trade.svelte';

type Dictionary = Record<string, string>;

/** The one list of languages the app speaks, in the order a picker shows them. */
export const LOCALES = ['ca', 'es', 'en', 'fr'] as const;

export type Locale = (typeof LOCALES)[number];

/**
 * English is the fallback, so it ships with every page. The other three are
 * one chunk each, fetched when a page needs one (`loadLocale`): a browser
 * used to download and parse all four (583 kB) on every open to speak one.
 * The server and the tests have all four from the start.
 */
const others = import.meta.glob<Dictionary>(['./*.json', '!./en.json'], { import: 'default' });
const dictionaries: Partial<Record<Locale, Dictionary>> = {
  en,
  ...(import.meta.env.SSR || import.meta.env.MODE === 'test'
    ? Object.fromEntries(
        Object.entries(
          import.meta.glob<Dictionary>(['./*.json', '!./en.json'], { import: 'default', eager: true }),
        ).map(([path, dict]) => [path.slice(2, -5), dict]),
      )
    : {}),
};

/**
 * Make `locale` answer `t()`. The root layout awaits the session's locale
 * before anything renders; a page that speaks another one awaits its own.
 */
export async function loadLocale(locale: Locale): Promise<void> {
  if (dictionaries[locale]) return;
  const load = others[`./${locale}.json`];
  if (load) dictionaries[locale] = await load();
}

/** Every language at once, for what recognises words in all of them. */
export function loadAllLocales(): Promise<void[]> {
  return Promise.all(LOCALES.map(loadLocale));
}

/** BCP 47 tag each locale formats dates with (Intl). */
export const LOCALE_TAG: Record<Locale, string> = { ca: 'ca-ES', es: 'es-ES', en: 'en-GB', fr: 'fr-FR' };

/**
 * Dictionary lookup with {name} interpolation. The trade's variant
 * (`key@music`, ADR-128) wins when the dictionary has one; otherwise the
 * plain key, which speaks stage. Missing keys fall back to the English
 * dictionary, then to the key itself — a sparse locale file never blanks the UI.
 */
export function t(
  key: string,
  locale: Locale = 'en',
  params?: Record<string, string | number>,
  trade: Trade = currentTrade(),
): string {
  const dict: Dictionary = dictionaries[locale] ?? en;
  const fallback: Dictionary = en;
  const variant = trade === DEFAULT_TRADE ? undefined : `${key}@${trade}`;
  let out =
    (variant && dict[variant]) ?? dict[key] ?? (variant && fallback[variant]) ?? fallback[key] ?? key;
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
  return (LOCALES as readonly string[]).includes(base) ? (base as Locale) : 'en';
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
