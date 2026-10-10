/**
 * THE DAY STRIP — the day rotated (ADR-095 §1).
 *
 * Time runs left→right and A ROW IS A THREAD: one thing that occupies a
 * stretch of the day and has steps inside it — a gig (load-in → soundcheck →
 * show → load-out), a rehearsal with two sessions, a trip. NOT one row per
 * event: one row per world.
 *
 * This is the Board at 24-hour zoom. The Board stacks a lane per entity across
 * a month; this stacks a lane per thread across a day. Same drawing, one scale
 * down — which is the point: one grammar, not two.
 *
 * THE LAW THAT GOVERNS EVERYTHING HERE: **the strip never draws a step that is
 * not in the data.** Not derived, not estimated, not a dash. The four steps of
 * a gig used to be inferred from the show hour, so every gig owned a run sheet
 * nobody had given it. Steps are typed when a gig is prepared, and most dates
 * carry only their show hour — some not even that. A mark exists because
 * somebody wrote an hour.
 */

import type { PerformanceEvent, DateEvent, SlipKind } from './month-events';
import { dayMoments, type DayMoment, type RunSheetStepKey } from './month-events';

/** A moment on the track: an hour somebody wrote down. */
export type StripMark = {
  /** Hours since midnight, fractional (14.5 = 14:30). */
  at: number;
  /** The vocabulary word for the step; the caller translates it. `moment`
      is a free moment (ADR-090 P3): its name is `label`. */
  step: RunSheetStepKey | 'start' | 'moment';
  /** What somebody called it, when it is not just one of the five words. */
  label?: string | null;
  /**
   * A FREE MOMENT IS A TICK, NOT A LABEL (ADR-090 P3, Marco 2026-10-10: the
   * free moments go on the strip, but the strip must not saturate). The five
   * steps keep their hour and word; a «photo call» is drawn as a short tick
   * on the bar, its hour and name in the tooltip and the accessible name. The
   * running order right under the strip says it in words — the strip only
   * has to say THAT something happens there.
   */
  free?: boolean;
  /** The show mark is the only one in full ink — it is why the row exists. */
  show: boolean;
  /** An instant with nothing around it: drawn as a point, never as a bar. */
  solo: boolean;
};

/** A stretch of the day. Two sessions with a gap are TWO spans, never one. */
export type StripSpan = { from: number; to: number };

export type StripThread = {
  id: string;
  kind: SlipKind;
  /** The certainty family, for the geometry. */
  cert: string;
  name: string;
  city: string | null;
  spans: StripSpan[];
  marks: StripMark[];
  /** Steps this thread's DATA holds — what an audit can check against. */
  steps: string[];
  /** Earliest and latest hour the thread touches. */
  a: number;
  b: number;
};

/** `2026-07-18T20:30:00Z` → 20.5, in the given zone. Null when unparseable. */
export function hourOf(iso: string, timeZone: string): number | null {
  const t = new Date(iso);
  if (Number.isNaN(t.getTime())) return null;
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(t);
  const h = Number(parts.find((p) => p.type === 'hour')?.value);
  const m = Number(parts.find((p) => p.type === 'minute')?.value);
  if (Number.isNaN(h) || Number.isNaN(m)) return null;
  return h + m / 60;
}

/**
 * The running order's moments as marks, in TIME order (the strip is an axis;
 * the list's hand-made order is the running order's business, not the
 * ruler's). THE TRACK KEEPS COUNTING PAST MIDNIGHT: sorted by instant, a
 * clock that goes backwards is the next morning.
 */
function momentMarks(moments: DayMoment[], timeZone: string): StripMark[] {
  const sorted = [...moments].sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  const marks: StripMark[] = [];
  let prev = -Infinity;
  for (const m of sorted) {
    let at = hourOf(m.at, timeZone);
    if (at === null) continue;
    while (at < prev) at += 24;
    prev = at;
    const free = m.key === null;
    marks.push({
      at,
      step: m.key ?? 'moment',
      label: m.label,
      show: m.key === 'start',
      solo: false,
      free,
    });
  }
  return marks;
}

/**
 * A performance becomes ONE thread. Its marks are exactly the moments its
 * running order holds (`dayMoments`, ADR-090): the five steps with their
 * words, free moments as ticks.
 *
 * With more than one step the thread gets a bar from the first written hour to
 * the last; with a single hour it is an INSTANT and is drawn as one. A bar
 * would claim a duration nobody stated.
 */
export function performanceThread(
  p: PerformanceEvent,
  timeZone: string,
  name: string,
  city: string | null,
  cert: string,
): StripThread | null {
  const marks = momentMarks(dayMoments(p), timeZone);
  const steps = marks.filter((m) => !m.free);
  if (marks.length === 0) return null;
  const spans: StripSpan[] = [];
  if (marks.length > 1) {
    const from = Math.min(...marks.map((m) => m.at));
    const to = Math.max(...marks.map((m) => m.at));
    spans.push({ from, to });
  } else {
    marks[0].solo = true;
  }
  const all = marks.map((m) => m.at);
  return {
    id: p.id,
    kind: 'show',
    cert,
    name,
    city,
    spans,
    marks,
    steps: steps.map((m) => m.step),
    a: Math.min(...all),
    b: Math.max(...all, ...spans.map((s) => s.to)),
  };
}

/** A trip's stage, as the strip reads it (ADR-089 P2): only its two instants. */
export type StripStage = { depart_at: string | null; arrive_at: string | null };

/**
 * A TRIP WITH STAGES DRAWS EACH STAGE (Marco, 2026-10-10): the train is one
 * bar, the car another, and the wait at the station between them is the gap
 * it is. A stage with one hour only is an instant. The strip keeps ONE clock
 * (the reader's): a flight that lands in London is drawn where it lands on
 * this axis, and its London hour is the list's business, under the strip.
 *
 * Null when no stage has an hour: the trip then draws as any date does.
 */
function stagesThread(
  stages: readonly StripStage[],
  timeZone: string,
): Pick<StripThread, 'spans' | 'marks' | 'a' | 'b'> | null {
  const spans: StripSpan[] = [];
  const marks: StripMark[] = [];
  for (const st of stages) {
    const from = st.depart_at ? hourOf(st.depart_at, timeZone) : null;
    const end = st.arrive_at ? hourOf(st.arrive_at, timeZone) : null;
    if (from !== null && end !== null) {
      const to = end < from ? end + 24 : end;
      if (to > from) spans.push({ from, to });
      else marks.push({ at: from, step: 'start', show: false, solo: true });
    } else if (from !== null || end !== null) {
      marks.push({ at: (from ?? end) as number, step: 'start', show: false, solo: true });
    }
  }
  const ends = [...spans.flatMap((x) => [x.from, x.to]), ...marks.map((m) => m.at)];
  if (ends.length === 0) return null;
  return { spans, marks, a: Math.min(...ends), b: Math.max(...ends) };
}

/**
 * A date becomes one thread too. It draws its span, and the moments of its
 * running order if it has one (ADR-090 P3: a rehearsal day is ordered like a
 * gig, and an all-day rehearsal with a running order is placed by it).
 * Without moments it draws NO marks, which is exactly what «never a step that
 * is not in the data» requires.
 */
export function dateThread(
  d: DateEvent,
  timeZone: string,
  name: string,
  city: string | null,
  cert: string,
  stages: readonly StripStage[] = [],
): StripThread | null {
  const marks = momentMarks(dayMoments(d), timeZone);
  const ats = marks.map((m) => m.at);
  const thread = (spans: StripSpan[], a: number, b: number): StripThread => ({
    id: d.id,
    kind: (d.kind as SlipKind) ?? 'other',
    cert,
    name,
    city,
    spans,
    marks,
    steps: marks.filter((m) => !m.free).map((m) => m.step),
    a: Math.min(a, ...ats),
    b: Math.max(b, ...ats),
  });
  // A trip with timed stages draws its stages (ADR-089 P2), and the moments
  // of its running order, if it has any, ride on top as on any other day.
  const staged = d.kind === 'travel_day' ? stagesThread(stages, timeZone) : null;
  if (staged) {
    const own = thread(staged.spans, staged.a, staged.b);
    return { ...own, kind: 'travel_day', marks: [...staged.marks, ...marks] };
  }
  if (d.all_day) {
    if (marks.length === 0) return null;
    if (marks.length === 1) marks[0].solo = true;
    const spans = marks.length > 1 ? [{ from: Math.min(...ats), to: Math.max(...ats) }] : [];
    return thread(spans, ats[0], ats[0]);
  }
  const from = hourOf(d.starts_at, timeZone);
  if (from === null) return null;
  // Same rule as a run sheet: an end earlier on the clock than its own start
  // is tomorrow morning, and the track goes with it. It used to fail the
  // `to > from` test and lose the end altogether — a party 23h→02h drew as an
  // instant at 23h, which is the one hour of it that was never in doubt.
  const end = d.ends_at ? hourOf(d.ends_at, timeZone) : null;
  const to = end !== null && end < from ? end + 24 : end;
  const spans: StripSpan[] = [];
  if (to !== null && to > from) spans.push({ from, to });
  else if (marks.length === 0) marks.push({ at: from, step: 'start', show: false, solo: true });
  return thread(spans, from, to !== null && to > from ? to : from);
}

/**
 * The track's window. It is the DAY's own extent, not a fixed 00→24: a day
 * that runs 18h→23h should not spend three quarters of its width on hours
 * where nothing happens.
 *
 * Padded by half an hour each side so a mark at the very edge still has room
 * for its label, and never narrower than four hours — below that the
 * proportions stop meaning anything.
 */
export function stripWindow(threads: StripThread[]): { from: number; to: number } {
  if (threads.length === 0) return { from: 9, to: 24 };
  const a = Math.min(...threads.map((t) => t.a));
  const b = Math.max(...threads.map((t) => t.b));
  // The right wall is midnight — UNLESS the day itself runs past it. A day
  // that ends inside the clock keeps the old bound exactly; one that does not
  // gets the hours it actually used (25h30 is a real place on this axis).
  const wall = Math.max(24, Math.ceil(b));
  let from = Math.max(0, Math.floor(a - 0.5));
  let to = Math.min(wall, Math.ceil(b + 0.5));
  /* THE MINIMUM GROWS AROUND THE DAY, NOT AWAY FROM IT. The whole four hours
     used to be paid by `to`: one meeting at 12h–13h30 opened a window of
     11h→15h, an hour of dead air in front and an hour and a half behind, with
     the day shoved against the left wall (Marco, 2026-08-10). Centred on the
     day's own middle it is 10h45→14h45 — the same four hours, the same
     proportions, and the thing you came to look at in the middle of them.
     A window this short always clears the half-hour of margin on both sides:
     four hours minus at most three of content leaves half an hour each way. */
  if (to - from < 4) {
    const mid = (a + b) / 2;
    from = mid - 2;
    to = mid + 2;
    if (from < 0) ({ from, to } = { from: 0, to: 4 });
    if (to > wall) ({ from, to } = { from: wall - 4, to: wall });
  }
  return { from, to };
}

/** Percent along the track — the one place position becomes geometry. */
export function pct(hour: number, win: { from: number; to: number }): number {
  const span = Math.max(1, win.to - win.from);
  const clamped = Math.max(win.from, Math.min(win.to, hour));
  return ((clamped - win.from) / span) * 100;
}

/**
 * Where two or more threads are live at once — alignment made visible. The
 * column says so before you read a word, which is the whole reason the day is
 * drawn rotated in the first place.
 */
export function overlaps(
  threads: StripThread[],
  win: { from: number; to: number },
  step = 0.25,
): StripSpan[] {
  const out: StripSpan[] = [];
  let run: { from: number } | null = null;
  for (let h = win.from; h < win.to; h += step) {
    let n = 0;
    for (const t of threads) if (h >= t.a - 0.001 && h < t.b - 0.001) n++;
    const on = n > 1;
    if (on && !run) run = { from: h };
    if (!on && run) {
      out.push({ from: run.from, to: h });
      run = null;
    }
  }
  if (run) out.push({ from: run.from, to: win.to });
  return out;
}
