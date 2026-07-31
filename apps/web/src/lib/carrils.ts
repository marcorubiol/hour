/**
 * The Board — the pure logic of the Planner's entity projection (ADR-080 §7/§8,
 * ADR-095 §2): one row per workspace, project or person, all three drawn by the
 * SAME lane machinery. Same contract as $lib/planner: every function is pure,
 * day-precision, string ISO-date compares only — the page supplies the rows and
 * "today", the component measures pixels.
 *
 * `loomThreads()` used to live here — 260 lines drawing «rows are people» a
 * second time, with its own segments, knots and vocabulary. ADR-095 §2 deleted
 * it: the person axis is the same board, and the resolver it needs
 * (`personRowKeys`) was already sitting exported and unused in $lib/people.
 * The proof it was a mistake is in the design prototype itself, where the
 * equivalent function survives with NO CALLERS.
 */

import { addDaysIso } from './planner';

/**
 * The Board's lane axis — what one row IS (ADR-080 §8, renamed by ADR-095 §9).
 *
 * The dial only ever relabels the lanes; it can never change the fact that a
 * Board row is an entity. That is the whole of ADR-094: a dial in the
 * furniture, a view in the model.
 */
export type LaneAxis = 'workspace' | 'project' | 'person';

/**
 * Legacy lane tokens, translated ONCE on entry. These were Catalan words in
 * an otherwise English URL vocabulary — the site is translated, the address
 * bar is not (ADR-095 §9).
 */
const LANE_ALIASES: Record<string, LaneAxis> = {
  espai: 'workspace',
  projecte: 'project',
  persona: 'person',
};

/** A token from a URL or storage → a lane axis, or null if it is neither. */
export function normalizeLaneAxis(v: string | null | undefined): LaneAxis | null {
  if (v === 'workspace' || v === 'project' || v === 'person') return v;
  return (v && LANE_ALIASES[v]) || null;
}

/**
 * Lane resolution — same persistence chain as the projection (ADR-078 §10 via
 * ADR-080 §8): explicit `&lanes=` → the device's stored preference →
 * 'workspace'. Unknown values fall through.
 */
export function resolveLaneAxis(
  urlLanes: string | null | undefined,
  stored: string | null | undefined,
): LaneAxis {
  return normalizeLaneAxis(urlLanes) ?? normalizeLaneAxis(stored) ?? 'workspace';
}

/** Sunday/Saturday check on a plain ISO date (UTC math, tz-free). */
export function isWeekendIso(iso: string): boolean {
  const wd = new Date(`${iso}T00:00:00Z`).getUTCDay();
  return wd === 0 || wd === 6;
}

/**
 * Greedy row assignment for measured pixel intervals — the lane's pip
 * stacking. Numeric sibling of `assignBandLanes` (which speaks ISO
 * ranges): rows index the INPUT order; intervals are placed left-to-right
 * and drop into the first row whose last occupant ends more than `gap`
 * pixels before they start. The component measures, this function stacks.
 */
export function stackIntervals(
  intervals: Array<{ start: number; end: number }>,
  gap = 0,
): { rows: number[]; rowCount: number } {
  const order = intervals
    .map((_, i) => i)
    .sort((a, b) => intervals[a].start - intervals[b].start || intervals[a].end - intervals[b].end || a - b);
  const rowEnds: number[] = [];
  const rows = new Array<number>(intervals.length).fill(0);
  for (const i of order) {
    const it = intervals[i];
    let row = 0;
    while (row < rowEnds.length && it.start <= rowEnds[row] + gap) row++;
    rows[i] = row;
    rowEnds[row] = it.end;
  }
  return { rows, rowCount: rowEnds.length };
}

/** A day-level prep fact — one rehearsal/residency date row, bucketed. */
export interface PrepDay {
  project_id: string;
  /** YYYY-MM-DD. */
  day: string;
  /** Display label (title, or the caller's kind label). */
  label: string;
}

/** A merged run of consecutive prep days. Both ends inclusive. */
export interface PrepRun {
  project_id: string;
  from: string;
  to: string;
  label: string;
}

/**
 * Merge day-level rehearsal/residency rows into consecutive-day runs per
 * project (ADR-080 §7 — "bandas de assaigs en el carril"). A run breaks
 * on a gap day or a label change; duplicate days collapse. The caller
 * pre-filters kinds and cancelled rows — this only does the run math.
 */
export function prepRuns(days: PrepDay[]): PrepRun[] {
  const byProject = new Map<string, PrepDay[]>();
  for (const d of days) {
    const list = byProject.get(d.project_id);
    if (list) list.push(d);
    else byProject.set(d.project_id, [d]);
  }
  const runs: PrepRun[] = [];
  for (const list of byProject.values()) {
    const sorted = [...list].sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0));
    let run: PrepRun | null = null;
    for (const d of sorted) {
      if (run && d.day === run.to) continue; // duplicate day
      if (run && d.day === addDaysIso(run.to, 1) && d.label === run.label) {
        run.to = d.day;
        continue;
      }
      if (run) runs.push(run);
      run = { project_id: d.project_id, from: d.day, to: d.day, label: d.label };
    }
    if (run) runs.push(run);
  }
  return runs.sort((a, b) => (a.from < b.from ? -1 : a.from > b.from ? 1 : 0));
}

