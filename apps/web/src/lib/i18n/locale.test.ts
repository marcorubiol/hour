import { describe, expect, test } from 'vitest';
import { localeFromCookie, requestLocale } from './index';

describe('the door language (ADR-169)', () => {
  test('a chosen language wins over the browser', () => {
    expect(requestLocale('ca', 'fr-FR,fr;q=0.9')).toBe('ca');
  });

  test('without a choice, the first Accept-Language', () => {
    expect(requestLocale(undefined, 'es-ES,es;q=0.9,en;q=0.8')).toBe('es');
  });

  test('a language the app does not speak falls to English', () => {
    expect(requestLocale(undefined, 'de-DE')).toBe('en');
    expect(requestLocale('de', null)).toBe('en');
  });

  test('only the app languages are read back from the cookie', () => {
    expect(localeFromCookie('fr')).toBe('fr');
    expect(localeFromCookie('xx')).toBeNull();
    expect(localeFromCookie('')).toBeNull();
  });
});
