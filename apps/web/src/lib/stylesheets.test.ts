// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { stylesheetsSettled, trackStylesheets } from './stylesheets';

function addLink(href: string): HTMLLinkElement {
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = href;
  document.head.appendChild(link);
  return link;
}

afterEach(() => {
  document.head.innerHTML = '';
  vi.useRealTimers();
});

describe('stylesheetsSettled', () => {
  it('does not wait when no stylesheet is loading', () => {
    expect(stylesheetsSettled(document)).toBeUndefined();
  });

  it('waits for a stylesheet still on its way, then resolves on its load', async () => {
    trackStylesheets(document);
    const link = addLink('https://example.test/a.css');
    let done = false;
    const wait = stylesheetsSettled(document)!;
    expect(wait).toBeInstanceOf(Promise);
    void wait.then(() => (done = true));
    await Promise.resolve();
    expect(done).toBe(false);
    link.dispatchEvent(new Event('load'));
    await wait;
    expect(done).toBe(true);
  });

  it('a stylesheet that failed does not hold the next navigation', () => {
    trackStylesheets(document);
    const link = addLink('https://example.test/broken.css');
    link.dispatchEvent(new Event('error'));
    expect(stylesheetsSettled(document)).toBeUndefined();
  });

  it('gives up after the timeout', async () => {
    vi.useFakeTimers();
    addLink('https://example.test/slow.css');
    const wait = stylesheetsSettled(document, 100)!;
    vi.advanceTimersByTime(100);
    await expect(wait).resolves.toBeUndefined();
  });
});
