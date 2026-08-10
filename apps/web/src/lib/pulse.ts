/**
 * THE PULSE — what is happening now, and what comes next.
 *
 * It is the sidebar's second sentence, under the clock: the clock says WHEN
 * you are, the pulse says WHAT you are in. Two rows and one law each:
 *
 *   NOW   free  UNTIL 15h30
 *   NEXT  [ÚO] 20h  CALL 15h30
 *         Teatre Principal
 *
 * ── THE DAY IS SEGMENTS, NOT EVENTS ────────────────────────────────────
 * A run sheet is a list of moments with no durations on file, so «what is
 * happening» cannot be read off an event — only off the gap between two of
 * its moments. Load-in at 15h30 and soundcheck at 17h means the 16h answer
 * is «load-in», and it means it without anybody storing a length.
 *
 * The last moment of a row has no successor, so its segment runs to the end
 * of that row's local day and is marked SOFT: the pulse says what you are
 * in, and does NOT invent the hour it ends. `until` stays null and the rail
 * draws a dash. Midnight is the honest horizon for a document that is a
 * day's running order.
 *
 * ── EVERY MOMENT COMES THROUGH runSheetSteps ───────────────────────────
 * Not one `*_at` is read here. `runSheetSteps` is the declared seam for
 * ADR-090's `schedule_slot`: when the five columns become rows and the
 * labels go free, this module keeps working and the words it hands out are
 * still keys someone else translates. That is also why `PulseWord` carries
 * a key and never a string — a printable label reaching this far would mean
 * i18n was bypassed, the same rule `month-events.test.ts` pins.
 *
 * ── WHOSE DAY IT IS ────────────────────────────────────────────────────
 * The pulse is person-scoped: it answers for YOU, not for the company. But
 * it also says the word «free», and that puts it on the wrong side of the
 * filtering shortcut every other view can take. `matchesPinnedPeople` drops
 * a row nobody is on file for; a view that drops those rows and then draws
 * an empty evening has printed «free» off an `unknown` — the one thing
 * $lib/people forbids in as many words. So the pulse takes the four-state
 * `PersonAttribution` and keeps what it cannot rule out:
 *
 *   explicit      — a roster says you are on it. Certain.
 *   inferred      — your project's cast, nobody actually cast. A guess.
 *   unattributed  — no roster, no cast on file. Not a guess about YOU; it
 *                   is the company's day, still yours to read.
 *   no            — somebody IS on file and it is not you. Dropped.
 *
 * Only `no` is dropped, and only that direction is safe: keeping a row too
 * many makes «free» harder to claim, which is the failure that costs
 * nothing. The verdict travels to the paint so a claim never reads as a fact.
 *
 * Pure and clock-free: `now` is always a parameter, every comparison is on
 * absolute instants, and every hour is RENDERED venue-first by the caller
 * (the zone travels with each answer). No i18n, no fetching.
 */

import { wallClockToInstant } from './datetime';
import {
  runSheetSteps,
  type DateEvent,
  type PerformanceEvent,
  type RunSheetStepKey,
} from './month-events';
import type { PersonAttribution, PersonAttributionScope } from './people';
import { dayKeyInTz } from './planner';

/** A moment's name, as vocabulary — the caller owns the words. */
export type PulseWord =
  | { of: 'step'; key: RunSheetStepKey }
  /** `label` is the free text an `other` date carries instead of a kind. */
  | { of: 'kind'; key: string; label: string | null };

/** The row an answer came from, with everything the rail draws about it. */
export interface PulseRef {
  of: 'performance' | 'date';
  id: string;
  /**
   * THE ROW ITSELF, so the caller can turn it into a `Slip`.
   *
   * The pulse does NOT decide what a thing is called, where it is, or where
   * it links to. `performanceSlip`/`dateSlip` already answer that for the
   * month, the board, the diary and the day, and ADR-095 §0 is explicit
   * about what a second opinion costs: this module tried its own
   * `venue_name ?? city ?? title` and lost a rehearsal's actual title
   * («Reunió de producció» drew as «Barcelona») the first time a real row
   * met it. One vocabulary, five drawings.
   */
  row: PerformanceEvent | DateEvent;
  /** The venue's zone when it has one: every hour here is venue-first. */
  tz: string | null;
  /** How the row reached you. Anything but `explicit` is a claim, not a
      fact, and must be drawn as one. */
  attribution: PersonAttribution;
  /** Not settled (proposed, tentative, any rank of hold). */
  tentative: boolean;
}

export interface PulseNow {
  /** What you are in. Null is the real answer «free», never «unknown». */
  doing: { word: PulseWord; ref: PulseRef } | null;
  /** The next boundary of the day, when there is one and it falls today.
      Null → the rail draws a dash; it never guesses an end. */
  until: { at: string; tz: string | null } | null;
}

export interface PulseNext {
  ref: PulseRef;
  /** What it IS — a show, a rehearsal, a travel day. An hour and a venue
      say enough for a gig; a rehearsal has to name itself. */
  word: PulseWord;
  /** The moment that names it. Null when the row carries no hour at all. */
  at: string | null;
  /** ISO day (viewer zone) — always known, even when `at` is not. */
  day: string;
  /** The first moment of the run sheet, when it comes before `at`: the
      call. Whatever that first moment happens to be — today a load-in,
      tomorrow whatever ADR-090 lets a company invent. */
  call: string | null;
  /** Is it the day the viewer is living? The rail only names other days. */
  today: boolean;
}

export interface Pulse {
  now: PulseNow;
  next: PulseNext | null;
}

export interface PulseInput {
  performances: readonly PerformanceEvent[];
  dates: readonly DateEvent[];
  /** The viewer's own zone — what «today» means, and the fallback for a
      row whose venue has no zone on file. */
  viewerTz: string;
  /** The person axis, already resolved. Inactive (nobody pinned, or a login
      with no person) means the pulse speaks for the whole company. */
  axis?: PersonAttributionScope | null;
}

/** A stretch of the day one row occupies. `hard` = the end is a real
    moment; soft means «until the day is out», which is not an hour. */
interface Segment {
  from: number;
  to: number;
  hard: boolean;
  word: PulseWord;
  ref: PulseRef;
  tz: string | null;
}

/** A row reduced to what the pulse asks of it. */
interface Entry {
  ref: PulseRef;
  day: string;
  tz: string;
  segments: Segment[];
  word: PulseWord;
  /** The moment that names the row, for the NEXT row. */
  at: string | null;
  call: string | null;
}

const DAY_MS = 86_400_000;

function startOfDay(isoDay: string, tz: string): number {
  const at = wallClockToInstant(`${isoDay}T00:00`, tz);
  return at ? Date.parse(at) : NaN;
}

/** The instant a local day runs out — built from the NEXT day's midnight,
    so a day a DST shift makes 23 or 25 hours long still ends where it does. */
function endOfDayKey(isoDay: string, tz: string): number {
  const start = startOfDay(isoDay, tz);
  const nextDay = new Date(Date.parse(`${isoDay}T00:00:00Z`) + DAY_MS).toISOString().slice(0, 10);
  const end = startOfDay(nextDay, tz);
  if (Number.isFinite(end)) return end;
  return Number.isFinite(start) ? start + DAY_MS : NaN;
}

function endOfDay(at: string, tz: string): number {
  return endOfDayKey(dayKeyInTz(at, tz), tz);
}

/**
 * A moment that CLOSES the sheet instead of opening a stretch.
 *
 * Every moment means «this is what you are doing until the next one», and
 * the last one has no next one, so it runs soft to the end of the day —
 * which is right for a show with no wrap time on file (you are in it; nobody
 * wrote down when it ends) and wrong for the wrap itself (after the wrap you
 * are done, and the pulse said «wrap» until midnight until a test caught it).
 *
 * It is a property of the VOCABULARY, not of this module: today exactly one
 * word means «the end». When ADR-090 lets a company invent its own moments,
 * a slot will have to declare whether it is a terminus, and this set becomes
 * that flag — the seam does not move.
 */
const TERMINAL_STEPS = new Set<RunSheetStepKey>(['wrap']);

function isCancelled(status: string | null | undefined): boolean {
  return status === 'cancelled';
}

function isTentative(status: string | null | undefined): boolean {
  if (typeof status !== 'string') return false;
  return status === 'proposed' || status === 'tentative' || status.startsWith('hold');
}

function performanceEntry(
  p: PerformanceEvent,
  viewerTz: string,
  attribution: PersonAttribution,
): Entry {
  const tz = p.venue?.timezone || viewerTz;
  const ref: PulseRef = {
    of: 'performance',
    id: p.id,
    row: p,
    tz: p.venue?.timezone ?? null,
    attribution,
    tentative: isTentative(p.status),
  };

  // THE SEAM. Five columns today, rows tomorrow; this module never learns
  // which, and never learns their names either.
  const steps = runSheetSteps(p);
  const segments: Segment[] = [];
  for (let i = 0; i < steps.length; i += 1) {
    const step = steps[i];
    const next = steps[i + 1];
    if (!next && TERMINAL_STEPS.has(step.key)) break;
    segments.push({
      from: Date.parse(step.at),
      to: next ? Date.parse(next.at) : endOfDay(step.at, tz),
      hard: Boolean(next),
      word: { of: 'step', key: step.key },
      ref,
      tz: ref.tz,
    });
  }

  const at = p.start_at ?? steps[0]?.at ?? null;
  const first = steps[0]?.at ?? null;
  return {
    ref,
    day: p.performed_at.slice(0, 10),
    tz,
    segments: segments.filter((s) => Number.isFinite(s.from) && s.to > s.from),
    word: { of: 'step', key: 'start' },
    at,
    // The call is the first moment on the sheet, and only when something
    // comes after it — a lone start time is a start, not a call.
    call: first && at && Date.parse(first) < Date.parse(at) ? first : null,
  };
}

function dateEntry(d: DateEvent, viewerTz: string, attribution: PersonAttribution): Entry {
  const tz = d.venue?.timezone || viewerTz;
  const ref: PulseRef = {
    of: 'date',
    id: d.id,
    row: d,
    tz: d.venue?.timezone ?? null,
    attribution,
    tentative: isTentative(d.status),
  };
  const word: PulseWord = { of: 'kind', key: d.kind, label: d.label ?? null };

  // An all-day row IS the day — midnight to midnight, across every day it
  // spans. A timed row without an end runs soft, same rule as a run sheet's
  // last moment.
  const from = d.all_day ? startOfDay(dayKeyInTz(d.starts_at, tz), tz) : Date.parse(d.starts_at);
  const to = d.all_day
    ? endOfDay(d.ends_at ?? d.starts_at, tz)
    : d.ends_at
      ? Date.parse(d.ends_at)
      : endOfDay(d.starts_at, tz);
  const hard = d.all_day ? true : Boolean(d.ends_at);
  const usable = Number.isFinite(from) && Number.isFinite(to) && to > from;

  return {
    ref,
    day: dayKeyInTz(d.starts_at, tz),
    tz,
    segments: usable ? [{ from, to, hard, word, ref, tz: ref.tz }] : [],
    word,
    at: d.all_day ? null : d.starts_at,
    call: null,
  };
}

/**
 * NOW and NEXT for one moment in time.
 *
 * Both rows read the same entries, so they can never disagree about what is
 * on: NEXT is simply the first row whose naming moment is still ahead, which
 * is why a gig you are already loading in for stays NEXT until its own hour
 * passes — the sheet's next moment IS what comes next.
 */
export function computePulse(input: PulseInput, now: Date): Pulse {
  const t = now.getTime();
  const viewerTz = input.viewerTz;
  const today = dayKeyInTz(now.toISOString(), viewerTz);
  const axis = input.axis?.active ? input.axis : null;

  const entries: Entry[] = [];

  for (const p of input.performances) {
    if (isCancelled(p.status)) continue;
    const attribution = axis
      ? axis.attribute({
          projectId: p.project?.id ?? null,
          day: p.performed_at.slice(0, 10),
          roster: p.person_ids,
        })
      : 'explicit';
    if (attribution === 'no') continue;
    entries.push(performanceEntry(p, viewerTz, attribution));
  }

  for (const d of input.dates) {
    if (isCancelled(d.status)) continue;
    const attribution = axis
      ? axis.attribute({
          projectId: d.project?.id ?? null,
          day: dayKeyInTz(d.starts_at, d.venue?.timezone || viewerTz),
        })
      : 'explicit';
    if (attribution === 'no') continue;
    entries.push(dateEntry(d, viewerTz, attribution));
  }

  // ── NOW ──────────────────────────────────────────────────────────────
  // The innermost segment wins: a rehearsal inside a residency is what you
  // are DOING; the residency is only where you are.
  let doing: Segment | null = null;
  for (const entry of entries) {
    for (const segment of entry.segments) {
      if (segment.from <= t && t < segment.to && (!doing || segment.from > doing.from)) {
        doing = segment;
      }
    }
  }

  // The next boundary is whichever comes first: something starting, or the
  // end of what you are in — and the latter only when it is a real moment.
  let boundaryAt = Number.POSITIVE_INFINITY;
  let boundaryTz: string | null = null;
  const consider = (at: number, tz: string | null) => {
    if (!Number.isFinite(at) || at <= t || at >= boundaryAt) return;
    boundaryAt = at;
    boundaryTz = tz;
  };
  for (const entry of entries) {
    for (const segment of entry.segments) consider(segment.from, segment.tz);
  }
  if (doing?.hard) consider(doing.to, doing.tz);

  const untilIso = Number.isFinite(boundaryAt) ? new Date(boundaryAt).toISOString() : null;
  const until =
    untilIso && dayKeyInTz(untilIso, viewerTz) === today ? { at: untilIso, tz: boundaryTz } : null;

  // ── NEXT ─────────────────────────────────────────────────────────────
  // A row with no hour is still ahead until its day is out — an untimed gig
  // today must not fall silently behind a clock it never had. But a row that
  // is happening RIGHT NOW is the NOW row's business, not this one's.
  let next: Entry | null = null;
  let nextKey = Number.POSITIVE_INFINITY;
  for (const entry of entries) {
    let key: number;
    if (entry.at) {
      key = Date.parse(entry.at);
    } else {
      if (entry.segments.some((s) => s.from <= t && t < s.to)) continue;
      key = endOfDayKey(entry.day, entry.tz);
    }
    if (!Number.isFinite(key) || key <= t || key >= nextKey) continue;
    next = entry;
    nextKey = key;
  }

  return {
    now: { doing: doing ? { word: doing.word, ref: doing.ref } : null, until },
    next: next
      ? {
          ref: next.ref,
          word: next.word,
          at: next.at,
          day: next.day,
          call: next.call,
          today: next.day === today,
        }
      : null,
  };
}
