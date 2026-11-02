import { describe, expect, test } from 'vitest';
import { pageUrl, requestedLocale } from './audience-form';

describe('the public audience form', () => {
  test('?lang= wins when it is one of ours; otherwise the browser', () => {
    expect(requestedLocale(new URL('https://h/x?lang=ca'), 'en-GB')).toBe('ca');
    expect(requestedLocale(new URL('https://h/x?lang=de'), 'fr-FR,fr')).toBe('fr');
    expect(requestedLocale(new URL('https://h/x'), null)).toBeTruthy();
  });

  test('the framing page kept as proof is an http(s) URL of at most 2,048 characters', () => {
    expect(pageUrl('https://muk.example/agenda')).toBe('https://muk.example/agenda');
    expect(pageUrl('javascript:alert(1)')).toBeNull();
    expect(pageUrl(`https://x/${'a'.repeat(2048)}`)).toBeNull();
    expect(pageUrl(null)).toBeNull();
  });
});
