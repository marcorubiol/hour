/**
 * Carrils — the pure logic of the Calendar lens' third projection
 * (ADR-079 §7/§8): the horizontal month ribbon grouped per espai /
 * projecte / persona (the Loom). Same contract as $lib/calendar: every
 * function is pure, day-precision, string ISO-date compares only — the
 * page supplies the rows and "today", the component measures pixels.
 */

import { addDaysIso } from './calendar';

/** The three groupings of the carrils projection (ADR-079 §8). */
export type CarrilsGroup = 'espai' | 'projecte' | 'persona';

function isCarrilsGroup(v: string | null | undefined): v is CarrilsGroup {
  return v === 'espai' || v === 'projecte' || v === 'persona';
}

/**
 * Grouping resolution — same persistence chain as the projection
 * (ADR-078 §10 via ADR-079 §8): explicit `&group=` → the device's stored
 * preference → 'espai'. Unknown values fall through.
 */
export function resolveCarrilsGroup(
  urlGroup: string | null | undefined,
  stored: string | null | undefined,
): CarrilsGroup {
  if (isCarrilsGroup(urlGroup)) return urlGroup;
  if (isCarrilsGroup(stored)) return stored;
  return 'espai';
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
 * project (ADR-079 §7 — "bandas de assaigs en el carril"). A run breaks
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

// ── The Loom (Agrupa per Persona — ADR-079 §8) ─────────────────────────

/** One person-day commitment: they are on this gig's roster. */
export interface LoomCommitment {
  person_id: string;
  /** YYYY-MM-DD. */
  day: string;
  project_id: string;
  state: 'confirmed' | 'hold';
}

/** A person-level blackout as the loom consumes it. */
export interface LoomBlackoutInput {
  person_id: string | null;
  starts_on: string;
  ends_on: string;
  certainty: string;
}

/** A people-conflict day: these persons are pulled two places at once. */
export interface LoomKnotInput {
  /** YYYY-MM-DD. */
  day: string;
  person_ids: string[];
}

export interface LoomTeamPerson {
  person_id: string;
  workspace_id: string;
  full_name: string;
}

/** One thread segment — a merged run of same-state commitment days. */
export interface LoomSegment {
  from: string;
  to: string;
  project_id: string;
  state: 'confirmed' | 'hold' | 'prep';
}

export interface LoomThread {
  person_id: string;
  name: string;
  /** Committed to more than one project this month. */
  shared: boolean;
  /** No data at all — baseline thread + "sense dades" badge. */
  ghost: boolean;
  segments: LoomSegment[];
  /** Person blackouts clipped to the month. */
  outs: Array<{ from: string; to: string; tentative: boolean }>;
  /** Knot days (people conflicts involving this person). */
  knots: string[];
}

export interface LoomGroup {
  /** project_id ('project') or workspace_id ('workspace'). */
  key: string;
  kind: 'project' | 'workspace';
  threads: LoomThread[];
}

/**
 * The Loom model (ADR-079 §8): one thread per team person, grouped by the
 * project that claims most of their committed days (their "home" this
 * month); persons whose commitments span several projects keep ONE thread
 * (all segments on it) and a shared badge. Persons with no data at all
 * become ghost threads grouped under their workspace.
 *
 * Prep attribution is derived, not stored: a project's rehearsal run
 * lands as a faded segment on the threads of the persons that project's
 * rosters name this month — the only person↔project link the data has.
 * Company-wide blackouts stay OFF the threads on purpose: one workspace
 * fact multiplied into N person pills would shout; mes/agenda/espai
 * already tell it once.
 *
 * Group order: projects by their earliest committed day; workspace groups
 * (data-less people) after, in team order. Threads: committed first (by
 * first day, then name), ghosts last by name.
 */
export function loomThreads(input: {
  team: LoomTeamPerson[];
  commitments: LoomCommitment[];
  preps: PrepRun[];
  blackouts: LoomBlackoutInput[];
  knots: LoomKnotInput[];
  /** Visible month, both ends inclusive (clips outs). */
  monthFrom: string;
  monthTo: string;
}): LoomGroup[] {
  const { commitments, preps, blackouts, knots, monthFrom, monthTo } = input;

  // ONE thread per person: /api/team dedupes per workspace, so a person
  // serving two workspaces arrives twice — first row wins.
  const seenPersons = new Set<string>();
  const team = input.team.filter((p) =>
    seenPersons.has(p.person_id) ? false : (seenPersons.add(p.person_id), true),
  );

  // Per person: committed days per project + merged runs.
  const byPerson = new Map<string, LoomCommitment[]>();
  for (const c of commitments) {
    const list = byPerson.get(c.person_id);
    if (list) list.push(c);
    else byPerson.set(c.person_id, [c]);
  }
  // Person ↔ project membership (roster-derived) for prep attribution.
  const membership = new Map<string, Set<string>>();
  for (const c of commitments) {
    (membership.get(c.person_id) ?? membership.set(c.person_id, new Set()).get(c.person_id)!).add(
      c.project_id,
    );
  }

  const threads = new Map<string, LoomThread>();
  const projectFirstDay = new Map<string, string>();
  const homeProject = new Map<string, string>();

  for (const person of team) {
    const rows = byPerson.get(person.person_id) ?? [];
    // Merge same-project same-state consecutive days into segments.
    const segments: LoomSegment[] = [];
    const keyed = new Map<string, string[]>();
    for (const r of rows) {
      const k = `${r.project_id}::${r.state}`;
      (keyed.get(k) ?? keyed.set(k, []).get(k)!).push(r.day);
    }
    for (const [k, days] of keyed) {
      const [project_id, state] = k.split('::') as [string, 'confirmed' | 'hold'];
      const sorted = [...new Set(days)].sort();
      let from = sorted[0];
      let to = sorted[0];
      for (const day of sorted.slice(1)) {
        if (day === addDaysIso(to, 1)) {
          to = day;
        } else {
          segments.push({ from, to, project_id, state });
          from = day;
          to = day;
        }
      }
      segments.push({ from, to, project_id, state });
    }
    // Prep runs of the person's projects ride their thread, faded.
    for (const run of preps) {
      if (membership.get(person.person_id)?.has(run.project_id)) {
        segments.push({ from: run.from, to: run.to, project_id: run.project_id, state: 'prep' });
      }
    }
    segments.sort((a, b) => (a.from < b.from ? -1 : a.from > b.from ? 1 : 0));

    const outs = blackouts
      .filter(
        (b) =>
          b.person_id === person.person_id && b.starts_on <= monthTo && b.ends_on >= monthFrom,
      )
      .map((b) => ({
        from: b.starts_on < monthFrom ? monthFrom : b.starts_on,
        to: b.ends_on > monthTo ? monthTo : b.ends_on,
        tentative: b.certainty === 'tentative',
      }))
      .sort((a, b) => (a.from < b.from ? -1 : a.from > b.from ? 1 : 0));

    const knotDays = [
      ...new Set(
        knots.filter((k) => k.person_ids.includes(person.person_id)).map((k) => k.day),
      ),
    ].sort();

    // Home = the project holding most committed (non-prep) days; ties
    // break on earliest day, then id — deterministic across renders.
    const perProject = new Map<string, { days: number; first: string }>();
    for (const s of segments) {
      if (s.state === 'prep') continue;
      const span =
        (Date.parse(`${s.to}T00:00:00Z`) - Date.parse(`${s.from}T00:00:00Z`)) / 86400000 + 1;
      const cur = perProject.get(s.project_id);
      if (cur) {
        cur.days += span;
        if (s.from < cur.first) cur.first = s.from;
      } else {
        perProject.set(s.project_id, { days: span, first: s.from });
      }
    }
    let home: string | null = null;
    let best: { days: number; first: string } | null = null;
    for (const [pid, agg] of perProject) {
      if (
        best === null ||
        agg.days > best.days ||
        (agg.days === best.days &&
          (agg.first < best.first || (agg.first === best.first && pid < (home as string))))
      ) {
        home = pid;
        best = agg;
      }
    }
    if (home) homeProject.set(person.person_id, home);
    for (const [pid, agg] of perProject) {
      const cur = projectFirstDay.get(pid);
      if (cur === undefined || agg.first < cur) projectFirstDay.set(pid, agg.first);
    }

    threads.set(person.person_id, {
      person_id: person.person_id,
      name: person.full_name,
      shared: perProject.size > 1,
      ghost: segments.length === 0 && outs.length === 0 && knotDays.length === 0,
      segments,
      outs,
      knots: knotDays,
    });
  }

  // Assemble groups: projects by earliest day, then workspace leftovers.
  const projectIds = [...projectFirstDay.keys()].sort((a, b) => {
    const fa = projectFirstDay.get(a)!;
    const fb = projectFirstDay.get(b)!;
    return fa < fb ? -1 : fa > fb ? 1 : a < b ? -1 : 1;
  });

  const firstSegDay = (t: LoomThread) => t.segments[0]?.from ?? '9999-12-31';
  const threadOrder = (a: LoomThread, b: LoomThread) => {
    const fa = firstSegDay(a);
    const fb = firstSegDay(b);
    if (fa !== fb) return fa < fb ? -1 : 1;
    return a.name.localeCompare(b.name);
  };

  const groups: LoomGroup[] = [];
  for (const pid of projectIds) {
    const members = team
      .map((p) => threads.get(p.person_id)!)
      .filter((t) => homeProject.get(t.person_id) === pid)
      .sort(threadOrder);
    if (members.length > 0) groups.push({ key: pid, kind: 'project', threads: members });
  }
  // People without a home project, grouped under their workspace (team
  // order); ghosts sort behind those who at least have outs/knots.
  const wsSeen: string[] = [];
  const wsMembers = new Map<string, LoomThread[]>();
  for (const p of team) {
    if (homeProject.has(p.person_id)) continue;
    if (!wsMembers.has(p.workspace_id)) {
      wsSeen.push(p.workspace_id);
      wsMembers.set(p.workspace_id, []);
    }
    wsMembers.get(p.workspace_id)!.push(threads.get(p.person_id)!);
  }
  for (const ws of wsSeen) {
    const members = wsMembers
      .get(ws)!
      .sort((a, b) => Number(a.ghost) - Number(b.ghost) || a.name.localeCompare(b.name));
    groups.push({ key: ws, kind: 'workspace', threads: members });
  }
  return groups;
}
