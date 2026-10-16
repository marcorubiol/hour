/**
 * The season overview's arithmetic (ADR-117) — pure, no words, `today`
 * injected. The Planner's portada answers «how is the calendar shaped» over a
 * horizon of twelve weeks from today; this module turns rows the page already
 * holds into that shape. Every label is a key; the page translates.
 */
import { addDaysIso } from '$lib/planner';
import { READINESS_KEYS } from '$lib/performance';

/** Twelve weeks: one season of booking, and it fits on one screen. */
export const SEASON_WEEKS = 12;
/** A hole shorter than this is a rest, not something to sell. */
export const GAP_MIN_NIGHTS = 3;
/** «Sin cerrar» looks this far ahead: what is close enough to need closing. */
export const UNCLOSED_WEEKS = 8;

export interface SeasonWindow {
  /** First day the season counts: today. */
  from: string;
  /** Last day drawn and counted: the Sunday of the twelfth row. */
  to: string;
  /** Every day from `from` to `to`, inclusive — what the census counts. */
  days: string[];
  /** The strip: rows Monday→Sunday, the first one holding today. Days before
      `from` are drawn (a week is seven cells) but never counted. */
  weeks: string[][];
}

/** Monday of the week holding `iso` (ISO weeks start on Monday). */
export function mondayOf(iso: string): string {
  const dow = new Date(`${iso}T00:00:00Z`).getUTCDay(); // 0 = Sunday
  return addDaysIso(iso, -((dow + 6) % 7));
}

export function seasonWindow(today: string, weeks = SEASON_WEEKS): SeasonWindow {
  const start = mondayOf(today);
  const rows: string[][] = [];
  for (let w = 0; w < weeks; w++) {
    const row: string[] = [];
    for (let d = 0; d < 7; d++) row.push(addDaysIso(start, w * 7 + d));
    rows.push(row);
  }
  const to = rows[rows.length - 1][6];
  const days: string[] = [];
  for (let d = today; d <= to; d = addDaysIso(d, 1)) days.push(d);
  return { from: today, to, days, weeks: rows };
}

export interface GapWindow {
  from: string;
  to: string;
  nights: number;
}

/**
 * Free windows of `min` nights or more — the weeks difusión can offer.
 * A day is NOT free when the company has something of its own on it
 * (`occupied`) or is on tour (`away`): a night 1.200 km from home is not for
 * sale. Same two exclusions as `nightsFree`, grouped instead of counted.
 */
export function gapWindows(
  days: string[],
  occupied: Iterable<string>,
  away: Iterable<string> = [],
  min = GAP_MIN_NIGHTS,
): GapWindow[] {
  const busy = new Set(occupied);
  const tour = new Set(away);
  const out: GapWindow[] = [];
  let run: string[] = [];
  const close = () => {
    if (run.length >= min) out.push({ from: run[0], to: run[run.length - 1], nights: run.length });
    run = [];
  };
  for (const day of days) {
    if (busy.has(day) || tour.has(day)) close();
    else run.push(day);
  }
  close();
  return out;
}

/** What a confirmed gig can still be missing. `travel` is a guess (see below). */
export type UnclosedKey = 'time' | 'cast' | (typeof READINESS_KEYS)[number];

export interface UnclosedInput {
  start_at: string | null;
  readiness?: Record<string, boolean> | null;
  /** Roster from `?rosters=1`; null/undefined = the feed did not say. */
  person_ids?: string[] | null;
  /** ADR-103 — a «voy» counts as somebody going even with no roster row. */
  commitments?: Array<{ state: string }> | null;
  city: string | null;
}

export interface UnclosedVerdict {
  /** Facts: each one is a field that is empty. */
  missing: UnclosedKey[];
  /** A deduction, never a fact: the gig is away from home and nothing says
      how the company gets there. Drawn as `.guess`, never counted. */
  travelGuess: boolean;
}

/** Lowercased, accent-free, trimmed — so «Girona» and «girona » are one city. */
function cityKey(city: string | null | undefined): string {
  return (city ?? '')
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .trim()
    .toLowerCase();
}

/**
 * What a confirmed gig is missing.
 *
 * `travel` cannot be a fact yet: there are no coordinates on `venue`/`place`,
 * so «this gig needs a trip» is only readable as «its city is not the home
 * city, and there is no travel leg or tour band that reaches it». A text
 * heuristic — so it comes back as `travelGuess`, the page draws it in the
 * inference voice, and it never enters the «sin cerrar» count.
 * `home` null (the space has no city on file) means no guess at all.
 */
export function unclosed(
  perf: UnclosedInput,
  ctx: { home: string | null; travelCovered: boolean },
): UnclosedVerdict {
  const missing: UnclosedKey[] = [];
  if (!perf.start_at) missing.push('time');
  for (const key of READINESS_KEYS) if (perf.readiness?.[key] !== true) missing.push(key);
  const going = (perf.commitments ?? []).some((c) => c.state === 'going');
  if (Array.isArray(perf.person_ids) && perf.person_ids.length === 0 && !going) missing.push('cast');
  const home = cityKey(ctx.home);
  const city = cityKey(perf.city);
  const travelGuess = Boolean(home && city && home !== city && !ctx.travelCovered);
  return { missing, travelGuess };
}

export type CellMark = 'firm' | 'option' | 'date' | null;

export interface SeasonCellIn {
  day: string;
  /** `performanceStatusFamily` / `dateStatusFamily` of the row. */
  family: string;
  kind: 'perf' | 'date' | 'travel';
}

/**
 * One cell's dominant mark. A firm gig outranks an option, an option outranks
 * any other date: the cell is a few pixels wide and says the strongest thing
 * that is true of the day. Travel is not a mark — it rides the cell as its
 * own tick, because a gig day can also be a travel day.
 */
export function cellMark(rows: SeasonCellIn[]): CellMark {
  let mark: CellMark = null;
  for (const r of rows) {
    if (r.kind === 'perf' && r.family === 'confirmed') return 'firm';
    if (r.kind === 'perf' && r.family === 'hold') mark = 'option';
    else if (r.kind === 'date' && mark === null) mark = 'date';
  }
  return mark;
}
