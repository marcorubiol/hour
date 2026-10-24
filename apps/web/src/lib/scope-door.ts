/**
 * The scope's door, for the lens head (ADR-145 § 5). On a phone, unscoped,
 * the scope bar gives its row to the lens and its «acotar» goes into the
 * title row (`LensHeader`). The palette that narrows lives in the /h layout;
 * the layout hands its opener down here, so the head does not reach into
 * the shell.
 */
import { getContext, setContext } from 'svelte';

const KEY = Symbol('scope-door');

export function provideScopeDoor(open: () => void): void {
  setContext(KEY, open);
}

/** Undefined off the /h shell (no palette, no door). */
export function scopeDoor(): (() => void) | undefined {
  return getContext<(() => void) | undefined>(KEY);
}
