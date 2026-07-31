/**
 * ONE MEASURE, AND IT MEASURES THE ELEMENT (ADR-095 §8).
 *
 * Every responsive threshold of a Planner drawing comes from the drawing's
 * OWN width, never from the viewport. The Planner is a column inside a shell:
 * with a 250px sidebar open, `matchMedia('(max-width: 560px)')` and "this
 * drawing is 560px wide" name two different moments, and the app had three
 * systems disagreeing at once — a `matchMedia(560)` in the agenda, a
 * `matchMedia(640)` on the page and a bare `window.resize` in the board.
 *
 * Sets classes on the node, largest first, exactly like the prototype:
 *
 *   .narrow  ≤ 760   the margin folds under the day
 *   .w900    ≤ 900   labels shrink, glosses start dropping
 *   .w820    ≤ 820   the month's week gutter goes
 *   .w700    ≤ 700   phone: gutters collapse, tap targets grow
 *
 * They are cumulative, not exclusive: at 690px all four are on, so CSS reads
 * as a cascade of increasingly severe retreats rather than four unrelated
 * states. That is what lets a rule say "from here down" in one selector.
 *
 * THE FIRST PASS IS SYNCHRONOUS, on purpose. Reading `clientWidth` forces the
 * layout you are about to paint anyway, so it costs nothing here — and the
 * alternative (waiting for the first ResizeObserver callback) paints one frame
 * at the wrong breakpoint, which is visible as a flash on every load.
 *
 * `onWidth` is for the rare caller that needs the number itself (the strip's
 * mark folding measures text against it). Prefer the classes: a component that
 * re-renders on every pixel of width is a component that thrashes.
 */

export type FitOptions = {
  /** Called with the element's width on every change, first pass included. */
  onWidth?: (width: number) => void;
};

const STEPS: ReadonlyArray<readonly [number, string]> = [
  [760, 'narrow'],
  [900, 'w900'],
  [820, 'w820'],
  [700, 'w700'],
];

export function fit(node: HTMLElement, options: FitOptions = {}) {
  let onWidth = options.onWidth;
  let last = -1;

  function apply(width: number) {
    if (width === last) return;
    last = width;
    for (const [max, cls] of STEPS) node.classList.toggle(cls, width <= max);
    onWidth?.(width);
  }

  // Synchronous first pass — see the note above.
  apply(node.clientWidth);

  const ro = new ResizeObserver((entries) => {
    for (const entry of entries) {
      // borderBoxSize is the width the CSS thresholds are written against;
      // contentRect would exclude padding and read narrow by however much
      // the shell happens to pad this drawing today.
      const box = entry.borderBoxSize?.[0];
      apply(box ? box.inlineSize : entry.contentRect.width);
    }
  });
  ro.observe(node);

  return {
    update(next: FitOptions = {}) {
      onWidth = next.onWidth;
    },
    destroy() {
      ro.disconnect();
    },
  };
}
