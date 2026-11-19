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

import { DEADLINE_WEEKDAY_DAYS, decideBy, isHoldStatus } from './performance';
import { addDaysIso } from './planner';
import type { Commitment } from './people';
import { followUpDue, turnOf, type TurnRow } from './conversation-overview';
import { relationOf } from './conversation-relation';
import { thingOn, thingRank, type AppThing, type Preparation } from './preparation';
import { attentionItems, type AttentionItem, type MoneyBolo, type MoneyContext } from './money';

/**
 * The strips of a person, a line, a conversation and a date never say more
 * than this (ADR-139 § 2). A performance's pass does NOT cap: it shows all
 * that is open (lista de preparación, fase 1).
 */
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
  /** It hangs from no bolo: there is nowhere for its money to live. */
  | { kind: 'no_bolo' }
  /** Confirmed, upcoming, and nobody wrote when it starts (ADR-211 § 3). */
  | { kind: 'no_time' }
  /** Confirmed, close, and the road sheet has no link for anybody yet. */
  | { kind: 'roadsheet_unshared' };

export interface PerformanceMissingInput {
  status: string;
  /** The performance day, YYYY-MM-DD (or an instant whose date part is it). */
  day: string;
  hold_notice_days: number | null;
  /** The explicit roster (cast, overrides, crew): `performanceRoster`, or a
      feed's `person_ids`; null when the reader cannot know. */
  roster: readonly string[] | null;
  commitments: readonly Commitment[] | null | undefined;
  /** Whether it hangs from a bolo; null when the reader cannot know. */
  hasBolo: boolean | null;
  /** How many live road sheet links; null when the reader cannot know. */
  roadsheetLinks: number | null;
  /** When the performance starts; undefined when the reader cannot know. */
  start_at?: string | null;
}

/** The list's thing each open item belongs to; «sin bolo» is not on the list
    (it has no box): it is always asked. */
const THING_OF: Record<PerformanceMissing['kind'], AppThing | null> = {
  hold_deadline: 'status',
  no_time: 'hours',
  nobody_going: 'team',
  roadsheet_unshared: 'sheet',
  no_bolo: null,
};

/**
 * What a performance still has open. `list` is its project's preparation
 * list (ADR-221): a thing turned off there asks for nothing; without it,
 * everything is asked.
 */
export function performanceMissing(input: PerformanceMissingInput, today: string, list?: Preparation | null): PerformanceMissing[] {
  if (input.status === 'cancelled') return [];
  const day = input.day.slice(0, 10);
  const upcoming = day >= today;
  const out: PerformanceMissing[] = [];

  if (isHoldStatus(input.status) && upcoming) {
    const by = decideBy(day, input.hold_notice_days);
    if (by && by <= addDaysIso(today, DEADLINE_WEEKDAY_DAYS)) out.push({ kind: 'hold_deadline', day: by });
  }

  // Lo que bloquea, en orden (ADR-139 § 2): sin bolo, sin hora, la hoja sin
  // compartir y nadie va. Hotel y técnica ya no son marcas que pedir (ADR-164
  // § 2); «sin hora» viene de la «Sin cerrar» de la temporada (ADR-211 § 3).
  if (input.hasBolo === false) out.push({ kind: 'no_bolo' });

  const confirmedAhead = input.status === 'confirmed' && upcoming;
  if (confirmedAhead && input.start_at === null) out.push({ kind: 'no_time' });
  if (confirmedAhead && input.roadsheetLinks === 0 && day <= addDaysIso(today, ROADSHEET_SHARE_DAYS)) {
    out.push({ kind: 'roadsheet_unshared' });
  }

  if (confirmedAhead) {
    const going = (input.commitments ?? []).some((c) => c.state === 'going');
    if (input.roster?.length === 0 && !going) out.push({ kind: 'nobody_going' });
  }

  return list ? out.filter((m) => THING_OF[m.kind] === null || thingOn(list, THING_OF[m.kind]!)) : out;
}

/**
 * Does an open thing have hurry (the only thing that wears amber)? A hold
 * whose decide-by day is within the week, and a road sheet within its share
 * days: the two «plazos» that are built in. Everything else is open and
 * neutral until the company gives it a deadline (lista de preparación, fase 4).
 */
export function isUrgentMissing(m: PerformanceMissing): boolean {
  return m.kind === 'hold_deadline' || m.kind === 'roadsheet_unshared';
}

// ── El talón: «Por cerrar» ─────────────────────────────────────────────────

/** The boxes of a performance's stub (the «pase», ADR-139 p2), in this order. */
export type ReadinessId = 'status' | 'hours' | 'team' | 'sheet';

/** The word that settles a box; the page says it (i18n) and wires what it does. */
export type ReadinessVerb = 'confirm' | 'add_time' | 'sign_up' | 'share';

export interface ReadinessBox {
  id: ReadinessId;
  done: boolean;
  verb: ReadinessVerb;
  /** Open and in its deadline: the only state that is drawn in amber. */
  urgent: boolean;
  /** `status` of a hold whose decide-by day is close: the day, for the line's meta. */
  holdDay?: string;
}

/**
 * The stub's boxes (no count, no prize: open is neutral, amber only with
 * hurry, `urgent`): «Estado» (confirmed), «Horas» (somebody wrote when it
 * starts), «Equipo» (a roster or a «voy») and «Hoja» (the road sheet has a
 * live link). Derived from what the page already reads; nothing is stored.
 *
 * It is the same reading as `performanceMissing` (one rule, ADR-211 § 3): a
 * box a reader cannot know (`roster`/`roadsheetLinks` arrive `null`,
 * `start_at` undefined) is not drawn, as «Falta» asks nothing of it. Team and
 * sheet are asked only of a confirmed one (a hold is not that far yet), and
 * the sheet only within `ROADSHEET_SHARE_DAYS`; with a link it is a done box
 * at any distance. Hotel and technical are NOT boxes: they are free JSON
 * that can only be «empty or not» (ADR-164 § 2; brief, question 2).
 *
 * A cancelled or past performance has no stub: nothing is «about to leave».
 */
export function performanceReadiness(input: PerformanceMissingInput, today: string, list?: Preparation | null): ReadinessBox[] {
  if (input.status === 'cancelled') return [];
  const day = input.day.slice(0, 10);
  if (day < today) return [];
  const out: ReadinessBox[] = [];

  const hold = performanceMissing(input, today).find((m) => m.kind === 'hold_deadline');
  const confirmed = input.status === 'confirmed';
  const statusDone = input.status !== 'proposed' && !isHoldStatus(input.status);
  out.push({ id: 'status', done: statusDone, verb: 'confirm', urgent: !statusDone && Boolean(hold), ...(hold ? { holdDay: hold.day } : {}) });

  if (input.start_at !== undefined) out.push({ id: 'hours', done: input.start_at !== null, verb: 'add_time', urgent: false });

  if (confirmed && input.roster !== null) {
    const going = (input.commitments ?? []).some((c) => c.state === 'going');
    out.push({ id: 'team', done: input.roster.length > 0 || going, verb: 'sign_up', urgent: false });
  }

  if (confirmed && input.roadsheetLinks !== null) {
    if (input.roadsheetLinks > 0) out.push({ id: 'sheet', done: true, verb: 'share', urgent: false });
    else if (day <= addDaysIso(today, ROADSHEET_SHARE_DAYS)) out.push({ id: 'sheet', done: false, verb: 'share', urgent: true });
  }

  // The project's list: what it turned off is not a box, and the rest go in
  // its order (a stable sort: the default list is the order above).
  if (!list) return out;
  return out.filter((b) => thingOn(list, b.id)).sort((a, b) => thingRank(list, a.id) - thingRank(list, b.id));
}

/**
 * How far ahead «Falta» is a signal and not only a strip on the record: the
 * dot on Hoy's tiles and the amber of the Agenda (ADR-211 § 3).
 */
export const MISSING_SOON_DAYS = 14;

/** A feed row as the signal reads it (`?rosters=1&notice=1&missing=1`). */
export interface MissingRow {
  status: string;
  performed_at: string;
  start_at: string | null;
  hold_notice_days?: number | null;
  person_ids?: readonly string[];
  commitments?: readonly Commitment[] | null;
  has_bolo?: boolean | null;
  roadsheet_links?: number | null;
}

/**
 * THE ONE RULE (ADR-211 § 3): what a performance in the next two weeks still
 * needs, the record's own list. Hoy's dot, the Agenda's amber and the
 * record's «Falta» can never disagree, because they are this. Empty outside
 * the window; a fact the feed did not bring asks for nothing.
 */
export function missingSoon(row: MissingRow, today: string, list?: Preparation | null): PerformanceMissing[] {
  const day = row.performed_at.slice(0, 10);
  if (day < today || day > addDaysIso(today, MISSING_SOON_DAYS)) return [];
  return performanceMissing(
    {
      status: row.status,
      day,
      hold_notice_days: row.hold_notice_days ?? null,
      roster: row.person_ids ?? null,
      commitments: row.commitments,
      hasBolo: row.has_bolo ?? null,
      roadsheetLinks: row.roadsheet_links ?? null,
      start_at: row.start_at,
    },
    today,
    list,
  );
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
  return stepsDue(conversations, today).slice(0, MISSING_MAX);
}

/**
 * Every conversation whose next step's day has come (today or before), the
 * oldest first; «no esta vez» asks for nothing. The one rule behind the
 * person's, the line's and the project's strips, and the line's count.
 */
export function stepsDue(conversations: readonly PersonMissingConversation[], today: string): PersonMissing[] {
  return conversations
    .filter((c) => c.relation !== 'not_now' && c.next_action_at && c.next_action_at.slice(0, 10) <= today)
    .map((c) => ({ kind: 'step_due' as const, conversationId: c.id, day: c.next_action_at!.slice(0, 10) }))
    .sort((a, b) => a.day.localeCompare(b.day));
}

// ── Línea y proyecto ───────────────────────────────────────────────────────

export type LineMissing =
  | PersonMissing
  /** The rest of the due steps, said as one count. `atLeast`: the reader holds
      one page of the conversations, so there may be more than `count`. */
  | { kind: 'steps_due_more'; count: number; atLeast: boolean };

/**
 * What a line's (or a project's) record asks for: its conversations whose
 * next step is due. A line can hold a whole campaign, so past three the
 * strip names the two oldest and says the rest as one count, instead of
 * dropping them.
 *
 * `total`: how many conversations there are when `conversations` is one page
 * of them, in the endpoint's order (next step, oldest first). A page whose
 * last row is not due holds every due one; a page due to its last row may
 * have more after it, and the count is then a floor, said as such.
 */
export function lineMissing(
  conversations: readonly PersonMissingConversation[],
  today: string,
  opts: { total?: number } = {},
): LineMissing[] {
  const due = stepsDue(conversations, today);
  const last = conversations.at(-1);
  const lastDue = Boolean(last && stepsDue([last], today).length > 0);
  const complete = opts.total == null || opts.total <= conversations.length || !lastDue;
  if (due.length <= MISSING_MAX && complete) return due;
  const named = due.slice(0, MISSING_MAX - 1);
  return [...named, { kind: 'steps_due_more', count: due.length - named.length, atLeast: !complete }];
}

// ── Fecha ──────────────────────────────────────────────────────────────────

export type DateMissing =
  /** Still an option, and still to come: confirm it or let it go. */
  | { kind: 'date_tentative' }
  /** A trip still to come with no stage: nothing says how it gets there. */
  | { kind: 'trip_no_stages' };

export interface DateMissingInput {
  kind: string;
  status: string;
  /** The date's first day, YYYY-MM-DD (or an instant whose date part is it). */
  day: string;
  /** How many stages the trip has; null when not read (or not a trip). */
  stages: number | null;
}

/**
 * What a date's vistazo asks for (ADR-139 p1, flujos § 12). A date has no
 * money, no road sheet and no roster (who goes is whoever said «voy»,
 * ADR-147), so what it can lack is its certainty and, a trip, its stages.
 * A past or cancelled date asks for nothing.
 */
export function dateMissing(input: DateMissingInput, today: string): DateMissing[] {
  if (input.status === 'cancelled' || input.status === 'done') return [];
  if (input.day.slice(0, 10) < today) return [];
  const out: DateMissing[] = [];
  if (input.status === 'tentative') out.push({ kind: 'date_tentative' });
  if (input.kind === 'travel_day' && input.stages === 0) out.push({ kind: 'trip_no_stages' });
  return out.slice(0, MISSING_MAX);
}

/** The boxes of a date's stub (the shrunk «pase», ADR-215), in this order. */
export type DateReadinessId = 'hours' | 'stages' | 'team' | 'place';

export interface DateReadinessBox {
  id: DateReadinessId;
  done: boolean;
}

export interface DateReadinessInput {
  kind: string;
  status: string;
  /** The date's first day, YYYY-MM-DD. */
  day: string;
  /** It has an hour (not all day). */
  timed: boolean;
  /** How many stages the trip has; null when not read (or not a trip). */
  stages: number | null;
  /** Somebody said «voy»; null when the reader cannot know. */
  going: boolean | null;
  /** It says where (a room, a city, a trip's end). */
  place: boolean;
}

/**
 * The shrunk stub of what is not a show (brief `ficha-pase`, phase 4): three
 * boxes, the hour, who goes and where. A trip asks for its stages instead of
 * an hour (its day IS its stages, ADR-089). A day off asks for nothing (there
 * is nothing to get ready); neither does a past, cancelled or done date. Who
 * goes is whoever said «voy» (ADR-147): a reader who cannot know draws no box.
 */
export function dateReadiness(input: DateReadinessInput, today: string): DateReadinessBox[] {
  if (input.status === 'cancelled' || input.status === 'done') return [];
  if (input.kind === 'day_off') return [];
  if (input.day.slice(0, 10) < today) return [];
  const out: DateReadinessBox[] = [];
  if (input.kind === 'travel_day') {
    if (input.stages !== null) out.push({ id: 'stages', done: input.stages > 0 });
  } else {
    out.push({ id: 'hours', done: input.timed });
  }
  if (input.going !== null) out.push({ id: 'team', done: input.going });
  out.push({ id: 'place', done: input.place });
  return out;
}

// ── Bolo ───────────────────────────────────────────────────────────────────

/**
 * What a bolo's vistazo asks for: what Cuentas' «Pide atención» says of it
 * (`attentionItems`, the one look at a bolo's money), so the vistazo and
 * the dashboard can never disagree. At most one: Cuentas gives each bolo
 * one row, the worst.
 */
export function boloMissing(bolo: MoneyBolo, ctx: MoneyContext): AttentionItem[] {
  return attentionItems([bolo], ctx).slice(0, MISSING_MAX);
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
