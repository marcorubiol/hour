/**
 * The palette's two doors (ADR-178, amending ADR-152). One palette, two jobs:
 *
 * - `search`: the top bar and ⌘K. Choosing a row opens its record; for what
 *   can be scoped (space, project, line, person) «acotar» is the secondary
 *   action, and it narrows to that one thing alone.
 * - `filter`: the scope pill («Ver solo…»). Choosing a row stages it into the
 *   scope being built, «abrir» is the secondary action, and «Aplicar» sets it.
 *
 * A row that cannot be scoped (a contact, a conversation, a day, a «crear»)
 * opens in both: it has one gesture only.
 */

export type PaletteMode = 'search' | 'filter';

/** What a click on the row, or a plain ↵, does. */
export type RowAct = 'open' | 'stage';
/** The small button beside the row. */
export type RowAside = 'open' | 'narrow' | null;
/** What a key does on the highlighted row. `apply` sets the staged scope. */
export type EnterAct = 'open' | 'stage' | 'narrow' | 'apply';

export function rowAct(mode: PaletteMode, pinnable: boolean): RowAct {
  return mode === 'filter' && pinnable ? 'stage' : 'open';
}

export function rowAside(mode: PaletteMode, pinnable: boolean): RowAside {
  if (!pinnable) return null;
  return mode === 'search' ? 'narrow' : 'open';
}

/**
 * ↵ does what the click does. ⌘↵ always opens. ⇧↵ is the other job: in the
 * filter it applies what was built, in the search it narrows to the row (and
 * on a row that cannot be scoped it simply opens).
 */
export function enterAct(
  mode: PaletteMode,
  pinnable: boolean,
  keys: { meta?: boolean; shift?: boolean } = {},
): EnterAct {
  if (keys.meta) return 'open';
  if (keys.shift) {
    if (mode === 'filter') return 'apply';
    return pinnable ? 'narrow' : 'open';
  }
  return rowAct(mode, pinnable);
}
