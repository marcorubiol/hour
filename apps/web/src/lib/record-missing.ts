/**
 * «Falta»: what a record still needs, said with its verb (ADR-139 § 2, p2 A).
 *
 * The strip under a record's facts names 0 to 3 things, most pressing first,
 * and each one has the verb that settles it. Every item is DERIVED from data
 * the page already reads; nothing here is stored, and nothing is guessed: a
 * fact the reader cannot see (the money link without `read:money`, the road
 * sheet's links without `edit:performance`) arrives as `null` and asks for
 * nothing. With no item, the strip is not drawn.
 *
 * Pure, without network or clock: `today` (YYYY-MM-DD, the reader's wall
 * clock) or `now` is passed in. The words live in the page (i18n); this module
 * only says what and in which order.
 */

import { DEADLINE_WEEKDAY_DAYS, READINESS_KEYS, decideBy, isHoldStatus, isReady, type ReadinessKey } from './performance';
import { addDaysIso } from './planner';
import type { Commitment } from './people';
import { followUpDue, turnOf, type TurnRow } from './conversation-overview';
import { relationOf } from './conversation-relation';

/** The strip never says more than this (ADR-139 § 2). */
export const MISSING_MAX = 3;

/**
 * How close a confirmed performance must be for an unshared road sheet to
 * count as missing. A design threshold, not a rule from the data: two weeks
 * is when the venue's technical team usually asks for it (to re-evaluate with
 * a season of use).
 */
export const ROADSHEET_SHARE_DAYS = 14;

// ── Función ────────────────────────────────────────────────────────────────

export type PerformanceMissing =
  /** A hold whose decide-by day is within the coming week, or has passed. */
  | { kind: 'hold_deadline'; day: string }
  /** Confirmed and upcoming, and nobody is down to go (no roster, no «voy»). */
  | { kind: 'nobody_going' }
  /** Confirmed and upcoming, and this preparation item is not ticked. */
  | { kind: 'ready'; key: ReadinessKey }
  /** It hangs from no bolo: there is nowhere for its money to live. */
  | { kind: 'no_bolo' }
  /** Confirmed, close, and the road sheet has no link for anybody yet. */
  | { kind: 'roadsheet_unshared' };

export interface PerformanceMissingInput {
  status: string;
  /** The performance day, YYYY-MM-DD (or an instant whose date part is it). */
  day: string;
  hold_notice_days: number | null;
  readiness: Record<string, boolean> | null;
  /** The explicit roster (cast, overrides, crew): `performanceRoster`. */
  roster: readonly string[];
  commitments: readonly Commitment[] | null | undefined;
  /** Whether it hangs from a bolo; null when the reader cannot know. */
  hasBolo: boolean | null;
  /** How many live road sheet links; null when the reader cannot know. */
  roadsheetLinks: number | null;
}

export function performanceMissing(input: PerformanceMissingInput, today: string): PerformanceMissing[] {
  if (input.status === 'cancelled') return [];
  const day = input.day.slice(0, 10);
  const upcoming = day >= today;
  const out: PerformanceMissing[] = [];

  if (isHoldStatus(input.status) && upcoming) {
    const by = decideBy(day, input.hold_notice_days);
    if (by && by <= addDaysIso(today, DEADLINE_WEEKDAY_DAYS)) out.push({ kind: 'hold_deadline', day: by });
  }

  if (input.status === 'confirmed' && upcoming) {
    const going = (input.commitments ?? []).some((c) => c.state === 'going');
    if (input.roster.length === 0 && !going) out.push({ kind: 'nobody_going' });
    for (const key of READINESS_KEYS) {
      if (!isReady(input.readiness, key)) out.push({ kind: 'ready', key });
    }
  }

  if (input.hasBolo === false) out.push({ kind: 'no_bolo' });

  if (
    input.status === 'confirmed' &&
    upcoming &&
    input.roadsheetLinks === 0 &&
    day <= addDaysIso(today, ROADSHEET_SHARE_DAYS)
  ) {
    out.push({ kind: 'roadsheet_unshared' });
  }

  return out.slice(0, MISSING_MAX);
}

// ── Conversación ───────────────────────────────────────────────────────────

export type ConversationMissing =
  /** The last word came from outside and nobody settled it: it is ours. */
  | { kind: 'reply'; since: string }
  /** The next step's day is today or past. */
  | { kind: 'step_due'; day: string }
  /** A next step written without a day: nothing will bring it back. */
  | { kind: 'step_undated' }
  /** In talks, and nothing says what comes next. */
  | { kind: 'no_step' };

export type ConversationMissingInput = TurnRow & {
  next_action_at: string | null;
  next_action_note: string | null;
};

export function conversationMissing(input: ConversationMissingInput, now: Date): ConversationMissing[] {
  const out: ConversationMissing[] = [];
  const turn = turnOf(input, now);
  if (turn?.side === 'ours') out.push({ kind: 'reply', since: turn.since });

  const relation = relationOf(input, now);
  if (relation !== 'not_now') {
    if (followUpDue(input, now)) out.push({ kind: 'step_due', day: input.next_action_at!.slice(0, 10) });
    else if (!input.next_action_at && input.next_action_note?.trim()) out.push({ kind: 'step_undated' });
    else if (!input.next_action_at && !input.next_action_note?.trim() && relation === 'talking' && turn?.side !== 'ours') {
      out.push({ kind: 'no_step' });
    }
  }

  return out.slice(0, MISSING_MAX);
}

// ── Persona ────────────────────────────────────────────────────────────────

/** A conversation of this person whose next step's day has come. */
export interface PersonMissing {
  kind: 'step_due';
  conversationId: string;
  day: string;
}

export interface PersonMissingConversation {
  id: string;
  /** The derived relation (`relationOf`, computed by the Worker). */
  relation: string;
  next_action_at: string | null;
}

/**
 * What a person's record asks for (ADR-139 p2, flujos § B): their
 * conversations whose next step is due, the oldest first. A conversation in
 * «no esta vez» asks for nothing, as in the conversation's own strip.
 */
export function personMissing(conversations: readonly PersonMissingConversation[], today: string): PersonMissing[] {
  return conversations
    .filter((c) => c.relation !== 'not_now' && c.next_action_at && c.next_action_at.slice(0, 10) <= today)
    .map((c) => ({ kind: 'step_due' as const, conversationId: c.id, day: c.next_action_at!.slice(0, 10) }))
    .sort((a, b) => a.day.localeCompare(b.day))
    .slice(0, MISSING_MAX);
}

// ── Atajos del siguiente paso ──────────────────────────────────────────────

export type StepShortcut = 'tomorrow' | 'monday' | 'two_weeks';

/**
 * The days a next step is almost always set to (ADR-139, flujos § 17):
 * tomorrow, the coming Monday (a Monday gives the next one, never today) and
 * two weeks from today. YYYY-MM-DD, calendar arithmetic on `today`.
 */
export function stepShortcuts(today: string): Record<StepShortcut, string> {
  const weekday = new Date(`${today}T00:00:00Z`).getUTCDay(); // 0 = Sunday
  const toMonday = ((8 - weekday) % 7) || 7;
  return {
    tomorrow: addDaysIso(today, 1),
    monday: addDaysIso(today, toMonday),
    two_weeks: addDaysIso(today, 14),
  };
}
