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
 *
 * Tarea 142: with spaces of different trades on screen the context is a
 * voice, `mixed`, not a trade: `t()` reads `key@mixed` (the neutral word)
 * and falls back to the plain key. `mixed` is never stored: it is not in
 * `TRADES` nor in the CHECK. What belongs to one row speaks its own space's
 * trade: `t(key, locale, params, tradeFor(row.workspace_id))`.
 */

export const TRADES = ['stage', 'music'] as const;
export type Trade = (typeof TRADES)[number];

/** The voice of a screen: one trade, or `mixed` when its spaces disagree. */
export type Voice = Trade | 'mixed';

/** Escena is the default: theatre, dance, circus, puppets, street. */
export const DEFAULT_TRADE: Trade = 'stage';

function isTrade(value: unknown): value is Trade {
  return typeof value === 'string' && (TRADES as readonly string[]).includes(value);
}

/** A workspace's own trade: the stored one, the default when unknown. */
function ownTrade(trade: unknown): Trade {
  return isTrade(trade) ? trade : DEFAULT_TRADE;
}

/**
 * One voice for a set of workspaces: their trade when they all share it,
 * `mixed` when they disagree, the default when there are none. A screen that
 * mixes a music space with a stage one speaks the neutral word, not one of
 * the two.
 */
export function tradeOf(workspaces: ReadonlyArray<{ trade?: string | null }>): Voice {
  const seen = new Set(workspaces.map((w) => ownTrade(w.trade)));
  if (seen.size === 0) return DEFAULT_TRADE;
  return seen.size === 1 ? [...seen][0] : 'mixed';
}

let current = $state<Voice>(DEFAULT_TRADE);

export function currentTrade(): Voice {
  return current;
}

export function setTrade(voice: Voice): void {
  current = voice;
}

/** Every space the person reads, by id and by slug (the `['workspaces']` feed). */
let trades = $state.raw<ReadonlyMap<string, Trade>>(new Map());

export function setWorkspaceTrades(
  all: ReadonlyArray<{ id: string; slug?: string | null; trade?: string | null }>,
): void {
  trades = new Map(
    all.flatMap((w) => {
      const trade = ownTrade(w.trade);
      return w.slug ? [[w.id, trade] as const, [w.slug, trade] as const] : [[w.id, trade] as const];
    }),
  );
}

/**
 * The trade of one space, by id or slug: what a row, a record or a dialog
 * with a chosen space passes to `t()`. The default for a space it does not
 * know (not loaded yet, or none).
 */
export function tradeFor(workspace: string | null | undefined): Trade {
  return (workspace && trades.get(workspace)) || DEFAULT_TRADE;
}

/**
 * The voice of a dialog that chooses its space inside (tarea 142 D): that
 * space's trade once there is one, the screen's voice until then. An alta
 * opened from «Todo» speaks the space it writes to, not the screen. A dialog
 * that writes to several spaces at once passes them all: their trade when
 * they share it, `mixed` when they disagree.
 */
export function voiceFor(workspaces: string | readonly string[] | null | undefined): Voice {
  const ids = (typeof workspaces === 'string' ? [workspaces] : (workspaces ?? [])).filter(Boolean);
  if (ids.length === 0) return current;
  return tradeOf(ids.map((id) => ({ trade: tradeFor(id) })));
}
