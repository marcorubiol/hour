import en from './en.json';
import es from './es.json';

const dictionaries = { en, es } as const;

export type Locale = keyof typeof dictionaries;

export function t(key: string, locale: Locale = 'en'): string {
  const dict = dictionaries[locale] as Record<string, string>;
  return dict[key] ?? key;
}
