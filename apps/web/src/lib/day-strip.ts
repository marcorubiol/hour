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
import { runSheetSteps, type RunSheetStepKey } from './month-events';

/** A moment on the track: an hour somebody wrote down. */
export type StripMark = {
  /** Hours since midnight, fractional (14.5 = 14:30). */
  at: number;
  /** The vocabulary word for the step; the caller translates it. */
  step: RunSheetStepKey | 'start';
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
 * A performance becomes ONE thread. Its marks are exactly the run-sheet steps
 * the data holds — `runSheetSteps` is the seam, so when ADR-090's
 * `schedule_slot` lands only that adapter changes.
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
  const steps = runSheetSteps(p);
  const marks: StripMark[] = [];
  /* THE TRACK KEEPS COUNTING PAST MIDNIGHT (Marco, 2026-08-10: «la pista se
     alarga»). `hourOf` reads a clock, and a clock has no memory of which day
     it is on: a load-out at 01h30 came back as 1.5 and the strip drew it at
     dawn — BEFORE its own load-in, with the whole day stretched from 01h30 to
     22h30 to hold a point that belongs to tomorrow. The gig did not start at
     one in the morning; the night ran long.
     `RUN_SHEET_ORDER` is the running order, so the hours must not go
     backwards: a step earlier on the clock than the one before it is the next
     morning, and the axis goes to 25h30. The hour LABEL still says «1h30» —
     that is what the clock on the wall says — but its place on the track is
     where it happened. */
  let prev = -Infinity;
  for (const s of steps) {
    let at = hourOf(s.at, timeZone);
    if (at === null) continue;
    while (at < prev) at += 24;
    prev = at;
    marks.push({ at, step: s.key, show: s.key === 'start', solo: false });
  }
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
    steps: steps.map((s) => s.key),
    a: Math.min(...all),
    b: Math.max(...all, ...spans.map((s) => s.to)),
  };
}

/**
 * A date becomes one thread too. It has no run sheet — the road sheet hangs off
 * a performance only (ADR-090) — so it draws its span and NO marks, which is
 * exactly what «never a step that is not in the data» requires.
 */
export function dateThread(
  d: DateEvent,
  timeZone: string,
  name: string,
  city: string | null,
  cert: string,
): StripThread | null {
  if (d.all_day) return null;
  const from = hourOf(d.starts_at, timeZone);
  if (from === null) return null;
  // Same rule as a run sheet: an end earlier on the clock than its own start
  // is tomorrow morning, and the track goes with it. It used to fail the
  // `to > from` test and lose the end altogether — a party 23h→02h drew as an
  // instant at 23h, which is the one hour of it that was never in doubt.
  const end = d.ends_at ? hourOf(d.ends_at, timeZone) : null;
  const to = end !== null && end < from ? end + 24 : end;
  const marks: StripMark[] = [];
  const spans: StripSpan[] = [];
  if (to !== null && to > from) spans.push({ from, to });
  else marks.push({ at: from, step: 'start', show: false, solo: true });
  return {
    id: d.id,
    kind: (d.kind as SlipKind) ?? 'other',
    cert,
    name,
    city,
    spans,
    marks,
    steps: [],
    a: from,
    b: to !== null && to > from ? to : from,
  };
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
