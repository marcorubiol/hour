import { describe, expect, it } from 'vitest';
import {
  activeDaySet,
  awayFloorCols,
  awaySegments,
  boardLaneCount,
  boardMeta,
  buildColumns,
  clashDayMarks,
  clashMarks,
  clashWeight,
  foldTicks,
  groupLabelY,
  groupTally,
  horizonEndIso,
  laneEvents,
  laneTally,
  nowLineX,
  normalizeAway,
  personGroups,
  pinHeadY,
  scopeGroups,
  type AwayRun,
  type BoardClash,
  type BoardEventIn,
  type PlacedEvent,
} from './board-lanes';
import type { ClashVM, Slip } from './month-events';
import type { StatusFamily } from './performance';
import type { TeamItem } from './people';

/* ── Fixtures — July 2026, the repo's month (the 18th is a Saturday). ──── */

const WORKSPACES = [
  { id: 'muk', name: 'MüK' },
  { id: 'demo', name: 'Demo' },
];

const PROJECTS = [
  { id: 'tres', workspace_id: 'muk', name: 'Tres voces', accent: 'var(--acc-1)', initials: 'TV' },
  { id: 'aur', workspace_id: 'muk', name: 'Aurora', accent: 'var(--acc-2)', initials: 'AU' },
  { id: 'zim', workspace_id: 'demo', name: 'Zimmer', accent: null, initials: null },
];

const TEAM: TeamItem[] = [
  { person_id: 'mia', workspace_id: 'muk', slug: 'mia', full_name: 'Mia Faura', project_ids: ['tres'] },
  { person_id: 'joan', workspace_id: 'muk', slug: 'joan', full_name: 'Joan Prat', project_ids: ['tres'] },
];

function mkSlip(name: string): Slip {
  return {
    id: 'slip',
    kind: 'show',
    cert: 'hold',
    name,
    lead: null,
    origin: null,
    city: null,
    country: null,
    time: null,
    project: null,
    hold: null,
    href: null,
    title: name,
  };
}

function mkEvent(o: {
  id: string;
  day: string;
  project_id?: string | null;
  kind?: BoardEventIn['kind'];
  cert?: StatusFamily;
  roster?: string[] | null;
  venue_id?: string | null;
  venueName?: string;
}): BoardEventIn {
  return {
    id: o.id,
    day: o.day,
    project_id: o.project_id === undefined ? 'tres' : o.project_id,
    kind: o.kind ?? 'perf',
    cert: o.cert ?? 'hold',
    roster: o.roster ?? null,
    venue_id: o.venue_id ?? null,
    slip: mkSlip(o.venueName ?? 'Sala Beckett'),
  };
}

function placed(event: BoardEventIn, link: PlacedEvent['link'] = 'explicit'): PlacedEvent {
  return { event, link };
}

function mkClash(ids: [string, string], severity: ClashVM['severity'] = 'possible'): ClashVM {
  return { severity, event_ids: ids, title: '', body: '', rows: [] };
}

const NO_CAST = new Map<string, readonly string[]>();
const NO_AWAY = new Map<string, ReadonlySet<string>>();

/* ── Groups & lanes ─────────────────────────────────────────────────────── */

describe('scopeGroups (law 7)', () => {
  it('a band per workspace, a lane per project — the workspace is a heading, not a row', () => {
    const groups = scopeGroups({
      scopeProjectIds: ['aur', 'zim', 'tres'],
      workspaces: WORKSPACES,
      projects: PROJECTS,
    });
    expect(groups.map((g) => g.key)).toEqual(['space:muk', 'space:demo']);
    expect(groups.every((g) => g.kind === 'workspace')).toBe(true);
    // Canonical project order, never token-add order.
    expect(groups[0].lanes.map((l) => l.key)).toEqual(['project:tres', 'project:aur']);
    expect(groups[1].lanes.map((l) => l.key)).toEqual(['project:zim']);
    expect(groups[0].lanes[0].kind).toBe('project');
  });

  it('Everything expands to one band per workspace with every project', () => {
    const groups = scopeGroups({
      scopeProjectIds: null,
      workspaces: WORKSPACES,
      projects: PROJECTS,
    });
    expect(groups.map((g) => g.lanes.length)).toEqual([2, 1]);
  });

  it('two scopes holding the same projects draw the same board', () => {
    const a = scopeGroups({ scopeProjectIds: ['tres', 'aur'], workspaces: WORKSPACES, projects: PROJECTS });
    const b = scopeGroups({ scopeProjectIds: ['aur', 'tres'], workspaces: WORKSPACES, projects: PROJECTS });
    expect(a).toEqual(b);
  });

  it("an empty group is dropped, but an empty scoped lane is kept — it answers '—'", () => {
    const groups = scopeGroups({
      scopeProjectIds: ['tres'],
      workspaces: WORKSPACES,
      projects: PROJECTS,
    });
    // Demo has nothing in scope: no heading over nothing. Tres has no
    // events anywhere and still has its lane — silence is laneTally's job.
    expect(groups.map((g) => g.id)).toEqual(['muk']);
    expect(groups[0].lanes.map((l) => l.id)).toEqual(['tres']);
  });
});

describe('personGroups (law 10)', () => {
  it('a band per project, lanes are the people on file; a teamless project gets its ghost lane', () => {
    const groups = personGroups({
      projects: PROJECTS.filter((p) => p.workspace_id === 'muk'),
      visibleProjectIds: new Set(['tres', 'aur']),
      team: TEAM,
      personNames: new Map([['mia', 'Mia F.']]),
      sharedPersonIds: new Set(['joan']),
    });
    expect(groups.map((g) => g.id)).toEqual(['tres', 'aur']);
    expect(groups[0].lanes.map((l) => l.id)).toEqual(['mia', 'joan']);
    // The reader-facing name wins over the feed's; the shared badge is a fact.
    expect(groups[0].lanes[0].name).toBe('Mia F.');
    expect(groups[0].lanes[1].name).toBe('Joan Prat');
    expect(groups[0].lanes[1].shared).toBe(true);
    // Aurora's cast is knowingly unknown — one ghost lane, not zero rows.
    expect(groups[1].lanes).toHaveLength(1);
    expect(groups[1].lanes[0].kind).toBe('ghost');
  });

  it('hue is project identity only — a person lane carries no accent', () => {
    const groups = personGroups({
      projects: [PROJECTS[0]],
      visibleProjectIds: new Set(['tres']),
      team: TEAM,
      personNames: new Map(),
      sharedPersonIds: new Set(),
    });
    expect(groups[0].lanes.every((l) => l.accent === null)).toBe(true);
  });
});

describe('boardLaneCount (law 8)', () => {
  it('the single writer: Σ open groups, shut lanes leave the count', () => {
    const groups = scopeGroups({ scopeProjectIds: null, workspaces: WORKSPACES, projects: PROJECTS });
    expect(boardLaneCount(groups, new Set())).toBe(3);
    expect(boardLaneCount(groups, new Set(['space:muk']))).toBe(1);
    expect(boardLaneCount(groups, new Set(['space:muk', 'space:demo']))).toBe(0);
  });
});

/* ── Cell placement ─────────────────────────────────────────────────────── */

describe('laneEvents on the scope axis', () => {
  const groups = scopeGroups({ scopeProjectIds: ['tres', 'aur'], workspaces: WORKSPACES, projects: PROJECTS });

  it('partitions by project and every placement is explicit', () => {
    const { cells } = laneEvents({
      axis: 'scope',
      groups,
      events: [mkEvent({ id: 'e1', day: '2026-07-18' }), mkEvent({ id: 'e2', day: '2026-07-19', project_id: 'aur' })],
      castByProject: NO_CAST,
      awayByDay: NO_AWAY,
    });
    expect(cells.get('project:tres')?.get('2026-07-18')?.map((p) => p.event.id)).toEqual(['e1']);
    expect(cells.get('project:aur')?.get('2026-07-19')?.[0].link).toBe('explicit');
  });

  it('an event outside the sheet does not invent a lane — scope already decided', () => {
    const out = laneEvents({
      axis: 'scope',
      groups,
      events: [mkEvent({ id: 'e1', day: '2026-07-18', project_id: 'zim' })],
      castByProject: NO_CAST,
      awayByDay: NO_AWAY,
    });
    expect(out.cells.size).toBe(0);
    expect(out.groups).toEqual(groups);
  });
});

describe('laneEvents on the person axis', () => {
  const groups = () =>
    personGroups({
      projects: [PROJECTS[0]],
      visibleProjectIds: new Set(['tres']),
      team: TEAM,
      personNames: new Map(),
      sharedPersonIds: new Set(),
    });
  const cast = new Map([['tres', ['mia', 'joan']]]);

  it('an explicit roster is never second-guessed — away and cast is a clash, not a filter', () => {
    const { cells } = laneEvents({
      axis: 'person',
      groups: groups(),
      events: [mkEvent({ id: 'e1', day: '2026-07-18', roster: ['mia'] })],
      castByProject: cast,
      awayByDay: new Map([['2026-07-18', new Set(['mia'])]]),
    });
    const hit = cells.get('person:tres:mia')?.get('2026-07-18');
    expect(hit?.map((p) => p.event.id)).toEqual(['e1']);
    expect(hit?.[0].link).toBe('explicit');
  });

  it("inference stops at the absence's door — someone away is never drawn as a candidate", () => {
    const { cells } = laneEvents({
      axis: 'person',
      groups: groups(),
      events: [mkEvent({ id: 'd1', day: '2026-07-18', kind: 'date', roster: null })],
      castByProject: cast,
      awayByDay: new Map([['2026-07-18', new Set(['mia'])]]),
    });
    expect(cells.get('person:tres:mia')).toBeUndefined();
    const joan = cells.get('person:tres:joan')?.get('2026-07-18');
    expect(joan?.map((p) => p.event.id)).toEqual(['d1']);
    expect(joan?.[0].link).toBe('inferred');
  });

  it('a date that resolves to nobody births the nocast lane, named for its project', () => {
    const before = groups();
    const out = laneEvents({
      axis: 'person',
      groups: before,
      events: [mkEvent({ id: 'd1', day: '2026-07-18', kind: 'date' })],
      // Everyone on file is away that day: no fact, no candidate, one lane.
      castByProject: cast,
      awayByDay: new Map([['2026-07-18', new Set(['mia', 'joan'])]]),
    });
    const born = out.groups[0].lanes.find((l) => l.kind === 'nocast');
    expect(born?.key).toBe('nocast:tres');
    expect(born?.name).toBe('Tres voces');
    expect(out.cells.get('nocast:tres')?.get('2026-07-18')?.[0].link).toBe('unknown');
    // Birth extends the RETURNED groups; the caller's stay untouched.
    expect(before[0].lanes.some((l) => l.kind === 'nocast')).toBe(false);
  });

  it('the ghost lane never receives an event — homeless dates go to nocast', () => {
    const teamless = personGroups({
      projects: [PROJECTS[1]],
      visibleProjectIds: new Set(['aur']),
      team: TEAM,
      personNames: new Map(),
      sharedPersonIds: new Set(),
    });
    const out = laneEvents({
      axis: 'person',
      groups: teamless,
      events: [mkEvent({ id: 'd1', day: '2026-07-18', project_id: 'aur', kind: 'date' })],
      castByProject: NO_CAST,
      awayByDay: NO_AWAY,
    });
    expect(out.cells.get('ghost:aur')).toBeUndefined();
    expect(out.cells.get('nocast:aur')?.get('2026-07-18')).toHaveLength(1);
    // The ghost lane survives beside it: 'no data yet' is still a fact.
    expect(out.groups[0].lanes.map((l) => l.kind)).toEqual(['ghost', 'nocast']);
  });
});

/* ── Tallies & the three silences ───────────────────────────────────────── */

describe('laneTally (law 9)', () => {
  it('gig identity is venue AND day — two same-named venues on different dates are two units', () => {
    const t = laneTally({
      placed: [
        placed(mkEvent({ id: 'a', day: '2026-07-18', venueName: 'Sala Girona' })),
        placed(mkEvent({ id: 'b', day: '2026-07-25', venueName: 'Sala Girona' })),
      ],
      ghost: false,
      touched: false,
    });
    expect(t.options).toBe(2);
    expect(t.silence).toBe('counts');
  });

  it('two performances of one gig are one unit, confirmed the moment any of them is ink', () => {
    const t = laneTally({
      placed: [
        placed(mkEvent({ id: 'a', day: '2026-07-18', venue_id: 'v1', cert: 'confirmed' })),
        placed(mkEvent({ id: 'b', day: '2026-07-18', venue_id: 'v1', cert: 'hold' })),
      ],
      ghost: false,
      touched: false,
    });
    expect(t).toMatchObject({ confirmed: 1, options: 0, notCast: 0 });
  });

  it("an inferred unit counts as 'not cast', never as somebody's option", () => {
    const t = laneTally({
      placed: [placed(mkEvent({ id: 'a', day: '2026-07-18' }), 'inferred')],
      ghost: false,
      touched: false,
    });
    expect(t).toMatchObject({ confirmed: 0, options: 0, notCast: 1 });
  });

  it('the three silences are three different facts from three different inputs', () => {
    // Nothing at all: '—'.
    expect(laneTally({ placed: [], ghost: false, touched: false }).silence).toBe('dash');
    // Worked but played nowhere: a travel day touched the lane.
    expect(
      laneTally({
        placed: [placed(mkEvent({ id: 't', day: '2026-07-18', kind: 'travel' }))],
        ghost: false,
        touched: false,
      }).silence,
    ).toBe('no_dates');
    // Touched by a band the cells never saw (prep, an absence).
    expect(laneTally({ placed: [], ghost: false, touched: true }).silence).toBe('no_dates');
    // Cast knowingly unknown.
    expect(laneTally({ placed: [], ghost: true, touched: false }).silence).toBe('no_data_yet');
  });

  it('a released night leaves the count — given back is not an option', () => {
    const t = laneTally({
      placed: [placed(mkEvent({ id: 'a', day: '2026-07-18', cert: 'released' }))],
      ghost: false,
      touched: false,
    });
    expect(t).toMatchObject({ confirmed: 0, options: 0, notCast: 0 });
    expect(t.silence).toBe('no_dates');
  });
});

describe('groupTally (law 11)', () => {
  it('the shut lid still says what it holds — lanes counted, tallies summed', () => {
    const groups = scopeGroups({ scopeProjectIds: null, workspaces: [WORKSPACES[0]], projects: PROJECTS });
    const tallies = new Map([
      ['project:tres', laneTally({ placed: [placed(mkEvent({ id: 'a', day: '2026-07-18', cert: 'confirmed' }))], ghost: false, touched: false })],
      ['project:aur', laneTally({ placed: [placed(mkEvent({ id: 'b', day: '2026-07-19' }), 'inferred')], ghost: false, touched: false })],
    ]);
    expect(groupTally(groups[0], tallies)).toEqual({ units: 2, confirmed: 1, options: 0, notCast: 1 });
  });
});

/* ── Columns & folds ────────────────────────────────────────────────────── */

describe('activeDaySet / horizonEndIso (law 13)', () => {
  const cells = new Map([
    ['project:tres', new Map([['2026-07-18', [placed(mkEvent({ id: 'a', day: '2026-07-18' }))]]])],
  ]);
  const runs: AwayRun[] = [{ laneKey: 'project:tres', from: '2026-07-22', to: '2026-07-24', who: 'Mia', tentative: false }];

  it("width is a claim — each axis counts its own ink (prep days are the scope's)", () => {
    const scope = activeDaySet({ axis: 'scope', cells, prepDays: ['2026-07-20'], awayRuns: runs });
    expect([...scope].sort()).toEqual(['2026-07-18', '2026-07-20', '2026-07-22']);
    const person = activeDaySet({ axis: 'person', cells, prepDays: ['2026-07-20'], awayRuns: runs });
    expect(person.has('2026-07-20')).toBe(false);
    // Only an absence's FIRST day claims width — the band says the rest.
    expect(person.has('2026-07-23')).toBe(false);
  });

  it('the horizon ends two days past the last active day, or today + boardDays — whichever is later', () => {
    expect(horizonEndIso({ todayIso: '2026-07-18', lastActiveIso: '2026-09-10', boardDays: 30 })).toBe('2026-09-12');
    expect(horizonEndIso({ todayIso: '2026-07-18', lastActiveIso: '2026-07-20', boardDays: 30 })).toBe('2026-08-17');
    expect(horizonEndIso({ todayIso: '2026-07-18', lastActiveIso: null, boardDays: 30 })).toBe('2026-08-17');
  });
});

describe('buildColumns (laws 14–16)', () => {
  it('a fold of one day is still that day — it keeps its weekend and its today', () => {
    const cols = buildColumns({
      baseIso: '2026-07-17',
      endIso: '2026-07-19',
      active: new Set(['2026-07-17', '2026-07-19']),
      todayIso: '2026-07-18', // a Saturday
    });
    expect(cols.map((c) => c.kind)).toEqual(['day', 'gap', 'day']);
    expect(cols[1]).toMatchObject({ span: 1, weekend: true, today: true, gapLabel: '18' });
  });

  it("a multi-day fold claims no day's flags — one wash over five days would lie about Sunday", () => {
    const cols = buildColumns({
      baseIso: '2026-07-17',
      endIso: '2026-07-21',
      active: new Set(['2026-07-17', '2026-07-21']),
      todayIso: '2026-07-19',
    });
    expect(cols[1]).toMatchObject({ kind: 'gap', span: 3, weekend: false, today: false, gapLabel: '18–20' });
  });

  it('a fold never swallows the 1st of a month', () => {
    const cols = buildColumns({
      baseIso: '2026-07-30',
      endIso: '2026-08-03',
      active: new Set(['2026-07-30', '2026-08-03']),
      todayIso: '2026-07-30',
    });
    // The quiet run breaks at the month turn: July's tail and August's head
    // are two folds, and the boundary lands on a column edge.
    expect(cols.map((c) => [c.kind, c.from, c.to])).toEqual([
      ['day', '2026-07-30', '2026-07-30'],
      ['gap', '2026-07-31', '2026-07-31'],
      ['gap', '2026-08-01', '2026-08-02'],
      ['day', '2026-08-03', '2026-08-03'],
    ]);
    expect(cols[2].mstart).toBe(true);
    expect(cols[2].gapLabel).toBe('1–2');
  });

  it('a whole quiet month is one column whose label IS the month name — never said twice', () => {
    const cols = buildColumns({
      baseIso: '2026-07-31',
      endIso: '2026-09-01',
      active: new Set(['2026-07-31', '2026-09-01']),
      todayIso: '2026-07-31',
    });
    expect(cols).toHaveLength(3);
    expect(cols[1]).toMatchObject({ kind: 'gap', span: 31, gapLabel: 'aug', mstart: true, monthStartName: null });
    expect(cols[2]).toMatchObject({ kind: 'day', mstart: true, monthStartName: 'sep' });
  });

  it('a fold may swallow a Monday — the week mark simply is not drawn', () => {
    const cols = buildColumns({
      baseIso: '2026-07-17',
      endIso: '2026-07-22',
      active: new Set(['2026-07-17', '2026-07-22']),
      todayIso: '2026-07-17',
    });
    // Monday the 20th vanished into the fold; Wednesday resumes inside the
    // same ISO week as the fold's last day, so no boundary is claimed.
    expect(cols[2]).toMatchObject({ from: '2026-07-22', wstart: false, mstart: false });
    // Asked at a real boundary, the flag is there.
    const week = buildColumns({
      baseIso: '2026-07-19',
      endIso: '2026-07-20',
      active: new Set(['2026-07-19', '2026-07-20']),
      todayIso: '2026-07-19',
    });
    expect(week[1].wstart).toBe(true);
  });

  it('mstart wins — the two boundary flags are never both set', () => {
    // 2026-06-01 is a Monday: a month start that is also a week start.
    const cols = buildColumns({
      baseIso: '2026-05-31',
      endIso: '2026-06-01',
      active: new Set(['2026-05-31', '2026-06-01']),
      todayIso: '2026-05-31',
    });
    expect(cols[1].mstart).toBe(true);
    expect(cols[1].wstart).toBe(false);
  });
});

describe('foldTicks (law 15)', () => {
  it('below 6px a day stops being a mark — no hatch is drawn', () => {
    expect(foldTicks(10, 58)).toEqual([]);
    expect(foldTicks(9, 54)).toHaveLength(9); // exactly 6px still measures
  });

  it('one fillet per swallowed day at the folded step', () => {
    const ticks = foldTicks(5, 58);
    expect(ticks).toHaveLength(5);
    expect(ticks[1]).toBeCloseTo(11.6);
  });
});

/* ── Absence bands ──────────────────────────────────────────────────────── */

describe('normalizeAway (law 21)', () => {
  it('both record shapes are the same fact — one run', () => {
    const out = normalizeAway(
      { person_id: 'mia', f: '2026-07-18', t: '2026-07-20', tent: true, who: 'Mia' },
      'L1',
    );
    const blackout = normalizeAway(
      { from: '2026-07-18', to: '2026-07-20', certainty: 'tentative', who: 'Mia' },
      'L1',
    );
    expect(out).toEqual(blackout);
    expect(out).toEqual({ laneKey: 'L1', from: '2026-07-18', to: '2026-07-20', who: 'Mia', tentative: true });
  });

  it('the stored availability shape lands too, and certainty maps to tentative honestly', () => {
    const run = normalizeAway(
      { person_id: 'mia', starts_on: '2026-07-18', ends_on: '2026-07-20', certainty: 'unavailable', who: 'Mia' },
      'L1',
    );
    expect(run.tentative).toBe(false);
    expect(run.from).toBe('2026-07-18');
  });
});

describe('awaySegments (law 21)', () => {
  const run = (from: string, to: string): AwayRun => ({ laneKey: 'L1', from, to, who: 'Mia', tentative: false });

  it('a week edge does NOT cut a band: one absence, one sentence, across the week', () => {
    const cols = buildColumns({
      baseIso: '2026-07-16',
      endIso: '2026-07-22',
      active: new Set(['2026-07-16', '2026-07-17', '2026-07-18', '2026-07-19', '2026-07-20', '2026-07-21', '2026-07-22']),
      todayIso: '2026-07-16',
    });
    // 17→21 July crosses the Monday of week 30 and stays ONE band: a board
    // lane is a continuous row, unlike the month's week-per-row grid, so a
    // cut there only printed the same sentence twice side by side.
    const segs = awaySegments([run('2026-07-17', '2026-07-21')], cols);
    expect(segs).toHaveLength(1);
    expect(segs[0]).toMatchObject({ startCol: 1, endCol: 5, cont: false, end: true });
  });

  it('the fold cuts the band and it resumes after — the gap cell speaks for itself', () => {
    const cols = buildColumns({
      baseIso: '2026-07-16',
      endIso: '2026-07-24',
      active: new Set(['2026-07-16', '2026-07-17', '2026-07-18', '2026-07-22', '2026-07-23', '2026-07-24']),
      todayIso: '2026-07-16',
    });
    const segs = awaySegments([run('2026-07-18', '2026-07-23')], cols);
    expect(segs).toHaveLength(2);
    expect(segs[0]).toMatchObject({ startCol: 2, endCol: 2, cont: false, end: false });
    expect(segs[1]).toMatchObject({ startCol: 4, endCol: 5, cont: true, end: true });
  });

  it("a run clipped by the board's edges resumes cont and never claims the arrowhead", () => {
    const cols = buildColumns({
      baseIso: '2026-07-16',
      endIso: '2026-07-18',
      active: new Set(['2026-07-16', '2026-07-17', '2026-07-18']),
      todayIso: '2026-07-16',
    });
    // Began before the board: the visible piece is a continuation.
    expect(awaySegments([run('2026-07-14', '2026-07-17')], cols)[0].cont).toBe(true);
    // Ends past the board: the terminus is not on the sheet, no arrowhead.
    expect(awaySegments([run('2026-07-17', '2026-07-26')], cols).at(-1)?.end).toBe(false);
  });
});

describe('awayFloorCols (law 21)', () => {
  it('every non-gap column of a touched week reserves the floor — the ROW grows, not the cell', () => {
    const cols = buildColumns({
      baseIso: '2026-07-16',
      endIso: '2026-07-24',
      active: new Set(['2026-07-16', '2026-07-17', '2026-07-18', '2026-07-22', '2026-07-23', '2026-07-24']),
      todayIso: '2026-07-16',
    });
    const floors = awayFloorCols(
      [{ laneKey: 'L1', from: '2026-07-17', to: '2026-07-18', who: 'Mia', tentative: false }],
      cols,
    );
    // The touched ISO week is Mon 13 – Sun 19: its three day columns get the
    // floor, the fold does not, and next week's columns owe nothing.
    expect([...floors.get('L1')!].sort()).toEqual([0, 1, 2]);
  });
});

/* ── Clash ──────────────────────────────────────────────────────────────── */

describe('clashWeight (law 22)', () => {
  it('gravity, not urgency: two holds stay soft, ink promotes', () => {
    expect(clashWeight('hold', 'hold')).toBe('soft');
    expect(clashWeight('proposed', 'hold')).toBe('soft');
    expect(clashWeight('hold', 'confirmed')).toBe('hard');
    // A running deadline never promotes: `expires` has no seat in this
    // signature at all — the clock speaks in words on the hold's own chip.
  });
});

describe('clashMarks (law 22)', () => {
  const e1 = mkEvent({ id: 'e1', day: '2026-07-18', cert: 'hold' });
  const e2 = mkEvent({ id: 'e2', day: '2026-07-18', project_id: 'aur', cert: 'confirmed' });

  it('the rule never points at two showing one — one half off the sheet, no marks', () => {
    const cells = new Map([['project:tres', new Map([['2026-07-18', [placed(e1)]]])]]);
    expect(clashMarks([mkClash(['e1', 'e2'])], cells).size).toBe(0);
  });

  it('both on the sheet: weight from the pair, red from severity', () => {
    const cells = new Map([
      ['project:tres', new Map([['2026-07-18', [placed(e1)]]])],
      ['project:aur', new Map([['2026-07-18', [placed(e2)]]])],
    ]);
    const marks = clashMarks([mkClash(['e1', 'e2'], 'people')], cells);
    expect(marks.get('e1')).toEqual({ clash: 'hard', people: true });
    expect(marks.get('e2')).toEqual({ clash: 'hard', people: true });
  });

});

describe('clashDayMarks (law 22)', () => {
  it("the day '!' never asked the filter — it marks its day with no cells in sight", () => {
    const clashes: BoardClash[] = [
      { ...mkClash(['e1', 'gone']), day: '2026-07-18' },
      { ...mkClash(['e3', 'e4']), day: '2026-07-20' },
    ];
    const marks = clashDayMarks(clashes);
    expect([...marks.keys()].sort()).toEqual(['2026-07-18', '2026-07-20']);
    // and the mark knows its CLASS: blue is a call to make, red is people
    // (the Slip's own --clash-ink law, spoken by the head too).
    expect([...marks.values()].some((m) => typeof m.people === 'boolean')).toBe(true);
  });
});

/* ── Meta ───────────────────────────────────────────────────────────────── */

describe('boardMeta (law 29)', () => {
  it("the meta's lane count is boardLaneCount's own answer — one writer, no drift", () => {
    const groups = scopeGroups({ scopeProjectIds: null, workspaces: WORKSPACES, projects: PROJECTS });
    const shut = new Set(['space:demo']);
    const columns = buildColumns({
      baseIso: '2026-07-16',
      endIso: '2026-07-18',
      active: new Set(['2026-07-16', '2026-07-18']),
      todayIso: '2026-07-18',
    });
    const meta = boardMeta({
      clashes: [{ ...mkClash(['e1', 'e2']), day: '2026-07-18' }],
      urgentHoldCount: 1,
      columns,
      groups,
      shut,
    });
    expect(meta.laneCount).toBe(boardLaneCount(groups, shut));
    expect(meta).toMatchObject({ toDecide: 1, urgent: 1, fromIso: '2026-07-16' });
  });
});

/* ── Measured-pass geometry, with fake rects ────────────────────────────── */

describe('pinHeadY', () => {
  const board = { boardHeight: 2000, headOffsetTop: 0, headHeight: 40 };

  it('the axis never leaves the board it labels — clamped at both ends', () => {
    expect(pinHeadY({ ...board, boardTop: 100 })).toBe(0); // not yet scrolled past
    expect(pinHeadY({ ...board, boardTop: -500 })).toBe(500); // riding
    expect(pinHeadY({ ...board, boardTop: -3000 })).toBe(1960); // stops at the foot
  });
});

describe('groupLabelY', () => {
  it('a group label rides under the axis and stops at its own last lane', () => {
    // Not reached yet: the label sits in its cell.
    expect(groupLabelY({ pinY: 300, groupTop: 400, groupEnd: 1000, labelHeight: 30 })).toBe(0);
    // Travelling with the axis.
    expect(groupLabelY({ pinY: 300, groupTop: 100, groupEnd: 1000, labelHeight: 30 })).toBe(200);
    // Its group ends: the label stops, the axis goes on without it.
    expect(groupLabelY({ pinY: 400, groupTop: 100, groupEnd: 350, labelHeight: 30 })).toBe(220);
  });
});

describe('nowLineX', () => {
  it('the line sits at the day fraction; the label retracts in the evening, the line does not', () => {
    const noon = nowLineX({ todayLeft: 1000, todayWidth: 118, minutes: 720 });
    expect(noon.x).toBe(1059);
    expect(Math.min(noon.x, noon.labelLeftMax(40))).toBe(noon.x); // label rides the line
    const late = nowLineX({ todayLeft: 1000, todayWidth: 118, minutes: 1380 });
    expect(late.x).toBe(1113);
    expect(late.labelLeftMax(40)).toBe(1072); // the caption retracts to the edge
    expect(late.labelLeftMax(40)).toBeLessThan(late.x);
  });

  it('minutes clamp to the day — a skewed clock cannot push the line out of its column', () => {
    expect(nowLineX({ todayLeft: 1000, todayWidth: 118, minutes: -30 }).x).toBe(1000);
    expect(nowLineX({ todayLeft: 1000, todayWidth: 118, minutes: 2000 }).x).toBe(1118);
  });
});
