/**
 * The trade a workspace speaks (ADR-128 § 2): a handful of labels change with
 * it — the selling lens, the unit that is performed, who performs it, the
 * day's timetable, who buys. The model never does (`conversation`,
 * `performance`, `bolo` stay as they are inside).
 *
 * A dictionary carries the stage wording under the plain key and the other
 * trades as `key@<trade>` beside it; `t()` picks the variant of the trade in
 * context and falls back to the plain key. Adding a trade is data: a value in
 * `workspace_trade_check` (the migration), one entry here, and its variants.
 *
 * The trade in context is shell state, like the locale: the layout sets it
 * from the workspaces on screen. It is a rune, so a label already drawn
 * repaints when you move from a stage space to a music one.
 */

export const TRADES = ['stage', 'music'] as const;
export type Trade = (typeof TRADES)[number];

/** Escena is the default: theatre, dance, circus, puppets, street. */
export const DEFAULT_TRADE: Trade = 'stage';

export function isTrade(value: unknown): value is Trade {
  return typeof value === 'string' && (TRADES as readonly string[]).includes(value);
}

/**
 * One trade for a set of workspaces: theirs when they all share it, the
 * default when they disagree or say nothing. A screen that mixes a music
 * space with a stage one speaks the default rather than guess.
 */
export function tradeOf(workspaces: ReadonlyArray<{ trade?: string | null }>): Trade {
  const seen = new Set(workspaces.map((w) => (isTrade(w.trade) ? w.trade : DEFAULT_TRADE)));
  return seen.size === 1 ? [...seen][0] : DEFAULT_TRADE;
}

let current = $state<Trade>(DEFAULT_TRADE);

export function currentTrade(): Trade {
  return current;
}

export function setTrade(trade: Trade): void {
  current = trade;
}
