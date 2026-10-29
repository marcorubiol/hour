/**
 * PULL TO REFRESH (Marco, 24-10): an app installed to an iPhone's home screen
 * has no pull of its own, so the frame draws one. This is the gesture, in
 * plain functions: where it may start, which way it locks, how far the mark
 * travels for how far the finger goes, and whether letting go refreshes.
 * `PullRefresh.svelte` feeds it touches and draws what it says.
 *
 * - It starts only with the page at its top, from a place that has no
 *   vertical scroll of its own, no dialog, no field and no selection.
 * - The first `slop` px decide: down and more down than sideways is a pull;
 *   sideways (the Planner's board) or up is a scroll, and the gesture is
 *   left alone until the finger lifts.
 * - The mark follows with resistance and never passes `2 × threshold`;
 *   letting go at or past `threshold` refreshes, short of it springs back.
 */

export type PullPhase = 'pending' | 'pulling' | 'refused';

export interface PullState {
  phase: PullPhase;
  startX: number;
  startY: number;
  /** How far the mark has travelled, after resistance (px). */
  distance: number;
}

export interface PullConfig {
  /** The travel that refreshes on release (px), read from `--pull-threshold`. */
  threshold: number;
  /** The movement that decides the direction (px). */
  slop?: number;
}

const SLOP = 10;

/** A touch lands: a candidate pull only with the page at its top. */
export function pullStart(x: number, y: number, atTop: boolean): PullState {
  return { phase: atTop ? 'pending' : 'refused', startX: x, startY: y, distance: 0 };
}

/** The finger moves: lock the direction once, then follow. */
export function pullMove(s: PullState, x: number, y: number, cfg: PullConfig): PullState {
  if (s.phase === 'refused') return s;
  const dx = x - s.startX;
  const dy = y - s.startY;
  if (s.phase === 'pending') {
    const slop = cfg.slop ?? SLOP;
    if (Math.abs(dx) < slop && Math.abs(dy) < slop) return s;
    if (dy <= 0 || Math.abs(dx) >= dy) return { ...s, phase: 'refused' };
    return { ...s, phase: 'pulling', distance: resist(dy, cfg.threshold) };
  }
  return { ...s, distance: resist(dy, cfg.threshold) };
}

/** The finger lifts: true when the pull went far enough to refresh. */
export function pullEnd(s: PullState, cfg: PullConfig): boolean {
  return s.phase === 'pulling' && s.distance >= cfg.threshold;
}

/** Travel for a finger's `dy`: one to one at first, easing towards
 *  `2 × threshold`; the threshold is reached at about 1.4 × threshold. */
export function resist(dy: number, threshold: number): number {
  if (dy <= 0 || threshold <= 0) return 0;
  const max = threshold * 2;
  return max * (1 - Math.exp(-dy / max));
}

/** How far along the pull is, 0 to 1, for the mark's turn and opacity. */
export function pullProgress(distance: number, threshold: number): number {
  return threshold > 0 ? Math.min(1, Math.max(0, distance / threshold)) : 0;
}

/** A CSS length as px: `4.5rem`, `72px`, `3em` (em read as rem). */
export function cssLengthPx(value: string, rootPx: number): number {
  const m = /^\s*(-?[\d.]+)\s*(px|rem|em)?\s*$/.exec(value);
  if (!m) return 0;
  const n = Number(m[1]);
  return m[2] === 'rem' || m[2] === 'em' ? n * rootPx : n;
}

/** Where a pull may not start: a dialog or the drawer, a field, a toggle. */
const OWN_GESTURE =
  'dialog, [role="dialog"], [aria-modal="true"], .drawer, input, textarea, select, [contenteditable]:not([contenteditable="false"])';
/** Open somewhere on screen, it owns every touch. */
const OPEN_OVERLAY = 'dialog[open], [aria-modal="true"], .drawer[data-open]';

/**
 * Whether a touch on `target` belongs to something else: an open overlay,
 * a field, a selection, or an element between it and the page that scrolls
 * vertically on its own.
 */
export function pullBlocked(target: Element | null, doc: Document): boolean {
  if (!target) return true;
  if (doc.querySelector(OPEN_OVERLAY)) return true;
  if (target.closest(OWN_GESTURE)) return true;
  const sel = doc.getSelection?.();
  if (sel && !sel.isCollapsed && sel.toString() !== '') return true;
  const view = doc.defaultView;
  const root = doc.scrollingElement ?? doc.documentElement;
  for (let el: Element | null = target; el && el !== root && el !== doc.body; el = el.parentElement) {
    if (el.scrollHeight <= el.clientHeight) continue;
    const oy = view?.getComputedStyle(el).overflowY;
    if (oy === 'auto' || oy === 'scroll') return true;
  }
  return false;
}
