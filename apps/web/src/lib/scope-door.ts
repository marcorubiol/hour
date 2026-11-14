/**
 * The scope's door (ADR-202 § 12, superseding ADR-152's pill). The scope is
 * a tag inside the frame's one field (`ShellField` › `ScopeTag`): the name of
 * what is scoped and its ×. What the scope does (the palette as a filter,
 * the names of its tokens, save, update, clear) lives in the /h layout,
 * which owns the pins' companions (the nav caches, the saved scope being
 * edited); the layout hands it down here, so nothing reaches into the shell.
 * Hoy's «N más hoy fuera de…» borrows `clear` (ADR-202 § 14).
 */
import { getContext, setContext } from 'svelte';
import type { PinKind } from '$lib/stores/pins.svelte';
import type { Scope } from '$lib/stores/scopes.svelte';

export interface ScopeDoor {
  /** The palette as a filter («Ver solo…», ADR-178), seeded with the pins:
      the tag's «+ añadir». The field and ⌘K open it as a search. */
  openPalette: () => void;
  /** Token → display, over the layout's nav caches (they feed its
      scopeAutoName too). */
  tokenLabel: (tok: string) => string;
  tokenAccent: (tok: string) => string;
  tokenKind: (tok: string) => PinKind;
  tokenLineKind: (tok: string) => string;
  /** Save ⇄ Update ⇄ Delete state, derived in the layout (it owns the saved
      scope being edited). Read as getters: they stay live. */
  readonly exactSaved: Scope | null;
  readonly isModified: boolean;
  save: () => void;
  update: () => void;
  /** Clear = abandoning the working combo too (it enters Recent). */
  clear: () => void;
}

const KEY = Symbol('scope-door');

export function provideScopeDoor(door: ScopeDoor): void {
  setContext(KEY, door);
}

/** Undefined off the /h shell (no palette, no door). */
export function scopeDoor(): ScopeDoor | undefined {
  return getContext<ScopeDoor | undefined>(KEY);
}

/**
 * What the tag says: the name of the first thing scoped, never a different
 * level («Txema Muñoz», «Gota», a line, a person), and «+N» for the rest
 * («Txema Muñoz +1»). Null when nothing is scoped (no tag; the field says
 * «Buscar en todo»).
 */
export function scopePillLabel(tokens: readonly string[], label: (tok: string) => string): string | null {
  if (tokens.length === 0) return null;
  const first = label(tokens[0]);
  return tokens.length > 1 ? `${first} +${tokens.length - 1}` : first;
}
