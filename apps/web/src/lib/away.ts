/**
 * The absence, as a sentence for ONE day.
 *
 * Two views say it — the agenda's day and the Day view — and both used to
 * build it themselves. Twice now something fell out of one copy and not the
 * other: the Day lost the italic that means «not settled», and then it lost
 * the VERB, so «Mia Serra — away until 20 Aug» read as «Mia Serra until 20
 * Aug», which is a sentence about nothing. A sentence written twice is two
 * sentences that agree today.
 *
 * The words come in from the caller, because they are translated and this
 * module owns the GRAMMAR, not the vocabulary: which parts there are, in
 * what order, and what the last day says instead of counting to zero.
 */

/** Whole days from `a` to `b`, both ISO dates, `b >= a`. */
export function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000);
}

/** Does the run cover this day? Inclusive at both ends — a one-day absence
    is `from === to` and still covers its day. */
export function coversDay(day: string, from: string, to: string): boolean {
  return day >= from && day <= to;
}

export interface AwayWords {
  /** «until» */
  until: string;
  /** what the LAST day says instead of «0 days left» — «back tomorrow» */
  back: string;
  /** «{n} days left» */
  left: string;
  /** «1 day left» — a language may not build it from `left` */
  leftOne: string;
}

/**
 * The tail of the sentence: «until 20 Aug · 3 days left», or the words for
 * the last day of the run. The SUBJECT is not here — it carries its own
 * ink (`.away-line__who`) and the caller already holds the naming that
 * includes the verb.
 */
export function awayRest(
  day: string,
  to: string,
  words: AwayWords,
  dayMonth: (iso: string) => string,
): string {
  const left = daysBetween(day, to);
  if (left === 0) return words.back;
  const count = left === 1 ? words.leftOne : words.left.replace('{n}', String(left));
  return `${words.until} ${dayMonth(to)} · ${count}`;
}
