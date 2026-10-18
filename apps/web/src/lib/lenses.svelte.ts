/**
 * Which lenses a workspace uses (ADR-131). Each space switches Planner, the
 * selling lens (Difusión or Contratación, by trade) and Cuentas on or off; Desk
 * is no lens and is always there. A lens off is an entry that is gone (the
 * switcher, ⌘K, the Desk doors, the links that lead to it), never data: the
 * rows, their RLS and the detail pages stay as they are.
 *
 * The workspace stores the lenses it does NOT use (`workspace.lenses_off`), so
 * a lens added tomorrow is born on everywhere.
 *
 * Like the trade (ADR-129 § 4), the lenses on screen are shell state: the
 * layout sets them from the workspaces the screen shows. A lens is on when it
 * is on in at least one of them: a scope that mixes a space that invoices with
 * one that does not still has Cuentas. Until the workspaces answer, every lens
 * is on (only an explicit «off» hides, as with access).
 */

import type { Lens } from '$lib/stores/lens.svelte';

export const TOGGLE_LENSES = ['planner', 'conversations', 'books'] as const;
export type ToggleLens = (typeof TOGGLE_LENSES)[number];

export function isToggleLens(value: unknown): value is ToggleLens {
  return typeof value === 'string' && (TOGGLE_LENSES as readonly string[]).includes(value);
}

/** The lenses on for a set of workspaces: on in any one of them. */
export function lensesOnFor(workspaces: ReadonlyArray<{ lenses_off?: readonly string[] | null }>): Set<ToggleLens> {
  if (workspaces.length === 0) return new Set(TOGGLE_LENSES);
  return new Set(TOGGLE_LENSES.filter((l) => workspaces.some((w) => !(w.lenses_off ?? []).includes(l))));
}

let on = $state<ReadonlySet<ToggleLens>>(new Set(TOGGLE_LENSES));

export function setLensesOn(next: ReadonlySet<ToggleLens>): void {
  // Same set, same object: nothing downstream reruns for an identical answer.
  if (next.size === on.size && [...next].every((l) => on.has(l))) return;
  on = next;
}

/** Is this lens on for the screen? Desk always is. */
export function lensOn(lens: Lens): boolean {
  return lens === 'desk' || on.has(lens);
}
