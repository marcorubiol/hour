import { describe, expect, test } from 'vitest';
import { applyFrameHeaders, frameableCsp, isEmbedPath } from './frame';

const KEY = '0123456789abcdef0123456789abcdef';
const CSP = "default-src 'self'; script-src 'self' 'nonce-x'; frame-ancestors 'none'; form-action 'self'";
const SECURITY = { 'x-content-type-options': 'nosniff', 'x-frame-options': 'DENY' };

function headersFor(pathname: string): Headers {
  const h = new Headers({ 'content-security-policy': CSP });
  applyFrameHeaders(pathname, h, SECURITY);
  return h;
}

describe('only the audience form for iframes can be framed (plan § 3.2)', () => {
  test('/public/audience/<key>/embed: frame-ancestors *, no x-frame-options, the rest of the CSP intact', () => {
    const h = headersFor(`/public/audience/${KEY}/embed`);
    expect(h.get('content-security-policy')).toBe(
      "default-src 'self'; script-src 'self' 'nonce-x'; frame-ancestors *; form-action 'self'",
    );
    expect(h.has('x-frame-options')).toBe(false);
    expect(h.get('x-content-type-options')).toBe('nosniff');
  });

  test.each([
    `/public/audience/${KEY}`,
    `/public/audience/${KEY}/embed/extra`,
    '/public/audience/not-a-key/embed',
    `/c/${'b'.repeat(64)}`,
    '/u/abc',
    '/h/conversations',
    `/api/public/audience/${KEY}/embed`,
  ])('%s keeps frame-ancestors none and DENY', (path) => {
    const h = headersFor(path);
    expect(h.get('content-security-policy')).toBe(CSP);
    expect(h.get('x-frame-options')).toBe('DENY');
  });

  test('the path rule', () => {
    expect(isEmbedPath(`/public/audience/${KEY}/embed`)).toBe(true);
    expect(isEmbedPath(`/public/audience/${KEY}/embed/`)).toBe(true);
    expect(isEmbedPath(`/public/audience/${KEY.toUpperCase()}/embed`)).toBe(false);
  });

  test('a CSP without frame-ancestors gains it', () => {
    expect(frameableCsp("default-src 'self';")).toBe("default-src 'self'; frame-ancestors *");
  });
});
