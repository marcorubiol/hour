/**
 * Whether a dashboard block is drawn (ADR-145 § 1): a block with nothing in
 * it is not drawn. No head, no rule, no sentence that says «nada»: the
 * screen is shorter, and what is there is what there is.
 *
 * The one home of the rule for the four lenses (Hoy, Planificador,
 * Conversaciones, Cuentas). Each block asks here instead of drawing its own
 * empty line.
 *
 * - A failed read is drawn: a silent block would claim «nada» (ADR-096 § 6).
 * - While its read is on the way a block is not drawn either: a skeleton
 *   that turns out empty would vanish under the reader's eyes, and the lens
 *   says it is loading on its root (`aria-busy`). Most reads arrive from the
 *   device first (ADR-144), so the block is there from the first frame.
 */
export interface BlockState {
  /** How many things the block would list (rows, items, figures that are not zero). */
  count: number;
  loading?: boolean;
  errored?: boolean;
}

export function blockDrawn({ count, loading = false, errored = false }: BlockState): boolean {
  if (errored) return true;
  return !loading && count > 0;
}

/**
 * The screen is quiet: none of its blocks is drawn and none is still on the
 * way. Then the screen says so once, in one line under its title, instead
 * of one sentence per block (ADR-145 § 1).
 */
export function screenQuiet(blocks: readonly BlockState[]): boolean {
  return blocks.every((b) => !b.loading && !blockDrawn(b));
}
