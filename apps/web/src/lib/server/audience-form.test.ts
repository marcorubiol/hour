import { describe, expect, test } from 'vitest';
import { framingPage, pageUrl, requestedLocale } from './audience-form';
import { clientSentryMode } from '$lib/public-route';

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

  test('the framing page is the Referer only when it comes from another site', () => {
    const own = new URL('https://hour.zerosense.studio/public/audience/x/embed');
    expect(framingPage('https://muk.example/agenda', own)).toBe('https://muk.example/agenda');
    expect(framingPage('https://muk.example/', own)).toBe('https://muk.example/');
    expect(framingPage('https://hour.zerosense.studio/public/audience/x/embed?lang=ca', own)).toBeNull();
    expect(framingPage(null, own)).toBeNull();
  });
});

describe('client Sentry on public pages (ADR-175)', () => {
  test('off inside the iframe, without Replay on token pages, full elsewhere', () => {
    expect(clientSentryMode(`/public/audience/${'a'.repeat(32)}/embed`)).toBe('off');
    expect(clientSentryMode(`/c/${'b'.repeat(64)}`)).toBe('no-replay');
    expect(clientSentryMode(`/u/${'c'.repeat(48)}`)).toBe('no-replay');
    expect(clientSentryMode(`/public/audience/${'a'.repeat(32)}`)).toBe('full');
    expect(clientSentryMode('/h/conversations')).toBe('full');
  });
});
