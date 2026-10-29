// @vitest-environment jsdom
import { describe, expect, test } from 'vitest';
import { cssLengthPx, pullBlocked, pullEnd, pullMove, pullProgress, pullStart, resist } from './pull-refresh';

const cfg = { threshold: 72 };

function drag(points: [number, number][], atTop = true) {
  let s = pullStart(points[0][0], points[0][1], atTop);
  for (const [x, y] of points.slice(1)) s = pullMove(s, x, y, cfg);
  return s;
}

describe('pull gesture', () => {
  test('only from the top of the page', () => {
    const s = drag([[100, 100], [100, 140], [100, 400]], false);
    expect(s.phase).toBe('refused');
    expect(pullEnd(s, cfg)).toBe(false);
  });

  test('a long pull down past the threshold refreshes', () => {
    const s = drag([[100, 100], [100, 120], [100, 300]]);
    expect(s.phase).toBe('pulling');
    expect(s.distance).toBeGreaterThanOrEqual(72);
    expect(pullEnd(s, cfg)).toBe(true);
  });

  test('a short pull springs back', () => {
    const s = drag([[100, 100], [100, 120], [100, 150]]);
    expect(s.phase).toBe('pulling');
    expect(pullEnd(s, cfg)).toBe(false);
  });

  test('within the slop nothing is decided', () => {
    const s = drag([[100, 100], [104, 106]]);
    expect(s.phase).toBe('pending');
    expect(pullEnd(s, cfg)).toBe(false);
  });

  test('a horizontal swipe locks out the pull, even if it turns down later', () => {
    const s = drag([[100, 100], [140, 108], [140, 400]]);
    expect(s.phase).toBe('refused');
    expect(pullEnd(s, cfg)).toBe(false);
  });

  test('a diagonal at 45° or flatter is a swipe', () => {
    expect(drag([[0, 0], [20, 20]]).phase).toBe('refused');
    expect(drag([[0, 0], [10, 20]]).phase).toBe('pulling');
  });

  test('upwards is a scroll', () => {
    expect(drag([[100, 300], [100, 280], [100, 500]]).phase).toBe('refused');
  });

  test('going back up after locking cancels the refresh', () => {
    const s = drag([[100, 100], [100, 300], [100, 90]]);
    expect(s.phase).toBe('pulling');
    expect(s.distance).toBe(0);
    expect(pullEnd(s, cfg)).toBe(false);
  });
});

describe('resistance', () => {
  test('monotonic, capped at twice the threshold', () => {
    expect(resist(0, 72)).toBe(0);
    expect(resist(-10, 72)).toBe(0);
    expect(resist(50, 72)).toBeLessThan(50);
    expect(resist(100, 72)).toBeGreaterThan(resist(50, 72));
    expect(resist(10_000, 72)).toBeLessThanOrEqual(144);
  });
  test('the threshold takes more finger than mark', () => {
    // about 1.4 × threshold of finger reaches it
    expect(resist(72, 72)).toBeLessThan(72);
    expect(resist(72 * 1.45, 72)).toBeGreaterThanOrEqual(72);
  });
  test('progress is clamped', () => {
    expect(pullProgress(36, 72)).toBe(0.5);
    expect(pullProgress(200, 72)).toBe(1);
    expect(pullProgress(-1, 72)).toBe(0);
  });
});

describe('cssLengthPx', () => {
  test('rem, px, bare', () => {
    expect(cssLengthPx('4.5rem', 16)).toBe(72);
    expect(cssLengthPx(' 60px ', 16)).toBe(60);
    expect(cssLengthPx('40', 16)).toBe(40);
    expect(cssLengthPx('calc(1px + 2px)', 16)).toBe(0);
  });
});

describe('pullBlocked', () => {
  function mount(html: string) {
    document.body.innerHTML = html;
  }
  test('plain content is free', () => {
    mount('<main><p id="t">hola</p></main>');
    expect(pullBlocked(document.getElementById('t'), document)).toBe(false);
  });
  test('a field, a dialog or the drawer own the touch', () => {
    mount('<input id="i"><div role="dialog"><p id="d">x</p></div><aside class="drawer"><a id="r">r</a></aside>');
    expect(pullBlocked(document.getElementById('i'), document)).toBe(true);
    expect(pullBlocked(document.getElementById('d'), document)).toBe(true);
    expect(pullBlocked(document.getElementById('r'), document)).toBe(true);
  });
  test('an open overlay anywhere blocks the page', () => {
    mount('<p id="t">x</p><aside class="drawer" data-open></aside>');
    expect(pullBlocked(document.getElementById('t'), document)).toBe(true);
  });
  test('an inner vertical scroller keeps its gesture', () => {
    mount('<div id="s" style="overflow-y:auto"><p id="t">x</p></div>');
    const s = document.getElementById('s')!;
    Object.defineProperty(s, 'scrollHeight', { value: 500 });
    Object.defineProperty(s, 'clientHeight', { value: 100 });
    expect(pullBlocked(document.getElementById('t'), document)).toBe(true);
  });
  test('no target, no pull', () => {
    expect(pullBlocked(null, document)).toBe(true);
  });
});
