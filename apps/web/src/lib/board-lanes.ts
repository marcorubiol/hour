/**
 * The Board's pure engine (Planner v3) — groups and lanes on both dial
 * values, cell placement, tallies with their three silences, folded day
 * columns, absence bands, clash weight, and the measured-pass geometry.
 *
 * Same contract as $lib/planner and $lib/people: every function is pure,
 * day-precision, string ISO-date compares only. The page supplies the rows
 * and "today"; the component measures pixels and feeds the geometry
 * functions real rects. Nothing here touches i18n — the caller owns every
 * word, this module owns every count.
 *
 * Two laws govern the whole file, both learned the hard way in the design
 * prototype:
 *
 * 1. **One writer per fact.** The lane count drifted from the rendered rows
 *    three separate times over there (grain, counters, dials) because a
 *    predicate written twice drifts as soon as one copy is edited. Here the
 *    meta line and the render both call `boardLaneCount`; placement and
 *    lane-birth share `laneEvents`; both absence record shapes pass through
 *    `normalizeAway` before anything reads them.
 *
 * 2. **Geometry never runs ahead of the data.** The person axis once drew
 *    an inferred all-team night on top of an away band — the same lane
 *    saying "out all day" and "maybe on the radio at 10h". Attribution goes
 *    through `peopleOf`/`personRowKeys` ($lib/people), where inference
 *    stops at the door of an absence and an explicit roster is never
 *    second-guessed.
 */

import { isWeekendIso, type LaneAxis } from '$lib/carrils';
import type { ClashVM, Slip } from '$lib/month-events';
import {
  noCastKey,
  noCastProjectId,
  peopleOf,
  personRowKeys,
  type PersonLink,
  type TeamItem,
} from '$lib/people';
import type { StatusFamily } from '$lib/performance';
import { addDaysIso, isoWeek } from '$lib/planner';

/**
 * The Board's dial — 'by scope | person'. The old axis words (workspace,
 * project, and the Catalan generation) are addresses now, translated once
 * on entry by $lib/carrils; they are not values of this type. The CANONICAL
 * definition is $lib/carrils' `LaneAxis` — this name is an alias of it, so
 * the engine and the dial can never disagree on what an axis is.
 */
export type BoardAxis = LaneAxis;

/* ══ GROUPS & LANES ══════════════════════════════════════════════════════
   The lane is always the atom the axis names: a PROJECT on the scope axis
   (the workspace is a heading, not a row — fixed depth, comparable rows,
   and every cell knows its project, which is what the + door needs), a
   PERSON on the person axis. Ghost and nocast are the two honest shapes of
   "we do not know who": ghost = a team knowingly unknown, said in the lane
   itself; nocast = events that resolved to nobody, so they are never
   homeless.
   ═══════════════════════════════════════════════════════════════════════ */

export interface BoardLaneRef {
  key: string;
  kind: 'project' | 'person' | 'ghost' | 'nocast';
  id: string | null;
  name: string;
  accent: string | null;
  initials: string | null;
  shared: boolean;
  /** THE ADDRESS (one mark, two levels): the space this lane lives at, for
      the surfaces that must carry it — a list that crosses spaces, a lane
      whose rail is off screen. Absent where the space is already said
      beside the row, which is the board's own case. */
  space?: { name: string; initials: string | null } | null;
}

export interface BoardGroup {
  key: string;
  kind: 'workspace' | 'project';
  id: string;
  name: string;
  /** A PROJECT group is a subject and wears its identity in the band; a
      SPACE is an address and wears none — its name runs down the rail, low
      (styles/identity.css). Absent on workspace groups by construction. */
  accent?: string | null;
  initials?: string | null;
  lanes: BoardLaneRef[];
}

/** One writer for each lane-key grammar — placement and group-building must
    agree on these strings or a cell lands beside no lane. The nocast key is
    $lib/people's (`nocast:<project>`), because `personRowKeys` already
    writes it and a second spelling here would be the drift this file exists
    to prevent. */
function projectLaneKey(projectId: string): string {
  return `project:${projectId}`;
}
function personLaneKey(projectId: string, personId: string): string {
  return `person:${projectId}:${personId}`;
}
function ghostLaneKey(projectId: string): string {
  return `ghost:${projectId}`;
}

/**
 * The scope axis: a band per WORKSPACE, one lane per PROJECT.
 *
 * `scopeProjectIds` is the expanded scope; null = Everything (every
 * workspace, every project). Lanes come out in the app's canonical project
 * order, never token-add order — two scopes holding the same projects must
 * draw the same board. An empty GROUP is dropped (a heading over nothing
 * says nothing), but an empty scoped LANE is kept: the reader asked for
 * that project, and a lane with nothing on it answers '—' (see
 * `laneTally`).
 */
export function scopeGroups(input: {
  scopeProjectIds: readonly string[] | null;
  workspaces: readonly { id: string; name: string }[];
  projects: readonly {
    id: string;
    workspace_id: string;
    name: string;
    accent: string | null;
    initials: string | null;
  }[];
}): BoardGroup[] {
  const allowed = input.scopeProjectIds === null ? null : new Set(input.scopeProjectIds);
  const groups: BoardGroup[] = [];
  for (const ws of input.workspaces) {
    const lanes: BoardLaneRef[] = [];
    for (const p of input.projects) {
      if (p.workspace_id !== ws.id) continue;
      if (allowed !== null && !allowed.has(p.id)) continue;
      lanes.push({
        key: projectLaneKey(p.id),
        kind: 'project',
        id: p.id,
        name: p.name,
        accent: p.accent,
        initials: p.initials,
        shared: false,
      });
    }
    if (lanes.length > 0) {
      groups.push({ key: `space:${ws.id}`, kind: 'workspace', id: ws.id, name: ws.name, lanes });
    }
  }
  return groups;
}

/**
 * The person axis: a band per PROJECT, lanes = the people on file for it
 * (the team feed's `project_ids`, inverted). A project with no team gets
 * ONE ghost lane — the cast is knowingly unknown, and that is a fact the
 * board states once, in a lane of its own, instead of pretending the
 * project has no rows. Person lanes carry no accent: hue is project
 * identity and the project is already the band.
 *
 * Nocast lanes are NOT built here — `laneEvents` appends them when an
 * event actually resolves to nobody, so placement and lane-birth share one
 * writer.
 */
export function personGroups(input: {
  projects: readonly { id: string; name: string; accent: string | null; initials: string | null }[];
  visibleProjectIds: ReadonlySet<string>;
  team: readonly TeamItem[];
  personNames: ReadonlyMap<string, string>;
  sharedPersonIds: ReadonlySet<string>;
}): BoardGroup[] {
  const groups: BoardGroup[] = [];
  for (const p of input.projects) {
    if (!input.visibleProjectIds.has(p.id)) continue;
    const lanes: BoardLaneRef[] = [];
    for (const m of input.team) {
      if (!(m.project_ids ?? []).includes(p.id)) continue;
      if (lanes.some((l) => l.id === m.person_id)) continue;
      lanes.push({
        key: personLaneKey(p.id, m.person_id),
        kind: 'person',
        id: m.person_id,
        name: input.personNames.get(m.person_id) ?? m.full_name,
        accent: null,
        initials: null,
        shared: input.sharedPersonIds.has(m.person_id),
      });
    }
    if (lanes.length === 0) {
      lanes.push({
        key: ghostLaneKey(p.id),
        kind: 'ghost',
        id: null,
        name: 'team',
        accent: null,
        initials: null,
        shared: false,
      });
    }
    groups.push({
      key: projectLaneKey(p.id),
      kind: 'project',
      id: p.id,
      name: p.name,
      accent: p.accent,
      initials: p.initials,
      lanes,
    });
  }
  return groups;
}

/**
 * THE single writer for 'N LANES': the sum of the OPEN groups' lanes. The
 * meta line and the render both call this — the prototype once said
 * "12 lanes" over nine rows because two sites each counted their own way.
 */
export function boardLaneCount(
  groups: readonly BoardGroup[],
  shutGroupKeys: ReadonlySet<string>,
): number {
  let n = 0;
  for (const g of groups) {
    if (!shutGroupKeys.has(g.key)) n += g.lanes.length;
  }
  return n;
}

/* ══ CELL PLACEMENT ══════════════════════════════════════════════════════ */

/** One calendar row as the board consumes it — the page builds the Slip
    (the ONE card vocabulary, ADR-095) and this module only decides WHERE
    it lands and on what evidence. */
export interface BoardEventIn {
  id: string;
  /** YYYY-MM-DD, already bucketed by the page's timezone rule. */
  day: string;
  project_id: string | null;
  kind: 'perf' | 'date' | 'travel';
  cert: StatusFamily;
  /** The row's own roster, when it has one (a performance does). */
  roster?: readonly string[] | null;
  /** Gig identity, with the venue name as fallback — see `laneTally`. */
  venue_id?: string | null;
  slip: Slip;
}

/** `link` is how the attribution was reached — 'explicit' always on the
    scope axis (a project does not get inferred onto its own event). The
    distinction must survive to the paint: an inferred slip draws dotted
    with an italic name, never a fainter one. */
export interface PlacedEvent {
  event: BoardEventIn;
  link: PersonLink;
}

/**
 * Place every event in its lane(s).
 *
 * Scope axis: partition by project — an event of a project with no lane on
 * the sheet is simply not on the sheet (scope already decided that; the
 * day '!' survives elsewhere, see `clashDayMarks`).
 *
 * Person axis: attribution is $lib/people's, verbatim — an explicit roster
 * wins and is NEVER filtered by absences (that collision is the clash
 * engine's to report, and filtering here would hide it from the one
 * surface built to show it); no roster → the project's cast minus whoever
 * is away that day, drawn 'inferred'; nobody left → the project's nocast
 * lane, appended here so its dates are never homeless. A rostered person
 * with no lane on file gets one too — a fact outranks the team feed.
 *
 * Returns the possibly-extended groups: lane-birth and placement are one
 * writer.
 */
export function laneEvents(input: {
  axis: BoardAxis;
  groups: readonly BoardGroup[];
  events: readonly BoardEventIn[];
  castByProject: ReadonlyMap<string, readonly string[]>;
  awayByDay: ReadonlyMap<string, ReadonlySet<string>>;
}): {
  groups: BoardGroup[];
  cells: ReadonlyMap<string, ReadonlyMap<string, readonly PlacedEvent[]>>;
} {
  const groups = input.groups.map((g) => ({ ...g, lanes: [...g.lanes] }));
  const laneKeys = new Set<string>();
  for (const g of groups) for (const l of g.lanes) laneKeys.add(l.key);

  const cells = new Map<string, Map<string, PlacedEvent[]>>();
  const place = (laneKey: string, day: string, event: BoardEventIn, link: PersonLink) => {
    let days = cells.get(laneKey);
    if (!days) {
      days = new Map();
      cells.set(laneKey, days);
    }
    let list = days.get(day);
    if (!list) {
      list = [];
      days.set(day, list);
    }
    list.push({ event, link });
  };

  if (input.axis === 'scope') {
    for (const e of input.events) {
      if (!e.project_id) continue;
      const key = projectLaneKey(e.project_id);
      if (laneKeys.has(key)) place(key, e.day, e, 'explicit');
    }
    return { groups, cells };
  }

  const groupByProject = new Map<string, (typeof groups)[number]>();
  for (const g of groups) groupByProject.set(g.id, g);

  for (const e of input.events) {
    if (!e.project_id) continue;
    const group = groupByProject.get(e.project_id);
    if (!group) continue; // project not on the sheet — same rule as scope

    const people = peopleOf({
      roster: e.roster,
      projectCast: input.castByProject.get(e.project_id),
      awayPersonIds: input.awayByDay.get(e.day),
    });
    const { keys, link } = personRowKeys(people, e.project_id);
    for (const k of keys) {
      const laneKey =
        noCastProjectId(k) !== null ? noCastKey(e.project_id) : personLaneKey(e.project_id, k);
      if (!laneKeys.has(laneKey)) {
        // Lane birth. Nocast is named for its project (the page words the
        // '· no cast' suffix); a rostered stranger gets their id as a name
        // until the team feed knows them — honest, and visible on purpose.
        group.lanes.push(
          noCastProjectId(k) !== null
            ? {
                key: laneKey,
                kind: 'nocast',
                id: e.project_id,
                name: group.name,
                accent: null,
                initials: null,
                shared: false,
              }
            : {
                key: laneKey,
                kind: 'person',
                id: k,
                name: k,
                accent: null,
                initials: null,
                shared: false,
              },
        );
        laneKeys.add(laneKey);
      }
      place(laneKey, e.day, e, link);
    }
  }
  return { groups, cells };
}

/* ══ TALLIES & THE THREE SILENCES ════════════════════════════════════════
   The tally counts GIG UNITS — identity = (venue_id ?? venue name) + day,
   deduped. This is the bolo proxy: planner performances do not carry bolo
   ids yet (they are born unlinked until the money-v3 follow-up UX exists),
   and the venue+day pair is the same identity fix the prototype's
   stillHeld() needed when two same-NAMED venues on different dates counted
   as one. Swap to real bolo ids when the linking UX lands.
   ═══════════════════════════════════════════════════════════════════════ */

export interface LaneTally {
  confirmed: number;
  options: number;
  notCast: number;
  /** Three different facts, never one shrug: 'dash' = nothing scoped at
      all ('—'); 'no_dates' = the lane worked (prep, travel, an absence, a
      date touched it) but played nowhere; 'no_data_yet' = a ghost lane —
      the cast is knowingly unknown, and it is said ONCE, here. */
  silence: 'counts' | 'dash' | 'no_dates' | 'no_data_yet';
}

export function laneTally(input: {
  placed: readonly PlacedEvent[];
  ghost: boolean;
  touched: boolean;
}): LaneTally {
  if (input.ghost) return { confirmed: 0, options: 0, notCast: 0, silence: 'no_data_yet' };

  // A released night is given back — struck through on the sheet, absent
  // from the count: it is not inventory and it is not an option.
  const units = new Map<string, { explicit: boolean; confirmed: boolean }>();
  for (const p of input.placed) {
    if (p.event.kind !== 'perf') continue;
    if (p.event.cert === 'released') continue;
    const identity = `${p.event.venue_id ?? p.event.slip.name}|${p.event.day}`;
    const u = units.get(identity) ?? { explicit: false, confirmed: false };
    if (p.link === 'explicit') u.explicit = true;
    if (p.event.cert === 'confirmed') u.confirmed = true;
    units.set(identity, u);
  }

  let confirmed = 0;
  let options = 0;
  let notCast = 0;
  for (const u of units.values()) {
    // A unit nobody is explicitly on is 'not cast' whatever its clock says:
    // a count built on inference cannot claim a person is booked.
    if (!u.explicit) notCast++;
    else if (u.confirmed) confirmed++;
    else options++;
  }

  if (confirmed + options + notCast > 0) {
    return { confirmed, options, notCast, silence: 'counts' };
  }
  const touched = input.touched || input.placed.length > 0;
  return { confirmed, options, notCast, silence: touched ? 'no_dates' : 'dash' };
}

/**
 * The shut lid's line — 'N projects|people · N confirmed · N options ·
 * N not cast'. `units` is the lane count (the word is the axis's, said by
 * the page); the rest sums the lanes' own tallies, so a lid can never
 * disagree with what it hides.
 */
export function groupTally(
  group: BoardGroup,
  tallies: ReadonlyMap<string, LaneTally>,
): { units: number; confirmed: number; options: number; notCast: number } {
  let confirmed = 0;
  let options = 0;
  let notCast = 0;
  for (const lane of group.lanes) {
    const t = tallies.get(lane.key);
    if (!t) continue;
    confirmed += t.confirmed;
    options += t.options;
    notCast += t.notCast;
  }
  return { units: group.lanes.length, confirmed, options, notCast };
}

/* ══ COLUMNS & FOLDS ═════════════════════════════════════════════════════
   Width is a claim — each axis counts its own ink. Days nobody claims
   collapse into one gap column; the fold is a measure, not a page turn.
   ═══════════════════════════════════════════════════════════════════════ */

export interface BoardColumn {
  kind: 'day' | 'gap';
  /** Inclusive ISO ends. A day column has from === to. */
  from: string;
  to: string;
  span: number;
  weekend: boolean;
  today: boolean;
  /** Boundary flags, asked at the BOUNDARY: does this column's first day
      start a week/month the previous column's LAST day was not in? A fold
      may swallow a Monday — the week rule simply does not draw that week —
      but never a 1st. `mstart` wins; the two are never both set. */
  wstart: boolean;
  mstart: boolean;
  /** The italic month name, once per month, on its first column — null on
      a whole-month gap whose label already IS the name (never twice). */
  monthStartName: string | null;
  gapLabel: string | null;
}

/** The engine's month register — lowercase, unlocalised ('aug' is the
    fact); the page may translate, the engine may not. */
const MONTH_WORDS = [
  'jan',
  'feb',
  'mar',
  'apr',
  'may',
  'jun',
  'jul',
  'aug',
  'sep',
  'oct',
  'nov',
  'dec',
] as const;

function monthWord(iso: string): string {
  return MONTH_WORDS[Number(iso.slice(5, 7)) - 1];
}

function dayNum(iso: string): number {
  return Number(iso.slice(8, 10));
}

/** ISO week key with its week-YEAR (the Thursday's year), because a
    growing horizon can hold the same week number twice a year apart. */
function isoWeekKey(iso: string): string {
  const dow = (new Date(`${iso}T00:00:00Z`).getUTCDay() + 6) % 7;
  const thursday = addDaysIso(iso, 3 - dow);
  return `${thursday.slice(0, 4)}-W${isoWeek(iso)}`;
}

/**
 * The days this board must draw wide — the active set the fold folds
 * around. Each axis counts its own ink: scope = placed days + prep days +
 * the first day of each absence run; person = placed days (attribution
 * already gated) + the first day of each absence. `today` is NOT seeded
 * here — whether today may fold is the caller's claim, not the engine's.
 */
export function activeDaySet(input: {
  axis: BoardAxis;
  cells: ReadonlyMap<string, ReadonlyMap<string, readonly PlacedEvent[]>>;
  prepDays: readonly string[];
  awayRuns: readonly AwayRun[];
}): Set<string> {
  const out = new Set<string>();
  for (const days of input.cells.values()) {
    for (const [day, list] of days) if (list.length > 0) out.add(day);
  }
  if (input.axis === 'scope') for (const d of input.prepDays) out.add(d);
  for (const r of input.awayRuns) out.add(r.from);
  return out;
}

/** Where the drawn horizon ends: max(lastActive + 2, today + boardDays).
    The RANGE still prints 'no end' — what grows is named, never counted. */
export function horizonEndIso(input: {
  todayIso: string;
  lastActiveIso: string | null;
  boardDays: number;
}): string {
  const byToday = addDaysIso(input.todayIso, input.boardDays);
  if (!input.lastActiveIso) return byToday;
  const byActive = addDaysIso(input.lastActiveIso, 2);
  return byActive > byToday ? byActive : byToday;
}

/**
 * Fold the timeline into columns. Runs of inactive days collapse into ONE
 * gap column; a run never crosses INTO a new month — it may start at a
 * 1st (a whole quiet August is one column named 'aug') but never swallows
 * one mid-run, so the month boundary always lands on a column edge.
 *
 * A fold of ONE day is still that day: it compresses nothing, so it keeps
 * everything a day has (its weekend, its today). A multi-day fold carries
 * neither — one flag over five folded days would lie about which of them
 * is Sunday.
 *
 * gapLabel: a whole calendar month → the month word; span > 1 → '19–23';
 * a single day → its number.
 */
export function buildColumns(input: {
  baseIso: string;
  endIso: string;
  active: ReadonlySet<string>;
  todayIso: string;
}): BoardColumn[] {
  const days: string[] = [];
  for (let d = input.baseIso; d <= input.endIso; d = addDaysIso(d, 1)) days.push(d);

  const cols: BoardColumn[] = [];
  let i = 0;
  while (i < days.length) {
    if (input.active.has(days[i])) {
      const d = days[i];
      cols.push({
        kind: 'day',
        from: d,
        to: d,
        span: 1,
        weekend: isWeekendIso(d),
        today: d === input.todayIso,
        wstart: false,
        mstart: false,
        monthStartName: null,
        gapLabel: null,
      });
      i++;
      continue;
    }
    let j = i;
    while (j + 1 < days.length && !input.active.has(days[j + 1]) && days[j + 1].slice(8) !== '01') {
      j++;
    }
    const from = days[i];
    const to = days[j];
    const span = j - i + 1;
    const wholeMonth = from.slice(8) === '01' && addDaysIso(to, 1).slice(8) === '01';
    cols.push({
      kind: 'gap',
      from,
      to,
      span,
      weekend: span === 1 && isWeekendIso(from),
      today: span === 1 && from === input.todayIso,
      wstart: false,
      mstart: false,
      monthStartName: null,
      gapLabel: wholeMonth
        ? monthWord(from)
        : span > 1
          ? `${dayNum(from)}–${dayNum(to)}`
          : `${dayNum(from)}`,
    });
    i = j + 1;
  }

  for (let k = 0; k < cols.length; k++) {
    const cur = cols[k];
    if (k > 0) {
      const prev = cols[k - 1];
      cur.mstart = cur.from.slice(0, 7) !== prev.to.slice(0, 7);
      cur.wstart = !cur.mstart && isoWeekKey(cur.from) !== isoWeekKey(prev.to);
    }
    const startsMonth = k === 0 ? cur.from.slice(8) === '01' : cur.mstart;
    if (startsMonth && cur.gapLabel !== monthWord(cur.from)) {
      cur.monthStartName = monthWord(cur.from);
    }
  }
  return cols;
}

/**
 * The folded run's ruler: one 1px fillet per swallowed day, drawn only
 * while a day can still be a MARK — a step under 6px stops being a measure
 * and becomes a texture, and a texture is not drawn; the fold label's
 * range word suffices.
 */
export function foldTicks(span: number, gapWidthPx: number): number[] {
  if (span <= 0) return [];
  const step = gapWidthPx / span;
  if (step < 6) return [];
  const out: number[] = [];
  for (let i = 0; i < span; i++) out.push(i * step);
  return out;
}

/* ══ ABSENCE BANDS ═══════════════════════════════════════════════════════
   An absence is ONE band whatever the axis. Two record shapes exist —
   a person's out (f/t · tent) and a project blackout (from/to · certainty)
   — but they are the same fact in two registers, so both normalise to one
   run before anything else may read them.
   ═══════════════════════════════════════════════════════════════════════ */

export interface AwayRun {
  laneKey: string;
  from: string;
  to: string;
  who: string;
  tentative: boolean;
}

export function normalizeAway(
  rec: {
    person_id?: string | null;
    f?: string;
    t?: string;
    tent?: boolean;
    from?: string;
    to?: string;
    starts_on?: string;
    ends_on?: string;
    certainty?: string | null;
    who: string;
  },
  laneKey: string,
): AwayRun {
  const from = rec.f ?? rec.from ?? rec.starts_on ?? '';
  return {
    laneKey,
    from,
    to: rec.t ?? rec.to ?? rec.ends_on ?? from,
    who: rec.who,
    tentative: rec.tent === true || rec.certainty === 'tentative',
  };
}

/**
 * One drawn segment of a run: consecutive DAY columns, cut at every week
 * or month boundary and at every fold (a gap column carries its own
 * compact mark instead of the band). `cont` = something of the run came
 * before this segment ('away Mia ⟶' resumes with an open left arrow);
 * `end` = the run's terminus is inside this segment (the arrowhead — a
 * run clipped by the board edge or ending inside a fold shows none).
 */
export interface AwaySegment {
  laneKey: string;
  run: AwayRun;
  startCol: number;
  endCol: number;
  cont: boolean;
  end: boolean;
}

export function awaySegments(
  runs: readonly AwayRun[],
  columns: readonly BoardColumn[],
): AwaySegment[] {
  const segs: AwaySegment[] = [];
  for (const run of runs) {
    let start = -1;
    let prev = -1;
    const flush = () => {
      if (start === -1) return;
      segs.push({
        laneKey: run.laneKey,
        run,
        startCol: start,
        endCol: prev,
        // Both flags are clipping facts, not bookkeeping: the run began
        // before this segment's first day / ends by its last day.
        cont: columns[start].from > run.from,
        end: columns[prev].to >= run.to,
      });
      start = -1;
    };
    for (let i = 0; i < columns.length; i++) {
      const c = columns[i];
      if (c.to < run.from || c.from > run.to) continue;
      if (c.kind === 'gap') {
        flush(); // the fold cuts the band; the gap cell says 'away' itself
        continue;
      }
      // A WEEK EDGE IS NOT A CUT ON A BOARD (Marco, 2026-08-09). The month
      // grid had to break a band at every week because its weeks are
      // separate ROWS — a band cannot span two of them. A board lane is one
      // continuous row, so cutting there only produced the same sentence
      // twice, side by side, with the first one's rule striking through the
      // second one's word. One absence is one fact and gets one band; the
      // only thing that may interrupt it is a FOLD, where the days it
      // covers are not drawn at all.
      if (start !== -1 && i !== prev + 1) flush();
      if (start === -1) start = i;
      prev = i;
    }
    flush();
  }
  return segs;
}

/**
 * Which columns reserve the 15px floor under their slips: every non-gap
 * column of a touched ISO week — the ROW grows, not just the marked cell,
 * because a row is as tall as its tallest cell and the band's sentence
 * must never land on a chip's name.
 */
export function awayFloorCols(
  runs: readonly AwayRun[],
  columns: readonly BoardColumn[],
): Map<string, Set<number>> {
  const out = new Map<string, Set<number>>();
  if (columns.length === 0) return out;
  const boardFrom = columns[0].from;
  const boardTo = columns[columns.length - 1].to;
  for (const run of runs) {
    const from = run.from > boardFrom ? run.from : boardFrom;
    const to = run.to < boardTo ? run.to : boardTo;
    if (from > to) continue;
    const weeks = new Set<string>();
    for (let d = from; d <= to; d = addDaysIso(d, 1)) weeks.add(isoWeekKey(d));
    let set = out.get(run.laneKey);
    if (!set) {
      set = new Set();
      out.set(run.laneKey, set);
    }
    for (let i = 0; i < columns.length; i++) {
      if (columns[i].kind === 'gap') continue;
      if (weeks.has(isoWeekKey(columns[i].from))) set.add(i);
    }
  }
  return out;
}

/* ══ CLASH ═══════════════════════════════════════════════════════════════ */

/**
 * The weight of the red rule — GRAVITY, NOT URGENCY: dashed while both
 * sides are holds, solid as soon as one side is ink. A running deadline
 * never promotes it (the prototype once read `expires` here and the same
 * pair drew two weights sixty pixels apart); the clock speaks in words on
 * the hold's own chip.
 */
export function clashWeight(a: StatusFamily, b: StatusFamily): 'soft' | 'hard' {
  return a === 'confirmed' || b === 'confirmed' ? 'hard' : 'soft';
}

export interface SlipClashMark {
  clash: 'soft' | 'hard';
  /** Severity is COLOUR (people = red); certainty of collision is STROKE. */
  people: boolean;
  /** The pair stacks in one cell and this slip has a later marked sibling —
      the rule runs across the 4px gap as ONE rule, not two marks. */
  }

/**
 * The per-slip marks — drawn ONLY when BOTH event ids are on the sheet: a
 * rule pointing at two while showing one is a lie. The day-level '!' does
 * not pass through here (see `clashDayMarks`) precisely so it survives the
 * scope this function respects.
 */
export function clashMarks(
  clashes: readonly ClashVM[],
  cells: ReadonlyMap<string, ReadonlyMap<string, readonly PlacedEvent[]>>,
): Map<string, SlipClashMark> {
  const where = new Map<string, Array<{ laneKey: string; day: string; idx: number; cert: StatusFamily }>>();
  for (const [laneKey, days] of cells) {
    for (const [day, list] of days) {
      list.forEach((p, idx) => {
        let arr = where.get(p.event.id);
        if (!arr) {
          arr = [];
          where.set(p.event.id, arr);
        }
        arr.push({ laneKey, day, idx, cert: p.event.cert });
      });
    }
  }

  const out = new Map<string, SlipClashMark>();
  for (const c of clashes) {
    if (c.event_ids.length !== 2) continue;
    const [a, b] = c.event_ids;
    const wa = where.get(a);
    const wb = where.get(b);
    if (!wa || !wb) continue;
    const weight = clashWeight(wa[0].cert, wb[0].cert);
    const people = c.severity === 'people';
    // The BRIDGE across the stacked pair's gap was computed here once and
    // died a killed experiment: Slip's own law is «no bridge across the
    // gap — the rule on each of the two says which pair, the gap stays
    // clean», so a flag no drawing reads is a claim without a speaker.
    for (const [id] of [
      [a, wa, wb],
      [b, wb, wa],
    ] as const) {
      const prev = out.get(id);
      out.set(id, {
        clash: prev?.clash === 'hard' ? 'hard' : weight,
        people: (prev?.people ?? false) || people,
      });
    }
  }
  return out;
}

/** A clash as the board consumes it — `ClashVM` resolved to its ISO day.
    (`ClashVM` itself carries no day; the page owns the day bucketing, same
    as it does for events.) */
export type BoardClash = ClashVM & { day: string };

/** The head '!' days. It never asked the filter: a clash with one half off
    the sheet still marks its day — the rule hides, the fact does not. */
export function clashDayMarks(
  clashes: readonly BoardClash[],
): Map<string, { people: boolean }> {
  const out = new Map<string, { people: boolean }>();
  for (const c of clashes) {
    const people = c.severity === 'people' || c.severity === 'blackout';
    const prev = out.get(c.day);
    out.set(c.day, { people: (prev?.people ?? false) || people });
  }
  return out;
}

/* ══ META ════════════════════════════════════════════════════════════════ */

export interface BoardMetaFacts {
  toDecide: number;
  urgent: number;
  fromIso: string;
  laneCount: number;
}

/**
 * The facts of the meta line — every value derived, none worded: the page
 * says 'from {d} · no end · a column is a day · {n} lanes' through t(),
 * and 'no end' is a static key, never a day count (what grows is not
 * counted). `laneCount` calls `boardLaneCount` — the same writer the
 * render uses, so the sentence can never disagree with the rows.
 */
export function boardMeta(input: {
  clashes: readonly BoardClash[];
  urgentHoldCount: number;
  columns: readonly BoardColumn[];
  groups: readonly BoardGroup[];
  shut: ReadonlySet<string>;
}): BoardMetaFacts {
  return {
    toDecide: input.clashes.length,
    urgent: input.urgentHoldCount,
    fromIso: input.columns.length > 0 ? input.columns[0].from : '',
    laneCount: boardLaneCount(input.groups, input.shut),
  };
}

/* ══ MEASURED-PASS GEOMETRY ══════════════════════════════════════════════
   Pure functions over rects. The component feeds real measurements after
   paint; the tests feed fake ones — jsdom cannot see pixels and its
   silence must never be mistaken for a green.
   ═══════════════════════════════════════════════════════════════════════ */

/**
 * The pinned axis's translateY (`--hdy`). `boardTop` is the board's rect
 * top in viewport space (negative once scrolled past); the head travels
 * down to compensate, bounded so the axis never leaves the board it
 * labels.
 */
export function pinHeadY(input: {
  boardTop: number;
  boardHeight: number;
  headOffsetTop: number;
  headHeight: number;
}): number {
  return Math.round(
    Math.max(
      0,
      Math.min(
        -(input.boardTop + input.headOffsetTop),
        input.boardHeight - input.headOffsetTop - input.headHeight,
      ),
    ),
  );
}

/**
 * A group label's translateY (`--gy`): it rides down while its own lanes
 * are on screen and stops at its group's last lane. `pinY` is the
 * board-relative y the travelling label's top should sit at (the pinned
 * axis's bottom edge — the caller composes it from `pinHeadY` + the head's
 * geometry); all inputs are board-relative offsets.
 */
export function groupLabelY(input: {
  pinY: number;
  groupTop: number;
  groupEnd: number;
  labelHeight: number;
}): number {
  const travel = Math.max(0, input.pinY - input.groupTop);
  const stop = Math.max(0, input.groupEnd - input.groupTop - input.labelHeight);
  return Math.round(Math.min(travel, stop));
}

/**
 * The now line's x and the label clamp. The line sits at the day's
 * fraction of today's column; the label always hangs RIGHT of the line
 * and from the evening on it retracts to the column edge — the CAPTION
 * moves, the line does not (`left = min(x, labelLeftMax(w))` in the
 * caller). 6px is the label's standing margin off the line and off the
 * column's right edge.
 */
export function nowLineX(input: { todayLeft: number; todayWidth: number; minutes: number }): {
  x: number;
  labelLeftMax: (labelWidth: number) => number;
} {
  const fr = Math.min(Math.max(input.minutes, 0), 1440) / 1440;
  return {
    x: Math.round(input.todayLeft + fr * input.todayWidth),
    labelLeftMax: (labelWidth: number) =>
      input.todayLeft + input.todayWidth - labelWidth - 6,
  };
}
