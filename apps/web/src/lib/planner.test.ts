import { describe, expect, it } from 'vitest';
import {
  addDaysIso,
  addMonths,
  agendaDayKeys,
  assignBandLanes,
  awayBands,
  conflictsFor,
  dayKeyInTz,
  decisionsFor,
  monthGrid,
  performanceRoster,
  resolvePlannerView,
  rosterPersonIds,
  type BlackoutInput,
  type PlannerEvent,
  type DecisionPerformance,
} from './calendar';

describe('monthGrid', () => {
  it('starts weeks on Monday and pads the first week', () => {
    // July 2026 starts on a Wednesday.
    const weeks = monthGrid(2026, 7);
    expect(weeks[0].map((d) => d.iso)).toEqual([
      '2026-06-29',
      '2026-06-30',
      '2026-07-01',
      '2026-07-02',
      '2026-07-03',
      '2026-07-04',
      '2026-07-05',
    ]);
    expect(weeks[0].map((d) => d.inMonth)).toEqual([
      false,
      false,
      true,
      true,
      true,
      true,
      true,
    ]);
  });

  it('covers the whole month and ends on a Sunday', () => {
    for (const [y, m] of [
      [2026, 7],
      [2026, 2], // Feb 2026: 28 days starting Sunday
      [2024, 2], // leap February
      [2026, 12], // year boundary
    ] as const) {
      const weeks = monthGrid(y, m);
      const flat = weeks.flat();
      expect(flat.length % 7).toBe(0);
      const inMonth = flat.filter((d) => d.inMonth);
      const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
      expect(inMonth.length).toBe(daysInMonth);
      expect(inMonth[0].iso).toBe(`${y}-${String(m).padStart(2, '0')}-01`);
    }
  });

  it('a month starting on Monday has no leading pad', () => {
    // June 2026 starts on a Monday.
    const weeks = monthGrid(2026, 6);
    expect(weeks[0][0]).toEqual({ iso: '2026-06-01', inMonth: true });
  });
});

describe('addDaysIso', () => {
  it('crosses month and year boundaries', () => {
    expect(addDaysIso('2026-07-01', -1)).toBe('2026-06-30');
    expect(addDaysIso('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDaysIso('2024-02-28', 1)).toBe('2024-02-29');
  });
});

describe('addMonths', () => {
  it('crosses year boundaries in both directions', () => {
    expect(addMonths(2026, 12, 1)).toEqual({ year: 2027, month: 1 });
    expect(addMonths(2026, 1, -1)).toEqual({ year: 2025, month: 12 });
    expect(addMonths(2026, 7, -19)).toEqual({ year: 2024, month: 12 });
  });
});

describe('dayKeyInTz', () => {
  it('buckets an instant into the day of the given zone', () => {
    // 23:30Z on Jul 1 is already Jul 2 in Madrid (CEST, +2).
    expect(dayKeyInTz('2026-07-01T23:30:00Z', 'Europe/Madrid')).toBe('2026-07-02');
    expect(dayKeyInTz('2026-07-01T23:30:00Z', 'UTC')).toBe('2026-07-01');
  });

  it('respects the 2026-10-25 DST switch in Madrid', () => {
    // 00:30Z Oct 25 = 02:30 CEST (before the 01:00Z switch) → Oct 25.
    expect(dayKeyInTz('2026-10-25T00:30:00Z', 'Europe/Madrid')).toBe('2026-10-25');
    // 23:00Z Oct 24 = 01:00 CEST Oct 25 → already next day in Madrid.
    expect(dayKeyInTz('2026-10-24T23:00:00Z', 'Europe/Madrid')).toBe('2026-10-25');
  });
});

describe('rosterPersonIds', () => {
  it('unions cast, overrides and crew, deduped', () => {
    expect(
      rosterPersonIds({
        cast: ['a', 'b'],
        overrides: [{ person_id: 'c', replaces_person_id: null }],
        crew: ['b', 'd'],
      }).sort(),
    ).toEqual(['a', 'b', 'c', 'd']);
  });

  it('removes replaced cast members and adds the substitute', () => {
    expect(
      rosterPersonIds({
        cast: ['a', 'b'],
        overrides: [{ person_id: 'c', replaces_person_id: 'a' }],
        crew: [],
      }).sort(),
    ).toEqual(['b', 'c']);
  });

  it('a replaced person coming back through crew stays in', () => {
    // Replaced as cast but still working the gig as crew — crew wins.
    expect(
      rosterPersonIds({
        cast: ['a'],
        overrides: [{ person_id: 'c', replaces_person_id: 'a' }],
        crew: ['a'],
      }).sort(),
    ).toEqual(['a', 'c']);
  });

  it('empty parts produce an empty roster', () => {
    expect(rosterPersonIds({ cast: [], overrides: [], crew: [] })).toEqual([]);
  });
});

// ── performanceRoster — the detail-bundle adapter ─────────────────────────

function bundleOf(input: {
  cast?: Array<string | null>;
  overrides?: Array<{ person: string | null; replaces: string | null }>;
  crew?: Array<string | null>;
}) {
  return {
    performance: {
      cast_override: (input.overrides ?? []).map((o) => ({
        person: o.person ? { id: o.person } : null,
        replaces_person: o.replaces ? { id: o.replaces } : null,
      })),
      crew_assignment: (input.crew ?? []).map((id) => ({
        person: id ? { id } : null,
      })),
    },
    cast_members: (input.cast ?? []).map((id) => ({ person: id ? { id } : null })),
  };
}

describe('performanceRoster', () => {
  it('reduces the bundle through the single roster rule', () => {
    const roster = performanceRoster(
      bundleOf({
        cast: ['a', 'b'],
        overrides: [{ person: 'c', replaces: 'a' }],
        crew: ['d'],
      }),
    );
    expect(roster.sort()).toEqual(['b', 'c', 'd']);
  });

  it('drops person embeds RLS hid (cast and crew)', () => {
    const roster = performanceRoster(
      bundleOf({ cast: ['a', null], crew: [null, 'b'] }),
    );
    expect(roster.sort()).toEqual(['a', 'b']);
  });

  it('drops an override whose substitute is hidden — the replaced person stays', () => {
    // Applying the removal without the addition would understate the roster.
    const roster = performanceRoster(
      bundleOf({
        cast: ['a', 'b'],
        overrides: [{ person: null, replaces: 'a' }],
      }),
    );
    expect(roster.sort()).toEqual(['a', 'b']);
  });

  it('an empty bundle produces an empty roster', () => {
    expect(performanceRoster(bundleOf({}))).toEqual([]);
  });
});

// ── conflictsFor — the conflict engine ────────────────────────────────────

let eventSeq = 0;
function ev(overrides: Partial<PlannerEvent> = {}): PlannerEvent {
  eventSeq += 1;
  return {
    id: overrides.id ?? `ev-${eventSeq}`,
    day: '2026-07-10',
    project_id: 'proj-a',
    workspace_id: 'ws-1',
    ...overrides,
  };
}

let blockSeq = 0;
function blk(overrides: Partial<BlackoutInput> = {}): BlackoutInput {
  blockSeq += 1;
  return {
    id: overrides.id ?? `blk-${blockSeq}`,
    workspace_id: 'ws-1',
    person_id: 'p1',
    starts_on: '2026-07-09',
    ends_on: '2026-07-11',
    certainty: 'unavailable',
    ...overrides,
  };
}

describe('conflictsFor', () => {
  it('flags a people conflict when both rosters are known and share a person', () => {
    const a = ev({ id: 'a', project_id: 'proj-a' });
    const b = ev({ id: 'b', project_id: 'proj-b' });
    const conflicts = conflictsFor([a, b], { a: ['p1', 'p2'], b: ['p2', 'p3'] }, []);
    expect(conflicts).toEqual([
      { severity: 'people', event_ids: ['a', 'b'], person_ids: ['p2'] },
    ]);
  });

  it('both rosters known and disjoint: no conflict at all', () => {
    const a = ev({ id: 'a', project_id: 'proj-a' });
    const b = ev({ id: 'b', project_id: 'proj-b' });
    expect(conflictsFor([a, b], { a: ['p1'], b: ['p2'] }, [])).toEqual([]);
  });

  it('different days never clash pairwise', () => {
    const a = ev({ id: 'a', project_id: 'proj-a', day: '2026-07-10' });
    const b = ev({ id: 'b', project_id: 'proj-b', day: '2026-07-11' });
    expect(conflictsFor([a, b], { a: ['p1'], b: ['p1'] }, [])).toEqual([]);
  });

  it('same-project pairs are the project\'s own plan — never a pairwise conflict', () => {
    // A gig + its travel day + a rehearsal on one day share people by
    // construction; flagging them would be structural noise.
    const gig = ev({ id: 'gig', project_id: 'proj-a' });
    const travel = ev({ id: 'travel', project_id: 'proj-a' });
    expect(conflictsFor([gig, travel], { gig: ['p1'], travel: ['p1'] }, [])).toEqual([]);
    expect(conflictsFor([gig, travel], { gig: ['p1'] }, [])).toEqual([]);
  });

  it('degrades to possible when one roster is empty (honest no-team-data)', () => {
    const a = ev({ id: 'a', project_id: 'proj-a' });
    const b = ev({ id: 'b', project_id: 'proj-b' });
    // b missing from the map entirely — a date row has no roster.
    expect(conflictsFor([a, b], { a: ['p1'] }, [])).toEqual([
      { severity: 'possible', event_ids: ['a', 'b'], person_ids: [] },
    ]);
  });

  it('degrades to possible when both rosters are empty', () => {
    const a = ev({ id: 'a', project_id: 'proj-a' });
    const b = ev({ id: 'b', project_id: 'proj-b' });
    expect(conflictsFor([a, b], {}, [])).toEqual([
      { severity: 'possible', event_ids: ['a', 'b'], person_ids: [] },
    ]);
  });

  it('a pair that earns people never also emits possible', () => {
    const a = ev({ id: 'a', project_id: 'proj-a' });
    const b = ev({ id: 'b', project_id: 'proj-b' });
    const conflicts = conflictsFor([a, b], { a: ['p1'], b: ['p1'] }, []);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].severity).toBe('people');
  });

  it('flags a firm blackout when the blocked person is on the roster', () => {
    const a = ev({ id: 'a' });
    const block = blk({ id: 'blk-firm', person_id: 'p1', certainty: 'unavailable' });
    expect(conflictsFor([a], { a: ['p1'] }, [block])).toEqual([
      {
        severity: 'blackout',
        event_ids: ['a'],
        person_ids: ['p1'],
        availability_block_id: 'blk-firm',
      },
    ]);
  });

  it('a tentative blackout reads as blackout-tentative', () => {
    const a = ev({ id: 'a' });
    const block = blk({ id: 'blk-t', person_id: 'p1', certainty: 'tentative' });
    const conflicts = conflictsFor([a], { a: ['p1'] }, [block]);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].severity).toBe('blackout-tentative');
    expect(conflicts[0].availability_block_id).toBe('blk-t');
  });

  it('blackout range boundaries are inclusive on both ends', () => {
    const block = blk({ starts_on: '2026-07-10', ends_on: '2026-07-12', person_id: 'p1' });
    const rosters = { a: ['p1'] };
    const on = (day: string) => conflictsFor([ev({ id: 'a', day })], rosters, [block]);
    expect(on('2026-07-09')).toEqual([]);
    expect(on('2026-07-10')).toHaveLength(1);
    expect(on('2026-07-12')).toHaveLength(1);
    expect(on('2026-07-13')).toEqual([]);
  });

  it('a person blackout without roster data stays silent (never guesses)', () => {
    const a = ev({ id: 'a' });
    expect(conflictsFor([a], {}, [blk({ person_id: 'p1' })])).toEqual([]);
  });

  it('a person blackout follows the person across workspaces', () => {
    // Cross-space visibility is free by design (ADR-078 §5): the block
    // lives in ws-1, the event in ws-2, the person is on its roster.
    const a = ev({ id: 'a', workspace_id: 'ws-2' });
    const conflicts = conflictsFor([a], { a: ['p1'] }, [
      blk({ workspace_id: 'ws-1', person_id: 'p1' }),
    ]);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].severity).toBe('blackout');
  });

  it('a company-wide blackout hits every event of its workspace, roster or not', () => {
    // Distinct days on purpose — no pairwise conflicts polluting the assert.
    const withRoster = ev({ id: 'a', workspace_id: 'ws-1', day: '2026-07-10' });
    const dateRow = ev({ id: 'b', workspace_id: 'ws-1', project_id: 'proj-b', day: '2026-07-11' });
    const elsewhere = ev({ id: 'c', workspace_id: 'ws-2', day: '2026-07-09' });
    const block = blk({ id: 'blk-co', person_id: null });
    const conflicts = conflictsFor([withRoster, dateRow, elsewhere], { a: ['p1'] }, [block]);
    expect(conflicts).toEqual([
      {
        severity: 'blackout',
        event_ids: ['a'],
        person_ids: [],
        availability_block_id: 'blk-co',
      },
      {
        severity: 'blackout',
        event_ids: ['b'],
        person_ids: [],
        availability_block_id: 'blk-co',
      },
    ]);
  });

  it('overlapping firm and tentative blocks each produce their own conflict', () => {
    const a = ev({ id: 'a' });
    const conflicts = conflictsFor([a], { a: ['p1', 'p2'] }, [
      blk({ id: 'firm', person_id: 'p1', certainty: 'unavailable' }),
      blk({ id: 'tent', person_id: 'p2', certainty: 'tentative' }),
    ]);
    expect(conflicts.map((c) => c.availability_block_id)).toEqual(['firm', 'tent']);
  });

  it('orders output by severity precedence: people > blackout > blackout-tentative > possible', () => {
    const a = ev({ id: 'a', project_id: 'proj-a' });
    const b = ev({ id: 'b', project_id: 'proj-b' });
    const c = ev({ id: 'c', project_id: 'proj-c' });
    const conflicts = conflictsFor(
      [a, b, c],
      { a: ['p1'], b: ['p1'] }, // a+b share p1 · c has no roster → possible vs both
      [
        blk({ id: 'tent', person_id: 'p1', certainty: 'tentative' }),
        blk({ id: 'firm', person_id: 'p1', certainty: 'unavailable' }),
      ],
    );
    expect(conflicts.map((conflict) => conflict.severity)).toEqual([
      'people',
      'blackout', // firm sorts above tentative even though declared after
      'blackout',
      'blackout-tentative',
      'blackout-tentative',
      'possible',
      'possible',
    ]);
  });

  it('no events, no conflicts', () => {
    expect(conflictsFor([], {}, [blk()])).toEqual([]);
  });

  // ── ADR-080 §3 — status-aware severities ────────────────────────────────

  it('double: two same-project hold performances on one day', () => {
    const a = ev({ id: 'a', kind: 'performance', status: 'hold' });
    const b = ev({ id: 'b', kind: 'performance', status: 'hold_1' });
    expect(conflictsFor([a, b], {}, [])).toEqual([
      { severity: 'double', event_ids: ['a', 'b'], person_ids: [] },
    ]);
  });

  it('double: confirmed vs hold counts ("el mateix espectacle, dos llocs")', () => {
    const a = ev({ id: 'a', kind: 'performance', status: 'confirmed' });
    const b = ev({ id: 'b', kind: 'performance', status: 'hold' });
    const conflicts = conflictsFor([a, b], {}, []);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].severity).toBe('double');
  });

  it('double needs a hold: two confirmed (or proposed) same-project perfs stay silent', () => {
    const a = ev({ id: 'a', kind: 'performance', status: 'confirmed' });
    const b = ev({ id: 'b', kind: 'performance', status: 'confirmed' });
    expect(conflictsFor([a, b], {}, [])).toEqual([]);
    const c = ev({ id: 'c', kind: 'performance', status: 'proposed' });
    const d = ev({ id: 'd', kind: 'performance', status: 'confirmed' });
    expect(conflictsFor([c, d], {}, [])).toEqual([]);
  });

  it('double is perf-vs-perf only: a project\'s own perf+travel+rehearsal day stays silent', () => {
    const gig = ev({ id: 'gig', kind: 'performance', status: 'hold' });
    const travel = ev({ id: 'travel', kind: 'date' });
    const rehearsal = ev({ id: 'reh' }); // legacy caller — no kind at all
    expect(conflictsFor([gig, travel, rehearsal], {}, [])).toEqual([]);
  });

  it('double never fires across days', () => {
    const a = ev({ id: 'a', kind: 'performance', status: 'hold', day: '2026-07-10' });
    const b = ev({ id: 'b', kind: 'performance', status: 'hold', day: '2026-07-11' });
    expect(conflictsFor([a, b], {}, [])).toEqual([]);
  });

  it('concurrence: cross-project, both hold, known disjoint rosters', () => {
    const a = ev({ id: 'a', project_id: 'proj-a', kind: 'performance', status: 'hold' });
    const b = ev({ id: 'b', project_id: 'proj-b', kind: 'performance', status: 'hold_2' });
    expect(conflictsFor([a, b], { a: ['p1'], b: ['p2'] }, [])).toEqual([
      { severity: 'concurrence', event_ids: ['a', 'b'], person_ids: [] },
    ]);
  });

  it('an empty roster degrades to possible, never concurrence', () => {
    const a = ev({ id: 'a', project_id: 'proj-a', kind: 'performance', status: 'hold' });
    const b = ev({ id: 'b', project_id: 'proj-b', kind: 'performance', status: 'hold' });
    expect(conflictsFor([a, b], { a: ['p1'] }, [])).toEqual([
      { severity: 'possible', event_ids: ['a', 'b'], person_ids: [] },
    ]);
  });

  it('a shared person stays people, never concurrence, hold or not', () => {
    const a = ev({ id: 'a', project_id: 'proj-a', kind: 'performance', status: 'hold' });
    const b = ev({ id: 'b', project_id: 'proj-b', kind: 'performance', status: 'hold' });
    const conflicts = conflictsFor([a, b], { a: ['p1'], b: ['p1'] }, []);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].severity).toBe('people');
  });

  it('concurrence needs BOTH sides on hold: confirmed vs hold with disjoint rosters is silence', () => {
    const a = ev({ id: 'a', project_id: 'proj-a', kind: 'performance', status: 'confirmed' });
    const b = ev({ id: 'b', project_id: 'proj-b', kind: 'performance', status: 'hold' });
    expect(conflictsFor([a, b], { a: ['p1'], b: ['p2'] }, [])).toEqual([]);
  });

  it('full severity order: people > double > blackout > blackout-tentative > possible > concurrence', () => {
    // One pair per day so each severity comes from exactly one source.
    const events: PlannerEvent[] = [
      // possible (declared first — must still sort near the bottom)
      ev({ id: 'p1e', project_id: 'proj-x', day: '2026-07-05' }),
      ev({ id: 'p2e', project_id: 'proj-y', day: '2026-07-05' }),
      // concurrence
      ev({ id: 'c1', project_id: 'proj-x', day: '2026-07-06', kind: 'performance', status: 'hold' }),
      ev({ id: 'c2', project_id: 'proj-y', day: '2026-07-06', kind: 'performance', status: 'hold' }),
      // double
      ev({ id: 'd1', project_id: 'proj-x', day: '2026-07-07', kind: 'performance', status: 'hold' }),
      ev({ id: 'd2', project_id: 'proj-x', day: '2026-07-07', kind: 'performance', status: 'confirmed' }),
      // people
      ev({ id: 'pe1', project_id: 'proj-x', day: '2026-07-08' }),
      ev({ id: 'pe2', project_id: 'proj-y', day: '2026-07-08' }),
      // blackout + blackout-tentative targets
      ev({ id: 'bf', day: '2026-07-09' }),
      ev({ id: 'bt', day: '2026-07-09', project_id: 'proj-z' }),
    ];
    const conflicts = conflictsFor(
      events,
      { c1: ['pa'], c2: ['pb'], pe1: ['pc'], pe2: ['pc'], bf: ['pf'], bt: ['pt'] },
      [
        blk({ id: 'firm', person_id: 'pf', starts_on: '2026-07-09', ends_on: '2026-07-09' }),
        blk({
          id: 'tent',
          person_id: 'pt',
          certainty: 'tentative',
          starts_on: '2026-07-09',
          ends_on: '2026-07-09',
        }),
      ],
    );
    expect(conflicts.map((c) => c.severity)).toEqual([
      'people',
      'double',
      'blackout',
      'blackout-tentative',
      'possible',
      'concurrence',
    ]);
  });
});

// ── decisionsFor — the derived decisions queue (ADR-080) ─────────────────

const TODAY = '2026-07-18';

let perfSeq = 0;
function perf(overrides: Partial<DecisionPerformance> = {}): DecisionPerformance {
  perfSeq += 1;
  return {
    id: overrides.id ?? `perf-${perfSeq}`,
    day: '2026-08-20',
    project_id: 'proj-a',
    workspace_id: 'ws-1',
    status: 'hold',
    hold_notice_days: null,
    project: 'Show A',
    venue: 'Teatre Ateneu',
    city: 'Tàrrega',
    time: '20:30',
    ...overrides,
  };
}

function run(
  performances: DecisionPerformance[],
  rosters: Record<string, string[]> = {},
  today = TODAY,
) {
  return decisionsFor({ performances, rosters, today });
}

describe('decisionsFor', () => {
  it('a same-project double (two holds) becomes a choose decision', () => {
    const a = perf({ id: 'a', venue: 'Lloc A' });
    const b = perf({ id: 'b', venue: 'Lloc B' });
    const { decisions, concurrences } = run([a, b]);
    expect(concurrences).toEqual([]);
    expect(decisions).toEqual([
      {
        id: '2026-08-20:a+b',
        day: '2026-08-20',
        month: '2026-08',
        level: 'double',
        kind: 'choose',
        a: { id: 'a', project: 'Show A', venue: 'Lloc A', city: 'Tàrrega', time: '20:30', status: 'hold' },
        b: { id: 'b', project: 'Show A', venue: 'Lloc B', city: 'Tàrrega', time: '20:30', status: 'hold' },
        urgent: false, // decideBy 2026-07-21 — three days out
        decideBy: '2026-07-21',
      },
    ]);
  });

  it('a people pair of two holds is a choose decision carrying the shared people', () => {
    const a = perf({ id: 'a', project_id: 'proj-a' });
    const b = perf({ id: 'b', project_id: 'proj-b', project: 'Show B' });
    const { decisions } = run([a, b], { a: ['p1', 'p2'], b: ['p2'] });
    expect(decisions).toHaveLength(1);
    expect(decisions[0].level).toBe('people');
    expect(decisions[0].kind).toBe('choose');
    expect(decisions[0].people).toEqual(['p2']);
  });

  it('release follow-up: after one side confirms, the same pair mutates to release', () => {
    const holdPair = [
      perf({ id: 'a', project_id: 'proj-a' }),
      perf({ id: 'b', project_id: 'proj-b' }),
    ];
    const rosters = { a: ['p1'], b: ['p1'] };
    const before = run(holdPair, rosters);
    expect(before.decisions[0].kind).toBe('choose');

    const after = run(
      [perf({ id: 'a', project_id: 'proj-a', status: 'confirmed' }), holdPair[1]],
      rosters,
    );
    expect(after.decisions).toHaveLength(1);
    expect(after.decisions[0].id).toBe(before.decisions[0].id); // same derived card
    expect(after.decisions[0].kind).toBe('release');
    expect(after.decisions[0].level).toBe('people');
  });

  it('a confirmed+hold double is a release too', () => {
    const { decisions } = run([
      perf({ id: 'a', status: 'confirmed' }),
      perf({ id: 'b', status: 'hold_1' }),
    ]);
    expect(decisions).toHaveLength(1);
    expect(decisions[0].level).toBe('double');
    expect(decisions[0].kind).toBe('release');
  });

  it('a possible pair of holds is a choose decision while both sides are open', () => {
    const { decisions } = run(
      [
        perf({ id: 'a', project_id: 'proj-a', status: 'hold' }),
        perf({ id: 'b', project_id: 'proj-b', status: 'hold' }),
      ],
      { a: ['p1'] }, // b has no roster
    );
    expect(decisions).toHaveLength(1);
    expect(decisions[0].level).toBe('possible');
    expect(decisions[0].kind).toBe('choose');
  });

  it('a possible pair drops once one side is confirmed — no roster, no asserted friction, never a release prompt', () => {
    // ADR-080 §3 — 'possible' is a decision only while both sides are
    // options to confront; §5's release follow-up is people|double only.
    const { decisions, concurrences } = run(
      [
        perf({ id: 'a', project_id: 'proj-a', status: 'confirmed' }),
        perf({ id: 'b', project_id: 'proj-b', status: 'hold' }),
      ],
      { a: ['p1'] }, // b has no roster
    );
    expect(decisions).toEqual([]);
    expect(concurrences).toEqual([]);
  });

  it('a pair with no hold side is never a decision', () => {
    const { decisions } = run(
      [
        perf({ id: 'a', project_id: 'proj-a', status: 'confirmed' }),
        perf({ id: 'b', project_id: 'proj-b', status: 'proposed' }),
      ],
      { a: ['p1'], b: ['p1'] },
    );
    expect(decisions).toEqual([]);
  });

  it('concurrences come back separately — never decisions, never urgent', () => {
    const a = perf({ id: 'a', project_id: 'proj-a', day: '2026-07-19' });
    const b = perf({ id: 'b', project_id: 'proj-b', project: 'Show B', day: '2026-07-19' });
    const { decisions, concurrences } = run([a, b], { a: ['p1'], b: ['p2'] });
    expect(decisions).toEqual([]);
    expect(concurrences).toEqual([
      {
        id: '2026-07-19:a+b',
        day: '2026-07-19',
        month: '2026-07',
        a: expect.objectContaining({ id: 'a', project: 'Show A' }),
        b: expect.objectContaining({ id: 'b', project: 'Show B' }),
      },
    ]);
    expect(concurrences[0]).not.toHaveProperty('urgent');
    expect(concurrences[0]).not.toHaveProperty('decideBy');
  });

  it('urgency boundary: today == decideBy is urgent, the day before is not', () => {
    // Default notice 30: gig 2026-08-17 → decideBy 2026-07-18.
    const pair = () => [
      perf({ id: 'a', day: '2026-08-17' }),
      perf({ id: 'b', day: '2026-08-17' }),
    ];
    const onTheDay = run(pair(), {}, '2026-07-18');
    expect(onTheDay.decisions[0].decideBy).toBe('2026-07-18');
    expect(onTheDay.decisions[0].urgent).toBe(true);

    const dayBefore = run(pair(), {}, '2026-07-17');
    expect(dayBefore.decisions[0].urgent).toBe(false);
  });

  it('notice 0 = no decide-by at all — never urgent, even past the gig', () => {
    const { decisions } = run(
      [
        perf({ id: 'a', day: '2026-07-10', hold_notice_days: 0 }),
        perf({ id: 'b', day: '2026-07-10', hold_notice_days: 0 }),
      ],
      {},
      '2026-07-18', // already past the gig day
    );
    expect(decisions).toHaveLength(1);
    expect(decisions[0].decideBy).toBeNull();
    expect(decisions[0].urgent).toBe(false);
  });

  it('NULL notice follows the default (30); decideBy = min over HOLD sides only', () => {
    // a: NULL → 2026-08-20 − 30 = 2026-07-21 · b: 5 → 2026-08-15. Min wins.
    const { decisions } = run([
      perf({ id: 'a', hold_notice_days: null }),
      perf({ id: 'b', hold_notice_days: 5 }),
    ]);
    expect(decisions[0].decideBy).toBe('2026-07-21');

    // The confirmed side's notice never counts — only holds decide.
    const release = run([
      perf({ id: 'a', status: 'confirmed', hold_notice_days: 1 }),
      perf({ id: 'b', hold_notice_days: 10 }),
    ]);
    expect(release.decisions[0].decideBy).toBe('2026-08-10');

    // A notice-0 hold contributes nothing; the other hold still sets it.
    const mixed = run([
      perf({ id: 'a', hold_notice_days: 0 }),
      perf({ id: 'b', hold_notice_days: 10 }),
    ]);
    expect(mixed.decisions[0].decideBy).toBe('2026-08-10');
  });

  it('the queue spans months — the caller\'s window, not the visible month', () => {
    const { decisions } = run([
      perf({ id: 'a', day: '2026-07-25' }),
      perf({ id: 'b', day: '2026-07-25' }),
      perf({ id: 'c', day: '2026-09-05' }),
      perf({ id: 'd', day: '2026-09-05' }),
    ]);
    expect(decisions.map((d) => d.month)).toEqual(['2026-07', '2026-09']);
  });

  it('sorts urgent first, then by day; stable within a tie', () => {
    const rows = [
      // Not urgent, latest day (double, decideBy 2026-08-06).
      perf({ id: 'l1', day: '2026-09-05' }),
      perf({ id: 'l2', day: '2026-09-05' }),
      // Urgent (gig 3 days out, default notice already passed).
      perf({ id: 'u1', day: '2026-07-21' }),
      perf({ id: 'u2', day: '2026-07-21' }),
      // Not urgent, middle day.
      perf({ id: 'm1', day: '2026-08-30' }),
      perf({ id: 'm2', day: '2026-08-30' }),
      // Same day as the middle pair, cross-project people pair: the
      // engine emits people before double — the tie keeps that order.
      perf({ id: 'x1', day: '2026-08-30', project_id: 'proj-x' }),
      perf({ id: 'x2', day: '2026-08-30', project_id: 'proj-y' }),
    ];
    // m and x rosters are known and disjoint, so their cross pairs read
    // as quiet concurrences — out of the decisions queue by design.
    const { decisions } = run(rows, {
      m1: ['pm'],
      m2: ['pm'],
      x1: ['p9'],
      x2: ['p9'],
    });
    expect(decisions.map((d) => [d.day, d.level, d.urgent])).toEqual([
      ['2026-07-21', 'double', true],
      ['2026-08-30', 'people', false],
      ['2026-08-30', 'double', false],
      ['2026-09-05', 'double', false],
    ]);
  });

  it('cancelled rows are dropped — a cancelled gig is not an option', () => {
    const { decisions } = run([
      perf({ id: 'a', status: 'cancelled' }),
      perf({ id: 'b', status: 'hold' }),
    ]);
    expect(decisions).toEqual([]);
  });

  it('the id is stable regardless of input order (day + perf ids sorted)', () => {
    const a = perf({ id: 'z-late', project_id: 'proj-a' });
    const b = perf({ id: 'a-early', project_id: 'proj-b' });
    const one = run([a, b], { 'z-late': ['p1'], 'a-early': ['p1'] });
    const two = run([b, a], { 'z-late': ['p1'], 'a-early': ['p1'] });
    expect(one.decisions[0].id).toBe('2026-08-20:a-early+z-late');
    expect(two.decisions[0].id).toBe(one.decisions[0].id);
  });

  it('no performances, nothing derived', () => {
    expect(run([])).toEqual({ decisions: [], concurrences: [] });
  });
});

// ── awayBands — derived "fora" ranges between travel pairs ────────────────

type TravelInput = Parameters<typeof awayBands>[0][number];

let dateSeq = 0;
function travel(overrides: Partial<TravelInput> = {}): TravelInput {
  dateSeq += 1;
  return {
    id: overrides.id ?? `d-${dateSeq}`,
    project_id: 'proj-a',
    line_id: null,
    kind: 'travel_day',
    travel_direction: 'outbound',
    starts_at: '2026-07-01T08:00:00Z',
    ...overrides,
  };
}

describe('awayBands', () => {
  it('brackets one band between an outbound and the next return', () => {
    const bands = awayBands([
      travel({ travel_direction: 'outbound', starts_at: '2026-07-01T08:00:00Z' }),
      travel({ travel_direction: 'return', starts_at: '2026-07-05T18:00:00Z' }),
    ]);
    expect(bands).toEqual([{ from: '2026-07-02', to: '2026-07-04', project_id: 'proj-a' }]);
  });

  it('adjacent or same-day pairs leave no strictly-between days — no band', () => {
    expect(
      awayBands([
        travel({ travel_direction: 'outbound', starts_at: '2026-07-01T08:00:00Z' }),
        travel({ travel_direction: 'return', starts_at: '2026-07-02T18:00:00Z' }),
      ]),
    ).toEqual([]);
    expect(
      awayBands([
        travel({ travel_direction: 'outbound', starts_at: '2026-07-01T08:00:00Z' }),
        travel({ travel_direction: 'return', starts_at: '2026-07-01T18:00:00Z' }),
      ]),
    ).toEqual([]);
  });

  it('unpaired legs produce NO band (outbound alone, return alone, leg rows)', () => {
    expect(awayBands([travel({ travel_direction: 'outbound' })])).toEqual([]);
    expect(awayBands([travel({ travel_direction: 'return' })])).toEqual([]);
    expect(awayBands([travel({ travel_direction: 'leg' })])).toEqual([]);
    // A leg between the pair neither opens nor closes anything.
    const bands = awayBands([
      travel({ travel_direction: 'outbound', starts_at: '2026-07-01T08:00:00Z' }),
      travel({ travel_direction: 'leg', starts_at: '2026-07-03T08:00:00Z' }),
      travel({ travel_direction: 'return', starts_at: '2026-07-05T18:00:00Z' }),
    ]);
    expect(bands).toEqual([{ from: '2026-07-02', to: '2026-07-04', project_id: 'proj-a' }]);
  });

  it('ignores non-travel kinds and travel days without a direction', () => {
    expect(
      awayBands([
        travel({ kind: 'rehearsal', travel_direction: null }),
        travel({ travel_direction: null }),
      ]),
    ).toEqual([]);
  });

  it('pairs per line — interleaved lines produce independent bands', () => {
    const bands = awayBands([
      travel({ line_id: 'line-a', travel_direction: 'outbound', starts_at: '2026-07-01T08:00:00Z' }),
      travel({ line_id: 'line-b', travel_direction: 'outbound', starts_at: '2026-07-02T08:00:00Z' }),
      travel({ line_id: 'line-a', travel_direction: 'return', starts_at: '2026-07-05T18:00:00Z' }),
      travel({ line_id: 'line-b', travel_direction: 'return', starts_at: '2026-07-06T18:00:00Z' }),
    ]);
    expect(bands).toContainEqual({
      from: '2026-07-02',
      to: '2026-07-04',
      project_id: 'proj-a',
      line_id: 'line-a',
    });
    expect(bands).toContainEqual({
      from: '2026-07-03',
      to: '2026-07-05',
      project_id: 'proj-a',
      line_id: 'line-b',
    });
    expect(bands).toHaveLength(2);
  });

  it('a line-less outbound never pairs with a lined return (scope is strict)', () => {
    expect(
      awayBands([
        travel({ line_id: null, travel_direction: 'outbound', starts_at: '2026-07-01T08:00:00Z' }),
        travel({ line_id: 'line-a', travel_direction: 'return', starts_at: '2026-07-05T18:00:00Z' }),
      ]),
    ).toEqual([]);
  });

  it('line-less travel days pair per project (the fallback)', () => {
    const bands = awayBands([
      travel({ project_id: 'proj-a', travel_direction: 'outbound', starts_at: '2026-07-01T08:00:00Z' }),
      travel({ project_id: 'proj-b', travel_direction: 'outbound', starts_at: '2026-07-02T08:00:00Z' }),
      travel({ project_id: 'proj-a', travel_direction: 'return', starts_at: '2026-07-04T18:00:00Z' }),
      travel({ project_id: 'proj-b', travel_direction: 'return', starts_at: '2026-07-06T18:00:00Z' }),
    ]);
    expect(bands).toContainEqual({ from: '2026-07-02', to: '2026-07-03', project_id: 'proj-a' });
    expect(bands).toContainEqual({ from: '2026-07-03', to: '2026-07-05', project_id: 'proj-b' });
    expect(bands).toHaveLength(2);
  });

  it('an own-event day inside the bracket splits the band', () => {
    const bands = awayBands(
      [
        travel({ travel_direction: 'outbound', starts_at: '2026-07-01T08:00:00Z' }),
        travel({ travel_direction: 'return', starts_at: '2026-07-07T18:00:00Z' }),
      ],
      { 'proj-a': ['2026-07-04'] },
    );
    expect(bands).toEqual([
      { from: '2026-07-02', to: '2026-07-03', project_id: 'proj-a' },
      { from: '2026-07-05', to: '2026-07-06', project_id: 'proj-a' },
    ]);
  });

  it('own events covering every in-between day dissolve the band entirely', () => {
    expect(
      awayBands(
        [
          travel({ travel_direction: 'outbound', starts_at: '2026-07-01T08:00:00Z' }),
          travel({ travel_direction: 'return', starts_at: '2026-07-04T18:00:00Z' }),
        ],
        { 'proj-a': ['2026-07-02', '2026-07-03'] },
      ),
    ).toEqual([]);
  });

  it('own events of ANOTHER project never split the band', () => {
    const bands = awayBands(
      [
        travel({ travel_direction: 'outbound', starts_at: '2026-07-01T08:00:00Z' }),
        travel({ travel_direction: 'return', starts_at: '2026-07-05T18:00:00Z' }),
      ],
      { 'proj-b': ['2026-07-03'] },
    );
    expect(bands).toEqual([{ from: '2026-07-02', to: '2026-07-04', project_id: 'proj-a' }]);
  });

  it('a second outbound while the trip is open is ignored — earliest brackets', () => {
    const bands = awayBands([
      travel({ travel_direction: 'outbound', starts_at: '2026-07-01T08:00:00Z' }),
      travel({ travel_direction: 'outbound', starts_at: '2026-07-03T08:00:00Z' }),
      travel({ travel_direction: 'return', starts_at: '2026-07-06T18:00:00Z' }),
    ]);
    expect(bands).toEqual([{ from: '2026-07-02', to: '2026-07-05', project_id: 'proj-a' }]);
  });

  it('sequential pairs produce sequential bands', () => {
    const bands = awayBands([
      travel({ travel_direction: 'outbound', starts_at: '2026-07-01T08:00:00Z' }),
      travel({ travel_direction: 'return', starts_at: '2026-07-03T18:00:00Z' }),
      travel({ travel_direction: 'outbound', starts_at: '2026-07-05T08:00:00Z' }),
      travel({ travel_direction: 'return', starts_at: '2026-07-08T18:00:00Z' }),
    ]);
    expect(bands).toEqual([
      { from: '2026-07-02', to: '2026-07-02', project_id: 'proj-a' },
      { from: '2026-07-06', to: '2026-07-07', project_id: 'proj-a' },
    ]);
  });

  it('input order does not matter — pairing sorts chronologically', () => {
    const bands = awayBands([
      travel({ travel_direction: 'return', starts_at: '2026-07-05T18:00:00Z' }),
      travel({ travel_direction: 'outbound', starts_at: '2026-07-01T08:00:00Z' }),
    ]);
    expect(bands).toEqual([{ from: '2026-07-02', to: '2026-07-04', project_id: 'proj-a' }]);
  });

  it('bands cross month boundaries', () => {
    const bands = awayBands([
      travel({ travel_direction: 'outbound', starts_at: '2026-07-30T08:00:00Z' }),
      travel({ travel_direction: 'return', starts_at: '2026-08-02T18:00:00Z' }),
    ]);
    expect(bands).toEqual([{ from: '2026-07-31', to: '2026-08-01', project_id: 'proj-a' }]);
  });
});

describe('resolvePlannerView', () => {
  it('explicit ?view= wins over everything', () => {
    expect(resolvePlannerView('agenda', 'month', false)).toBe('agenda');
    expect(resolvePlannerView('month', 'agenda', true)).toBe('month');
  });

  it('stored preference wins over form factor', () => {
    expect(resolvePlannerView(null, 'agenda', false)).toBe('agenda');
    expect(resolvePlannerView(undefined, 'month', true)).toBe('month');
  });

  it('falls back to form factor: narrow = agenda, wide = month', () => {
    expect(resolvePlannerView(null, null, true)).toBe('agenda');
    expect(resolvePlannerView(null, null, false)).toBe('month');
  });

  it('garbage at either level falls through, never breaks', () => {
    expect(resolvePlannerView('week', 'grid', false)).toBe('month');
    expect(resolvePlannerView('week', 'agenda', false)).toBe('agenda');
  });
});

describe('assignBandLanes', () => {
  it('non-overlapping ranges share lane 0', () => {
    const { lanes, laneCount } = assignBandLanes([
      { from: '2026-05-01', to: '2026-05-03' },
      { from: '2026-05-04', to: '2026-05-06' },
    ]);
    expect(lanes).toEqual([0, 0]);
    expect(laneCount).toBe(1);
  });

  it('overlapping ranges stack into new lanes', () => {
    const { lanes, laneCount } = assignBandLanes([
      { from: '2026-05-13', to: '2026-05-18' },
      { from: '2026-05-24', to: '2026-05-27' },
      { from: '2026-05-26', to: '2026-05-29' },
      { from: '2026-05-27', to: '2026-05-30' },
    ]);
    expect(lanes).toEqual([0, 0, 1, 2]);
    expect(laneCount).toBe(3);
  });

  it('single shared day still counts as overlap (inclusive ends)', () => {
    const { lanes } = assignBandLanes([
      { from: '2026-05-01', to: '2026-05-05' },
      { from: '2026-05-05', to: '2026-05-09' },
    ]);
    expect(lanes).toEqual([0, 1]);
  });

  it('lanes index the input order even when input is unsorted', () => {
    const { lanes } = assignBandLanes([
      { from: '2026-05-10', to: '2026-05-12' },
      { from: '2026-05-01', to: '2026-05-11' },
    ]);
    // Chronologically the second range comes first and takes lane 0.
    expect(lanes).toEqual([1, 0]);
  });

  it('empty input yields no lanes', () => {
    expect(assignBandLanes([])).toEqual({ lanes: [], laneCount: 0 });
  });
});

describe('agendaDayKeys', () => {
  const days = ['2026-05-01', '2026-05-02', '2026-05-03', '2026-05-04', '2026-05-05'];

  it('keeps days with events, in input order', () => {
    expect(agendaDayKeys(days, ['2026-05-03', '2026-05-01'], [])).toEqual([
      '2026-05-01',
      '2026-05-03',
    ]);
  });

  it('keeps days inside a stored blackout (inclusive both ends)', () => {
    expect(
      agendaDayKeys(days, [], [{ starts_on: '2026-05-02', ends_on: '2026-05-04' }]),
    ).toEqual(['2026-05-02', '2026-05-03', '2026-05-04']);
  });

  it('union of both, no duplicates, blackout clipped to the given range', () => {
    expect(
      agendaDayKeys(
        days,
        ['2026-05-02', '2026-05-05'],
        [{ starts_on: '2026-04-28', ends_on: '2026-05-02' }],
      ),
    ).toEqual(['2026-05-01', '2026-05-02', '2026-05-05']);
  });

  it('no events and no blackouts shows no days', () => {
    expect(agendaDayKeys(days, [], [])).toEqual([]);
  });
});
