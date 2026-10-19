/**
 * Just made (ADR-139 p7): after the quick add, the new card says where it is.
 * The dialog marks the ids it wrote; every `Slip` with one of them draws
 * itself fresh (a soft wash that fades, `--duration-fresh`) and, when none of
 * its copies is on screen, the first one is brought into view. Once per
 * write: the mark goes when the fade ends, or after `FRESH_WAIT_MS` if the
 * card never shows (made for a day the view does not draw).
 */
import { SvelteSet } from 'svelte/reactivity';

/** How long a mark waits for its card: the feeds refetch after the write. */
export const FRESH_WAIT_MS = 10_000;

/** The fade's length, read from its token so CSS and the clock agree. */
const FRESH_FALLBACK_MS = 2400;

const ids = new SvelteSet<string>();
const waits = new Map<string, ReturnType<typeof setTimeout>>();
/** Per id: the copies mounted in this frame, and whether the fade started. */
const shown = new Map<string, Set<HTMLElement>>();

export function markFresh(list: readonly string[]): void {
  for (const id of list) {
    ids.add(id);
    clearTimeout(waits.get(id));
    waits.set(id, setTimeout(() => forget(id), FRESH_WAIT_MS));
  }
}

export function isFresh(id: string): boolean {
  return ids.has(id);
}

function forget(id: string): void {
  ids.delete(id);
  clearTimeout(waits.get(id));
  waits.delete(id);
  shown.delete(id);
}

/** Parse a CSS time (`2.4s`, `300ms`) into milliseconds. */
export function cssTimeMs(value: string, fallback: number): number {
  const m = /^\s*([\d.]+)\s*(ms|s)\s*$/.exec(value);
  if (!m) return fallback;
  const n = Number(m[1]);
  return m[2] === 's' ? n * 1000 : n;
}

function fadeMs(): number {
  if (typeof document === 'undefined') return FRESH_FALLBACK_MS;
  return cssTimeMs(getComputedStyle(document.documentElement).getPropertyValue('--duration-fresh'), FRESH_FALLBACK_MS);
}

/**
 * A fresh card is on the page. The first copy of an id starts the clock; one
 * frame later, if no copy is in view, the first is scrolled to (smoothly,
 * unless the reader asked for no motion). Returns the unmount.
 */
export function freshMounted(id: string, el: HTMLElement): () => void {
  let copies = shown.get(id);
  if (!copies) {
    copies = new Set();
    shown.set(id, copies);
    clearTimeout(waits.get(id));
    waits.set(id, setTimeout(() => forget(id), fadeMs()));
    requestAnimationFrame(() => bringIntoView(id));
  }
  copies.add(el);
  return () => copies.delete(el);
}

function bringIntoView(id: string): void {
  const copies = [...(shown.get(id) ?? [])].filter((el) => el.isConnected);
  if (copies.length === 0 || typeof IntersectionObserver === 'undefined') return;
  const seen = new Map<Element, boolean>();
  const io = new IntersectionObserver((entries) => {
    for (const e of entries) seen.set(e.target, e.isIntersecting);
    if (seen.size < copies.length) return;
    io.disconnect();
    if ([...seen.values()].some(Boolean)) return;
    const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
    copies[0].scrollIntoView({ block: 'center', inline: 'nearest', behavior: still ? 'auto' : 'smooth' });
  });
  for (const el of copies) io.observe(el);
}
