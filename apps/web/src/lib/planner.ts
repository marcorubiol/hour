/**
 * Month-grid + date math + the planner pure engine (ADR-072/078) —
 * roster rule, conflict detection, derived away bands.
 *
 * The grid is calendar-abstract (whole ISO days, Monday-first weeks);
 * timezone only enters when bucketing a timestamptz into a day, via
 * `dayKeyInTz`. Keep every function pure — the page supplies "today",
 * every comparison is a string ISO-date compare (day precision, never a
 * tz-sensitive Date).
 */

import type { AvailabilityItem } from './availability';
import type { DateRow } from './date';

export interface PlannerDay {
  /** ISO date, YYYY-MM-DD. */
  iso: string;
  /** False for leading/trailing days that pad the first/last week. */
  inMonth: boolean;
}

function isoOf(utc: Date): string {
  return utc.toISOString().slice(0, 10);
}

/**
 * Monday-first week grid covering the given month (1-12). Always returns
 * complete weeks — leading/trailing days belong to the neighbour months
 * and carry `inMonth: false`.
 */
export function monthGrid(year: number, month: number): PlannerDay[][] {
  const first = new Date(Date.UTC(year, month - 1, 1));
  // getUTCDay: 0=Sunday..6=Saturday → Monday-first offset 0..6.
  const lead = (first.getUTCDay() + 6) % 7;
  const start = new Date(Date.UTC(year, month - 1, 1 - lead));

  const weeks: PlannerDay[][] = [];
  const cursor = new Date(start);
  do {
    const week: PlannerDay[] = [];
    for (let i = 0; i < 7; i++) {
      week.push({
        iso: isoOf(cursor),
        inMonth: cursor.getUTCMonth() === month - 1,
      });
      cursor.setUTCDate(cursor.getUTCDate() + 1);
    }
    weeks.push(week);
  } while (cursor.getUTCMonth() === month - 1);
  return weeks;
}

/** Month arithmetic that survives year boundaries. Month is 1-12. */
export function addMonths(
  year: number,
  month: number,
  delta: number,
): { year: number; month: number } {
  const zero = year * 12 + (month - 1) + delta;
  return { year: Math.floor(zero / 12), month: (((zero % 12) + 12) % 12) + 1 };
}

/** ISO date ± n days (UTC math — plain dates never touch a timezone). */
export function addDaysIso(iso: string, delta: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}

/**
 * Bucket a timestamptz into the ISO day it falls on in `timeZone`.
 * en-CA formats as YYYY-MM-DD natively.
 */
export function dayKeyInTz(isoTimestamp: string, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(isoTimestamp));
}

/**
 * The raw material of a performance's roster, source-shape agnostic: the
 * project's canonical cast, the gig's cast overrides, the gig's crew.
 */
export interface RosterParts {
  /** Person ids of the project's canonical cast (`cast_member`). */
  cast: string[];
  /** Per-gig substitutions (`cast_override`): who comes in, who they replace. */
  overrides: Array<{ person_id: string; replaces_person_id: string | null }>;
  /** Person ids of the gig's crew (`crew_assignment`). */
  crew: string[];
}

/**
 * Who is actually on this gig (ADR-072 §1): project cast_member − replaced
 * + cast_override + crew_assignment, deduped. The single roster rule —
 * the batched `?rosters=1` fetch and `performanceRoster(bundle)` (the
 * detail-bundle adapter) both reduce to this, so month view and detail
 * page can never disagree on who is involved.
 */
export function rosterPersonIds(parts: RosterParts): string[] {
  const replaced = new Set<string>();
  for (const o of parts.overrides) {
    if (o.replaces_person_id) replaced.add(o.replaces_person_id);
  }
  const out = new Set<string>();
  for (const id of parts.cast) {
    if (!replaced.has(id)) out.add(id);
  }
  for (const o of parts.overrides) out.add(o.person_id);
  for (const id of parts.crew) out.add(id);
  return [...out];
}

/**
 * The structural slice of `PerformanceBundleResult` that the roster rule
 * needs — declared here (not imported from `$lib/server/performance-bundle`)
 * so this module stays importable client-side. The real bundle is
 * assignable as-is; extra fields ride along untouched.
 */
export interface RosterBundle {
  performance: {
    cast_override: Array<{
      person: { id: string } | null;
      replaces_person: { id: string } | null;
    }>;
    crew_assignment: Array<{ person: { id: string } | null }>;
  };
  cast_members: Array<{ person: { id: string } | null }>;
}

/**
 * Thin adapter: detail bundle → `rosterPersonIds`. Person embeds RLS hid
 * (null) are dropped; an override whose substitute is hidden is dropped
 * WHOLE — applying its removal without its addition would understate the
 * roster on half a fact.
 */
export function performanceRoster(bundle: RosterBundle): string[] {
  const overrides: RosterParts['overrides'] = [];
  for (const o of bundle.performance.cast_override) {
    if (!o.person) continue;
    overrides.push({
      person_id: o.person.id,
      replaces_person_id: o.replaces_person?.id ?? null,
    });
  }
  return rosterPersonIds({
    cast: bundle.cast_members.flatMap((c) => (c.person ? [c.person.id] : [])),
    overrides,
    crew: bundle.performance.crew_assignment.flatMap((c) =>
      c.person ? [c.person.id] : [],
    ),
  });
}

export type ConflictSeverity = 'people' | 'possible' | 'blackout' | 'blackout-tentative';

/**
 * Day-precision projection of a performance or date row. `day` is bucketed
 * upstream (via `dayKeyInTz` / `all_day` slice — MonthGrid's rule);
 * `workspace_id` scopes company-wide blackouts, `project_id` keeps a
 * project's own plan (gig + travel + rehearsal on one day) from clashing
 * with itself.
 */
export interface PlannerEvent {
  id: string;
  /** YYYY-MM-DD. */
  day: string;
  project_id: string;
  workspace_id: string;
}

export interface Conflict {
  severity: ConflictSeverity;
  /** Pair for people/possible; single event vs a blackout. */
  event_ids: [string, string] | [string];
  /** The shared/blocked people. Empty for 'possible' and company-wide blackouts. */
  person_ids: string[];
  /** Set on blackout severities. */
  availability_block_id?: string;
}

/**
 * What `conflictsFor` reads off a blackout — a structural subset of
 * `AvailabilityItem`, so both the API items and bare rows fit.
 */
export type BlackoutInput = Pick<
  AvailabilityItem,
  'id' | 'workspace_id' | 'person_id' | 'starts_on' | 'ends_on' | 'certainty'
>;

/** Most severe first — the output ordering of `conflictsFor`. */
const SEVERITY_RANK: Record<ConflictSeverity, number> = {
  people: 0,
  blackout: 1,
  'blackout-tentative': 2,
  possible: 3,
};

/**
 * The conflict engine (ADR-072 §1 / ADR-078). Conflict = shared PEOPLE,
 * not coinciding dates:
 *
 * - 'people'    — same day, DIFFERENT projects, both rosters known
 *                 (non-empty) and sharing ≥1 person.
 * - 'possible'  — same day, different projects, ≥1 roster empty — the
 *                 honest "no team data" degradation (never a confirmed
 *                 clash without roster data).
 * - 'blackout'  — an event's day falls inside a certainty='unavailable'
 *                 block whose person is on the event's roster, or a
 *                 company-wide block (person_id null) of the event's
 *                 workspace.
 * - 'blackout-tentative' — same overlap, certainty='tentative'.
 *
 * Same-project pairs never clash pairwise: gig + travel + rehearsal of one
 * project on one day is the project's own plan, and its people overlap by
 * construction — zero signal, all noise. Cross-company double-booking (the
 * ADR-072 §6 symmetry) is cross-project by nature, so nothing real is lost.
 *
 * Output is sorted most-severe-first ('people' → 'blackout' →
 * 'blackout-tentative' → 'possible'), stable within a rank. Away bands are
 * NEVER an input here (ADR-078 §6 — display-only inference).
 */
export function conflictsFor(
  events: PlannerEvent[],
  rosters: Record<string, string[]>,
  blackouts: BlackoutInput[],
): Conflict[] {
  const out: Conflict[] = [];

  // Pairwise same-day clashes, grouped by day so the scan is n² per day.
  const byDay = new Map<string, PlannerEvent[]>();
  for (const e of events) {
    const list = byDay.get(e.day);
    if (list) list.push(e);
    else byDay.set(e.day, [e]);
  }
  for (const dayEvents of byDay.values()) {
    for (let i = 0; i < dayEvents.length; i++) {
      for (let j = i + 1; j < dayEvents.length; j++) {
        const a = dayEvents[i];
        const b = dayEvents[j];
        if (a.project_id === b.project_id) continue;
        const rosterA = rosters[a.id] ?? [];
        const rosterB = rosters[b.id] ?? [];
        if (rosterA.length > 0 && rosterB.length > 0) {
          const setB = new Set(rosterB);
          const shared = [...new Set(rosterA)].filter((id) => setB.has(id));
          if (shared.length > 0) {
            out.push({ severity: 'people', event_ids: [a.id, b.id], person_ids: shared });
          }
          // Both rosters known and disjoint: no conflict — that's the point.
        } else {
          out.push({ severity: 'possible', event_ids: [a.id, b.id], person_ids: [] });
        }
      }
    }
  }

  // Blackout overlaps — per event, per block. Person-level blocks apply
  // wherever the person is on the roster (cross-workspace visibility is
  // free by design, ADR-078 §5); company-wide blocks apply to the block's
  // own workspace only.
  for (const e of events) {
    const roster = rosters[e.id] ?? [];
    for (const block of blackouts) {
      if (e.day < block.starts_on || e.day > block.ends_on) continue;
      const involved =
        block.person_id === null
          ? block.workspace_id === e.workspace_id
          : roster.includes(block.person_id);
      if (!involved) continue;
      out.push({
        severity: block.certainty === 'tentative' ? 'blackout-tentative' : 'blackout',
        event_ids: [e.id],
        person_ids: block.person_id ? [block.person_id] : [],
        availability_block_id: block.id,
      });
    }
  }

  return out.sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity]);
}

/** One derived "fora" day-range (ADR-078 §6). Both ends inclusive. */
export interface AwayBand {
  from: string;
  to: string;
  project_id: string;
  line_id?: string;
}

/**
 * Derived away bands (ADR-078 §6): an 'outbound' travel_day on day X
 * paired with the NEXT 'return' travel_day on day Y of the SAME LINE
 * (line-less travel days pair per project — the fallback) ⇒ the days
 * strictly between (X, Y) that carry no own event for that project become
 * a band. Deterministic, no geography; display-only in v1 — never an
 * input to `conflictsFor()`.
 *
 * Honesty rules:
 * - Unpaired outbound/return ⇒ NO band (the AI layer proposes missing
 *   legs — never a second inference rule).
 * - 'leg' rows neither open nor close a trip.
 * - A second outbound while a trip is open is ignored (the earliest
 *   outbound brackets the trip); the return closes it.
 * - An own-event day inside the bracket splits the band into contiguous
 *   runs — a {from,to} range cannot represent a hole, and the event chip
 *   already tells that day's story.
 *
 * Day key = `starts_at.slice(0, 10)`: travel days are day-level facts
 * (all_day rows), and a string slice keeps the function timezone-free.
 */
export function awayBands(
  dates: Array<Pick<DateRow, 'id' | 'project_id' | 'line_id' | 'kind' | 'travel_direction' | 'starts_at'>>,
  ownEventDays: Record<string, string[]> = {},
): AwayBand[] {
  type Travel = { day: string; direction: 'outbound' | 'return'; line_id: string | null };

  // Pairing scope: the line when the row has one, the project otherwise.
  const groups = new Map<string, { project_id: string; line_id: string | null; travels: Travel[] }>();
  for (const d of dates) {
    if (d.kind !== 'travel_day') continue;
    if (d.travel_direction !== 'outbound' && d.travel_direction !== 'return') continue;
    const key = `${d.project_id}::${d.line_id ?? ''}`;
    let group = groups.get(key);
    if (!group) {
      group = { project_id: d.project_id, line_id: d.line_id, travels: [] };
      groups.set(key, group);
    }
    group.travels.push({
      day: d.starts_at.slice(0, 10),
      direction: d.travel_direction,
      line_id: d.line_id,
    });
  }

  const bands: AwayBand[] = [];
  for (const group of groups.values()) {
    // Chronological; a same-day outbound sorts before its return (their
    // strictly-between set is empty anyway, but the pairing must not skew).
    const sorted = [...group.travels].sort((a, b) =>
      a.day === b.day
        ? (a.direction === 'outbound' ? -1 : 1) - (b.direction === 'outbound' ? -1 : 1)
        : a.day < b.day
          ? -1
          : 1,
    );

    const eventDays = new Set(ownEventDays[group.project_id] ?? []);
    let openDay: string | null = null;
    for (const t of sorted) {
      if (t.direction === 'outbound') {
        if (openDay === null) openDay = t.day;
        continue;
      }
      if (openDay === null) continue; // unpaired return — no band
      // Contiguous runs of in-between days that carry no own event.
      let runStart: string | null = null;
      let prev: string | null = null;
      for (let day = addDaysIso(openDay, 1); day < t.day; day = addDaysIso(day, 1)) {
        if (eventDays.has(day)) {
          if (runStart !== null && prev !== null) {
            bands.push(makeBand(runStart, prev, group.project_id, group.line_id));
          }
          runStart = null;
          prev = null;
        } else {
          if (runStart === null) runStart = day;
          prev = day;
        }
      }
      if (runStart !== null && prev !== null) {
        bands.push(makeBand(runStart, prev, group.project_id, group.line_id));
      }
      openDay = null;
    }
  }
  return bands;
}

function makeBand(
  from: string,
  to: string,
  project_id: string,
  line_id: string | null,
): AwayBand {
  return line_id === null ? { from, to, project_id } : { from, to, project_id, line_id };
}

/** The two first-class projections of the Planner lens (ADR-076). */
export type PlannerView = 'month' | 'agenda';

/**
 * Projection resolution (ADR-078 §10): explicit `?view=` → the device's
 * stored preference (localStorage) → form-factor default (narrow viewport
 * reads as agenda, wide as month). Unknown values at either level fall
 * through — a mistyped URL never breaks the page.
 */
export function resolvePlannerView(
  urlView: string | null | undefined,
  stored: string | null | undefined,
  narrowViewport: boolean,
): PlannerView {
  if (urlView === 'month' || urlView === 'agenda') return urlView;
  if (stored === 'month' || stored === 'agenda') return stored;
  return narrowViewport ? 'agenda' : 'month';
}

/**
 * Greedy lane assignment for overlapping inclusive day ranges — the agenda
 * rail's capsule layout. Ranges are considered in chronological order
 * (from, then to) but the returned lanes index the INPUT order, so callers
 * keep their own list untouched. Overlap is string ISO-date compare, both
 * ends inclusive (two ranges sharing a single day still stack).
 */
export function assignBandLanes(
  bands: Array<{ from: string; to: string }>,
): { lanes: number[]; laneCount: number } {
  const order = bands
    .map((_, i) => i)
    .sort((a, b) => {
      const x = bands[a];
      const y = bands[b];
      if (x.from !== y.from) return x.from < y.from ? -1 : 1;
      if (x.to !== y.to) return x.to < y.to ? -1 : 1;
      return a - b;
    });
  const laneEnds: string[] = [];
  const lanes = new Array<number>(bands.length).fill(0);
  for (const i of order) {
    const b = bands[i];
    let lane = 0;
    while (lane < laneEnds.length && b.from <= laneEnds[lane]) lane++;
    lanes[i] = lane;
    laneEnds[lane] = b.to;
  }
  return { lanes, laneCount: laneEnds.length };
}

/**
 * The agenda's included-days rule (ADR-076/078): a day earns a group when
 * it carries an event OR sits inside a stored blackout. `days` is the
 * ordered day list of the visible range (the month); order is preserved.
 * Derived away bands deliberately do NOT create days — they are inference,
 * not facts (ADR-078 §6).
 */
export function agendaDayKeys(
  days: string[],
  eventDays: Iterable<string>,
  blackouts: Array<{ starts_on: string; ends_on: string }>,
): string[] {
  const withEvent = new Set(eventDays);
  return days.filter(
    (day) =>
      withEvent.has(day) ||
      blackouts.some((b) => day >= b.starts_on && day <= b.ends_on),
  );
}
