import en from './en.json';
import { currentTrade, DEFAULT_TRADE, voiceHere, type Voice } from './trade.svelte';

export {
  currentTrade,
  setRecordSpace,
  setTrade,
  setWorkspaceTrades,
  tradeFor,
  tradeOf,
  TRADES,
  type Trade,
  type Voice,
} from './trade.svelte';

type Dictionary = Record<string, string>;

/** The one list of languages the app speaks, in the order a picker shows them. */
export const LOCALES = ['ca', 'es', 'en', 'fr'] as const;

export type Locale = (typeof LOCALES)[number];

/** Each language in its own words: a picker is read by whoever does not speak the current one. */
export const LOCALE_NAME: Record<Locale, string> = { ca: 'Català', es: 'Español', en: 'English', fr: 'Français' };

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
 * Dictionary lookup with {name} interpolation. The voice's variant
 * (`key@music`, ADR-128; `key@mixed` for a screen of mixed trades, tarea
 * 142) wins when the dictionary has one; otherwise the plain key, which
 * speaks stage. The voice is the screen's unless the caller passes one: a
 * row passes its own space's, `tradeFor(row.workspace_id)`. Missing keys fall back to the English
 * dictionary, then to the key itself — a sparse locale file never blanks the UI.
 */
export function t(
  key: string,
  locale: Locale = 'en',
  params?: Record<string, string | number>,
  voice: Voice = currentTrade(),
): string {
  const dict: Dictionary = dictionaries[locale] ?? en;
  const fallback: Dictionary = en;
  const variant = voice === DEFAULT_TRADE ? undefined : `${key}@${voice}`;
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
 * `t()` for a component inside a record (tarea 142 C): the same lookup, in
 * the voice of the record's space (`setRecordSpace`) instead of the
 * screen's. A component takes it once, `const t = tHere();`, and its calls
 * stay as they are. Outside a record it is the screen's voice, so a
 * component also mounted elsewhere (the planner, the public road sheet)
 * reads exactly as before. Called while the component initialises.
 */
export function tHere(): (key: string, locale?: Locale, params?: Record<string, string | number>) => string {
  const voice = voiceHere();
  return (key, locale, params) => t(key, locale, params, voice());
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
 * The language someone picked at the door (login, sign-up, invitation,
 * ADR-169). A cookie, not localStorage: the server reads it too, so the door
 * renders in that language before any script runs, and every screen after
 * entering keeps it. Not httpOnly on purpose: it is a preference, not a secret.
 */
export const LOCALE_COOKIE = 'hour_locale';

/** A cookie value that names one of the app's languages, or null. */
export function localeFromCookie(value: string | null | undefined): Locale | null {
  return value && (LOCALES as readonly string[]).includes(value) ? (value as Locale) : null;
}

/** The locale a request asks for: the chosen one, else the first of Accept-Language. */
export function requestLocale(cookie: string | null | undefined, acceptLanguage: string | null | undefined): Locale {
  return localeFromCookie(cookie) ?? detectLocale(acceptLanguage?.split(',')[0]?.trim());
}

function chosenLocale(): Locale | null {
  if (typeof document === 'undefined') return null;
  const match = document.cookie.match(new RegExp(`(?:^|; )${LOCALE_COOKIE}=([^;]*)`));
  return localeFromCookie(match?.[1]);
}

/** Keep `locale` for this device, a year (the door's picker). */
export function chooseLocale(locale: Locale): void {
  if (typeof document === 'undefined') return;
  document.cookie = `${LOCALE_COOKIE}=${locale}; path=/; max-age=31536000; samesite=lax`;
}

/**
 * The session's locale: the one chosen at the door, else the browser's.
 * English when there is no browser (SSR, server routes), so a server render
 * never guesses a language; a server page that renders words asks
 * `requestLocale` instead.
 */
export function appLocale(): Locale {
  return chosenLocale() ?? detectLocale(typeof navigator !== 'undefined' ? navigator.language : null);
}

/** BCP 47 tag of the session's locale, for Intl date formatting. */
export function appLocaleTag(): string {
  return LOCALE_TAG[appLocale()];
}
