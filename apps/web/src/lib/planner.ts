/**
 * Calendar month math + the calendar-v2 pure engine (ADR-072/078) —
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
import { decideBy, isHoldStatus, performanceStatusFamily } from './performance';

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

export type ConflictSeverity =
  | 'people'
  | 'double'
  | 'possible'
  | 'blackout'
  | 'blackout-tentative'
  | 'concurrence';

/**
 * Day-precision projection of a performance or date row. `day` is bucketed
 * upstream (via `dayKeyInTz` / `all_day` slice — MonthGrid's rule);
 * `workspace_id` scopes company-wide blackouts, `project_id` keeps a
 * project's own plan (gig + travel + rehearsal on one day) from clashing
 * with itself. `kind`/`status` unlock the status-aware severities
 * (ADR-080 §3) — callers that don't pass them get the ADR-072/078
 * behavior unchanged.
 */
export interface PlannerEvent {
  id: string;
  /** YYYY-MM-DD. */
  day: string;
  project_id: string;
  workspace_id: string;
  /** 'performance' opts into double/concurrence; date rows/legacy callers omit it. */
  kind?: 'performance' | 'date';
  /** performance_status — read only when kind is 'performance'. */
  status?: string;
}

export interface Conflict {
  severity: ConflictSeverity;
  /** Pair for people/double/possible/concurrence; single event vs a blackout. */
  event_ids: [string, string] | [string];
  /** The shared/blocked people. Empty for 'double', 'possible', 'concurrence' and company-wide blackouts. */
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

/** Most severe first — the output ordering of `conflictsFor` (ADR-080 §3:
 * 'concurrence' is the quiet tier, below everything else). */
const SEVERITY_RANK: Record<ConflictSeverity, number> = {
  people: 0,
  double: 1,
  blackout: 2,
  'blackout-tentative': 3,
  possible: 4,
  concurrence: 5,
};

/** hold* performance — the only shape the status-aware severities read. */
function isHoldPerf(e: PlannerEvent): boolean {
  return e.kind === 'performance' && e.status !== undefined && isHoldStatus(e.status);
}

/**
 * The conflict engine (ADR-072 §1 / ADR-078 / ADR-080 §3). Conflict =
 * shared PEOPLE, not coinciding dates:
 *
 * - 'people'    — same day, DIFFERENT projects, both rosters known
 *                 (non-empty) and sharing ≥1 person.
 * - 'double'    — SAME project, two performances the same day, at least
 *                 one hold* ("el mateix espectacle, dos llocs" —
 *                 confirmed-vs-hold counts). ADR-080 §3: supersedes the
 *                 blanket same-project silence for perf-vs-perf pairs ONLY.
 * - 'possible'  — same day, different projects, ≥1 roster empty — the
 *                 honest "no team data" degradation (never a confirmed
 *                 clash without roster data).
 * - 'blackout'  — an event's day falls inside a certainty='unavailable'
 *                 block whose person is on the event's roster, or a
 *                 company-wide block (person_id null) of the event's
 *                 workspace.
 * - 'blackout-tentative' — same overlap, certainty='tentative'.
 * - 'concurrence' — cross-project same-day pair, BOTH sides hold*, both
 *                 rosters known and DISJOINT. The quiet tier ("es veu, no
 *                 crida"): it sorts below every other severity and never
 *                 marks a cell.
 *
 * Other same-project pairs never clash pairwise: gig + travel + rehearsal
 * of one project on one day is the project's own plan, and its people
 * overlap by construction — zero signal, all noise. Cross-company
 * double-booking (the ADR-072 §6 symmetry) is cross-project by nature, so
 * nothing real is lost.
 *
 * Output is sorted most-severe-first ('people' → 'double' → 'blackout' →
 * 'blackout-tentative' → 'possible' → 'concurrence'), stable within a
 * rank. Away bands are NEVER an input here (ADR-078 §6 — display-only
 * inference).
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
        const bothPerfs = a.kind === 'performance' && b.kind === 'performance';
        if (a.project_id === b.project_id) {
          // Two performances of ONE project on one day with a hold in
          // play is the double-booking the same-project silence was
          // hiding (ADR-080 §3); perf+travel+rehearsal stays silent.
          if (bothPerfs && (isHoldPerf(a) || isHoldPerf(b))) {
            out.push({ severity: 'double', event_ids: [a.id, b.id], person_ids: [] });
          }
          continue;
        }
        const rosterA = rosters[a.id] ?? [];
        const rosterB = rosters[b.id] ?? [];
        if (rosterA.length > 0 && rosterB.length > 0) {
          const setB = new Set(rosterB);
          const shared = [...new Set(rosterA)].filter((id) => setB.has(id));
          if (shared.length > 0) {
            out.push({ severity: 'people', event_ids: [a.id, b.id], person_ids: shared });
          } else if (bothPerfs && isHoldPerf(a) && isHoldPerf(b)) {
            // Known, disjoint teams, both still options — the quiet
            // "same day, no people friction" read (ADR-080 §3).
            out.push({ severity: 'concurrence', event_ids: [a.id, b.id], person_ids: [] });
          }
          // Both rosters known and disjoint otherwise: no conflict —
          // that's the point.
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

/**
 * A performance row as the decisions queue consumes it (ADR-080 §1). The
 * caller fetches the hold window ([today, today+90d] — the function is
 * pure, it just receives rows) and buckets `day` upstream; the display
 * refs ride onto the card untouched.
 */
export interface DecisionPerformance {
  id: string;
  /** Gig day, YYYY-MM-DD. */
  day: string;
  project_id: string;
  workspace_id: string;
  status: string;
  /** ADR-080 §2 — NULL = standard notice, 0 = none, N = days before. */
  hold_notice_days: number | null;
  /** Project name (display). */
  project: string;
  venue: string | null;
  city: string | null;
  /** Display time (venue-local), caller-formatted. */
  time: string | null;
}

/** One side of a decision card — the perf ref the band renders. */
export type DecisionSide = Pick<
  DecisionPerformance,
  'id' | 'project' | 'venue' | 'city' | 'time' | 'status'
>;

/**
 * A derived decision (ADR-080 §1) — the projection of a conflict pair
 * where there are options to confront. Nothing stored: the queue re-reads
 * the truth on every render.
 */
export interface Decision {
  /** Stable across renders: day + perf ids sorted. */
  id: string;
  /** YYYY-MM-DD. */
  day: string;
  /** YYYY-MM — the queue spans months (window, not visible month). */
  month: string;
  level: 'people' | 'double' | 'possible';
  /** 'choose' = A o B · 'release' = one side already confirmed (ADR-080 §5). */
  kind: 'choose' | 'release';
  a: DecisionSide;
  b: DecisionSide;
  /** Shared person ids ('people' level only) — the caller maps to names. */
  people?: string[];
  urgent: boolean;
  /** min decideBy over the hold sides; null = no notice anywhere (never urgent). */
  decideBy: string | null;
}

/** A quiet concurrence row (ADR-080 §3) — "es veu, no crida". */
export interface Concurrence {
  id: string;
  day: string;
  month: string;
  a: DecisionSide;
  b: DecisionSide;
}

function decisionSide(p: DecisionPerformance): DecisionSide {
  return {
    id: p.id,
    project: p.project,
    venue: p.venue,
    city: p.city,
    time: p.time,
    status: p.status,
  };
}

function pairId(day: string, aId: string, bId: string): string {
  return `${day}:${[aId, bId].sort().join('+')}`;
}

/**
 * The decisions queue, derived (ADR-080 §1/§4): conflict pairs of
 * severities people|double|possible where ≥1 side is a hold* — kind
 * 'choose' while both are open, 'release' once one side of a
 * people/double pair is confirmed ("Ja has confirmat A — alliberar B?").
 * A 'possible' pair (≥1 roster unknown) is a decision only while BOTH
 * sides are open options: once one side is confirmed the queue cannot
 * assert friction without roster data, so the pair drops instead of
 * mutating to release — never a release prompt over unknown data
 * (ADR-080 §3: decisión cuando ambos lados tienen opciones que
 * confrontar; §5's follow-up is people|double only).
 * Urgency (ADR-080 §2): today ≥ min decideBy over the HOLD sides
 * (`decideBy` from $lib/performance; notice 0 contributes nothing — a
 * hold without notice never turns urgent).
 *
 * Concurrences come back SEPARATELY: they are seen, never counted as
 * decisions and never urgent (ADR-080 §3).
 *
 * Blackouts are NOT an input: they only ever yield single-event
 * severities, which the pair filter below discards — a queue that asked
 * for them would fetch rows it can never use.
 *
 * Decisions sort urgent-first, then by day; stable (severity order of the
 * engine breaks remaining ties). Cancelled rows are dropped — a cancelled
 * gig is not an option to confront.
 */
export function decisionsFor(input: {
  performances: DecisionPerformance[];
  rosters: Record<string, string[]>;
  /** YYYY-MM-DD — the caller's "today" (the function stays pure). */
  today: string;
}): { decisions: Decision[]; concurrences: Concurrence[] } {
  const { performances, rosters, today } = input;
  const alive = performances.filter((p) => p.status !== 'cancelled');
  const byId = new Map(alive.map((p) => [p.id, p]));
  const events: PlannerEvent[] = alive.map((p) => ({
    id: p.id,
    day: p.day,
    project_id: p.project_id,
    workspace_id: p.workspace_id,
    kind: 'performance',
    status: p.status,
  }));

  const decisions: Decision[] = [];
  const concurrences: Concurrence[] = [];
  for (const c of conflictsFor(events, rosters, [])) {
    if (c.event_ids.length !== 2) continue; // blackout severities — single-event
    const a = byId.get(c.event_ids[0]);
    const b = byId.get(c.event_ids[1]);
    if (!a || !b) continue;

    if (c.severity === 'concurrence') {
      concurrences.push({
        id: pairId(a.day, a.id, b.id),
        day: a.day,
        month: a.day.slice(0, 7),
        a: decisionSide(a),
        b: decisionSide(b),
      });
      continue;
    }
    if (c.severity !== 'people' && c.severity !== 'double' && c.severity !== 'possible') {
      continue;
    }
    const holdA = isHoldStatus(a.status);
    const holdB = isHoldStatus(b.status);
    if (!holdA && !holdB) continue;

    const confirmedA = performanceStatusFamily(a.status) === 'confirmed';
    const confirmedB = performanceStatusFamily(b.status) === 'confirmed';
    if (c.severity === 'possible' && (confirmedA || confirmedB)) {
      // ADR-080 §3 — no roster data means no asserted friction: once one
      // side is confirmed there is nothing left to confront, and a
      // release prompt would push a destructive suggestion over unknown
      // data. The pair leaves the queue.
      continue;
    }
    const release = (confirmedA && holdB) || (confirmedB && holdA);

    let by: string | null = null;
    for (const side of [a, b]) {
      if (!isHoldStatus(side.status)) continue;
      const d = decideBy(side.day, side.hold_notice_days);
      if (d !== null && (by === null || d < by)) by = d;
    }

    decisions.push({
      id: pairId(a.day, a.id, b.id),
      day: a.day,
      month: a.day.slice(0, 7),
      level: c.severity,
      kind: release ? 'release' : 'choose',
      a: decisionSide(a),
      b: decisionSide(b),
      ...(c.severity === 'people' ? { people: c.person_ids } : {}),
      urgent: by !== null && today >= by,
      decideBy: by,
    });
  }

  // Urgent first, then by day; Array.sort is stable, so the engine's
  // severity order survives as the remaining tiebreak.
  decisions.sort((x, y) => {
    if (x.urgent !== y.urgent) return x.urgent ? -1 : 1;
    return x.day < y.day ? -1 : x.day > y.day ? 1 : 0;
  });
  concurrences.sort((x, y) => (x.day < y.day ? -1 : x.day > y.day ? 1 : 0));
  return { decisions, concurrences };
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

/** The three first-class projections of the Calendar lens (ADR-076;
 * ADR-080 §7 promotes 'carrils' to the third slot). */
export type PlannerView = 'month' | 'agenda' | 'carrils';

function isPlannerView(v: string | null | undefined): v is PlannerView {
  return v === 'month' || v === 'agenda' || v === 'carrils';
}

/**
 * Projection resolution (ADR-078 §10): explicit `?view=` → the device's
 * stored preference (localStorage) → form-factor default (narrow viewport
 * reads as agenda, wide as month — 'carrils' is never a default, ADR-080
 * §7 changes the roster, not the form-factor rule). Unknown values at
 * either level fall through — a mistyped URL never breaks the page.
 */
export function resolvePlannerView(
  urlView: string | null | undefined,
  stored: string | null | undefined,
  narrowViewport: boolean,
): PlannerView {
  if (isPlannerView(urlView)) return urlView;
  if (isPlannerView(stored)) return stored;
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
