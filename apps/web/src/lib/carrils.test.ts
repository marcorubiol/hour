import { describe, expect, it } from 'vitest';
import {
  isWeekendIso,
  loomThreads,
  normalizeLaneAxis,
  prepRuns,
  resolveLaneAxis,
  stackIntervals,
  type LoomTeamPerson,
} from './carrils';
import { resolvePlannerView } from './planner';

describe('resolvePlannerView (board, ADR-080 §7)', () => {
  it('accepts carrils from the URL and from storage', () => {
    expect(resolvePlannerView('board', null, false)).toBe('board');
    expect(resolvePlannerView(null, 'board', true)).toBe('board');
  });

  it('never defaults to carrils — form-factor rule unchanged', () => {
    expect(resolvePlannerView(null, null, true)).toBe('agenda');
    expect(resolvePlannerView(null, null, false)).toBe('month');
  });
});

describe('resolveLaneAxis', () => {
  it('URL wins, then storage, then espai', () => {
    expect(resolveLaneAxis('person', 'project')).toBe('person');
    expect(resolveLaneAxis(null, 'project')).toBe('project');
    expect(resolveLaneAxis(undefined, undefined)).toBe('workspace');
  });

  it('unknown values fall through', () => {
    expect(resolveLaneAxis('venue', 'nope')).toBe('workspace');
    expect(resolveLaneAxis('week', 'person')).toBe('person');
  });
});

describe('isWeekendIso', () => {
  it('flags Saturday and Sunday, not Monday', () => {
    expect(isWeekendIso('2026-07-18')).toBe(true); // Saturday
    expect(isWeekendIso('2026-07-19')).toBe(true); // Sunday
    expect(isWeekendIso('2026-07-20')).toBe(false); // Monday
  });
});

describe('stackIntervals', () => {
  it('keeps non-overlapping intervals on one row', () => {
    const { rows, rowCount } = stackIntervals([
      { start: 0, end: 10 },
      { start: 20, end: 30 },
    ]);
    expect(rows).toEqual([0, 0]);
    expect(rowCount).toBe(1);
  });

  it('stacks overlapping intervals and indexes the input order', () => {
    const { rows, rowCount } = stackIntervals([
      { start: 50, end: 90 }, // later but listed first
      { start: 0, end: 60 },
      { start: 55, end: 70 },
    ]);
    expect(rows).toEqual([1, 0, 2]);
    expect(rowCount).toBe(3);
  });

  it('honours the gap: touching-within-gap intervals stack', () => {
    const { rows } = stackIntervals(
      [
        { start: 0, end: 10 },
        { start: 12, end: 20 },
      ],
      4,
    );
    expect(rows).toEqual([0, 1]);
  });
});

describe('prepRuns', () => {
  it('merges consecutive days per project into one run', () => {
    const runs = prepRuns([
      { project_id: 'p1', day: '2026-07-06', label: 'Assaigs' },
      { project_id: 'p1', day: '2026-07-07', label: 'Assaigs' },
      { project_id: 'p1', day: '2026-07-08', label: 'Assaigs' },
    ]);
    expect(runs).toEqual([{ project_id: 'p1', from: '2026-07-06', to: '2026-07-08', label: 'Assaigs' }]);
  });

  it('breaks on gap days, label changes and project boundaries', () => {
    const runs = prepRuns([
      { project_id: 'p1', day: '2026-07-06', label: 'A' },
      { project_id: 'p1', day: '2026-07-08', label: 'A' }, // gap
      { project_id: 'p1', day: '2026-07-09', label: 'B' }, // label change
      { project_id: 'p2', day: '2026-07-09', label: 'A' }, // other project
    ]);
    expect(runs).toEqual([
      { project_id: 'p1', from: '2026-07-06', to: '2026-07-06', label: 'A' },
      { project_id: 'p1', from: '2026-07-08', to: '2026-07-08', label: 'A' },
      { project_id: 'p1', from: '2026-07-09', to: '2026-07-09', label: 'B' },
      { project_id: 'p2', from: '2026-07-09', to: '2026-07-09', label: 'A' },
    ]);
  });

  it('collapses duplicate days and survives unsorted input', () => {
    const runs = prepRuns([
      { project_id: 'p1', day: '2026-07-07', label: 'A' },
      { project_id: 'p1', day: '2026-07-06', label: 'A' },
      { project_id: 'p1', day: '2026-07-07', label: 'A' },
    ]);
    expect(runs).toEqual([{ project_id: 'p1', from: '2026-07-06', to: '2026-07-07', label: 'A' }]);
  });
});

describe('loomThreads', () => {
  const team: LoomTeamPerson[] = [
    { person_id: 'anouk', workspace_id: 'ws1', full_name: 'Anouk Villé' },
    { person_id: 'mia', workspace_id: 'ws1', full_name: 'Mia' },
    { person_id: 'ghost', workspace_id: 'ws1', full_name: 'Zoe' },
  ];
  const month = { monthFrom: '2026-07-01', monthTo: '2026-07-31' };

  it('groups threads under the home project and merges day runs', () => {
    const groups = loomThreads({
      team,
      commitments: [
        { person_id: 'anouk', day: '2026-07-11', project_id: 'mamemi', state: 'confirmed' },
        { person_id: 'anouk', day: '2026-07-12', project_id: 'mamemi', state: 'confirmed' },
        { person_id: 'mia', day: '2026-07-11', project_id: 'mamemi', state: 'confirmed' },
      ],
      preps: [],
      blackouts: [],
      knots: [],
      ...month,
    });
    expect(groups).toHaveLength(2); // mamemi + ws1 (ghost)
    const [proj, ws] = groups;
    expect(proj.kind).toBe('project');
    expect(proj.key).toBe('mamemi');
    expect(proj.threads.map((t) => t.name)).toEqual(['Anouk Villé', 'Mia']);
    expect(proj.threads[0].segments).toEqual([
      { from: '2026-07-11', to: '2026-07-12', project_id: 'mamemi', state: 'confirmed' },
    ]);
    expect(ws.kind).toBe('workspace');
    expect(ws.threads[0].ghost).toBe(true);
  });

  it('keeps a cross-project person on ONE shared thread in their home group', () => {
    const groups = loomThreads({
      team: team.slice(0, 1),
      commitments: [
        { person_id: 'anouk', day: '2026-07-11', project_id: 'mamemi', state: 'confirmed' },
        { person_id: 'anouk', day: '2026-07-12', project_id: 'mamemi', state: 'hold' },
        { person_id: 'anouk', day: '2026-07-24', project_id: 'ultima', state: 'confirmed' },
      ],
      preps: [],
      blackouts: [],
      knots: [],
      ...month,
    });
    expect(groups).toHaveLength(1);
    expect(groups[0].key).toBe('mamemi'); // 2 days beat 1
    const t = groups[0].threads[0];
    expect(t.shared).toBe(true);
    expect(t.segments.map((s) => s.project_id)).toEqual(['mamemi', 'mamemi', 'ultima']);
  });

  it('rides prep runs on member threads only, faded', () => {
    const groups = loomThreads({
      team: team.slice(0, 2),
      commitments: [
        { person_id: 'mia', day: '2026-07-11', project_id: 'mamemi', state: 'confirmed' },
        { person_id: 'anouk', day: '2026-07-24', project_id: 'ultima', state: 'confirmed' },
      ],
      preps: [{ project_id: 'mamemi', from: '2026-07-06', to: '2026-07-10', label: 'Assaigs' }],
      blackouts: [],
      knots: [],
      ...month,
    });
    const mia = groups.flatMap((g) => g.threads).find((t) => t.person_id === 'mia')!;
    const anouk = groups.flatMap((g) => g.threads).find((t) => t.person_id === 'anouk')!;
    expect(mia.segments.some((s) => s.state === 'prep')).toBe(true);
    expect(anouk.segments.some((s) => s.state === 'prep')).toBe(false);
  });

  /**
   * The prep attribution is a GUESS — nobody wrote down who attends a
   * rehearsal — so it has to yield to a fact. Drawn over an absence, one
   * thread said both "away all day" and "maybe rehearsing" about the same
   * day, which is the defect that killed inference-by-default in the first
   * place. A block that straddles an absence comes back as the days that
   * survive: three real days of a five-day block are still three real days.
   */
  it('keeps an inferred prep run off the days its person is away', () => {
    const groups = loomThreads({
      team: team.slice(0, 2),
      commitments: [
        { person_id: 'mia', day: '2026-07-11', project_id: 'mamemi', state: 'confirmed' },
      ],
      preps: [{ project_id: 'mamemi', from: '2026-07-06', to: '2026-07-10', label: 'Assaigs' }],
      blackouts: [
        { person_id: 'mia', starts_on: '2026-07-08', ends_on: '2026-07-09', certainty: 'unavailable' },
      ],
      knots: [],
      ...month,
    });
    const mia = groups.flatMap((g) => g.threads).find((t) => t.person_id === 'mia')!;
    const prep = mia.segments.filter((s) => s.state === 'prep');
    // Split around the absence, not dropped and not drawn through it.
    expect(prep).toEqual([
      { from: '2026-07-06', to: '2026-07-07', project_id: 'mamemi', state: 'prep' },
      { from: '2026-07-10', to: '2026-07-10', project_id: 'mamemi', state: 'prep' },
    ]);
    // And the absence itself is still on the thread — the fact survives.
    expect(mia.outs).toEqual([
      { from: '2026-07-08', to: '2026-07-09', tentative: false },
    ]);
  });

  it('drops an inferred prep run entirely when the absence covers it', () => {
    const groups = loomThreads({
      team: team.slice(0, 2),
      commitments: [
        { person_id: 'mia', day: '2026-07-11', project_id: 'mamemi', state: 'confirmed' },
      ],
      preps: [{ project_id: 'mamemi', from: '2026-07-06', to: '2026-07-08', label: 'Assaigs' }],
      blackouts: [
        { person_id: 'mia', starts_on: '2026-07-01', ends_on: '2026-07-09', certainty: 'tentative' },
      ],
      knots: [],
      ...month,
    });
    const mia = groups.flatMap((g) => g.threads).find((t) => t.person_id === 'mia')!;
    expect(mia.segments.filter((s) => s.state === 'prep')).toEqual([]);
    // A TENTATIVE absence still gates the guess: certainty is about what gets
    // drawn, not about whether somebody is a candidate for a night nobody
    // was cast on.
    expect(mia.outs[0].tentative).toBe(true);
    // The real commitment is untouched — only the inference yields.
    expect(mia.segments.some((s) => s.state === 'confirmed')).toBe(true);
  });

  it('clips outs to the month, flags tentative, and ignores company blocks', () => {
    const groups = loomThreads({
      team: team.slice(0, 2),
      commitments: [
        { person_id: 'anouk', day: '2026-07-11', project_id: 'mamemi', state: 'confirmed' },
        { person_id: 'mia', day: '2026-07-11', project_id: 'mamemi', state: 'confirmed' },
      ],
      preps: [],
      blackouts: [
        { person_id: 'anouk', starts_on: '2026-06-28', ends_on: '2026-07-03', certainty: 'tentative' },
        { person_id: null, starts_on: '2026-07-31', ends_on: '2026-07-31', certainty: 'unavailable' },
      ],
      knots: [],
      ...month,
    });
    const anouk = groups[0].threads.find((t) => t.person_id === 'anouk')!;
    const mia = groups[0].threads.find((t) => t.person_id === 'mia')!;
    expect(anouk.outs).toEqual([{ from: '2026-07-01', to: '2026-07-03', tentative: true }]);
    expect(mia.outs).toEqual([]); // the company block never lands on a thread
  });

  it('marks knots only on the pulled persons, deduped and sorted', () => {
    const groups = loomThreads({
      team: team.slice(0, 2),
      commitments: [
        { person_id: 'anouk', day: '2026-07-17', project_id: 'mamemi', state: 'hold' },
        { person_id: 'anouk', day: '2026-07-17', project_id: 'ultima', state: 'hold' },
        { person_id: 'mia', day: '2026-07-11', project_id: 'mamemi', state: 'confirmed' },
      ],
      preps: [],
      blackouts: [],
      knots: [
        { day: '2026-07-17', person_ids: ['anouk'] },
        { day: '2026-07-17', person_ids: ['anouk'] },
      ],
      ...month,
    });
    const anouk = groups.flatMap((g) => g.threads).find((t) => t.person_id === 'anouk')!;
    const mia = groups.flatMap((g) => g.threads).find((t) => t.person_id === 'mia')!;
    expect(anouk.knots).toEqual(['2026-07-17']);
    expect(mia.knots).toEqual([]);
  });

  it('a person with only a blackout is grouped by workspace but is not a ghost', () => {
    const groups = loomThreads({
      team: [team[2]],
      commitments: [],
      preps: [],
      blackouts: [
        { person_id: 'ghost', starts_on: '2026-07-10', ends_on: '2026-07-12', certainty: 'unavailable' },
      ],
      knots: [],
      ...month,
    });
    expect(groups).toEqual([
      {
        key: 'ws1',
        kind: 'workspace',
        threads: [
          {
            person_id: 'ghost',
            name: 'Zoe',
            shared: false,
            ghost: false,
            segments: [],
            outs: [{ from: '2026-07-10', to: '2026-07-12', tentative: false }],
            knots: [],
          },
        ],
      },
    ]);
  });

  it('keeps ONE thread for a person listed by two workspaces', () => {
    const groups = loomThreads({
      team: [
        { person_id: 'anouk', workspace_id: 'ws1', full_name: 'Anouk Villé' },
        { person_id: 'anouk', workspace_id: 'ws2', full_name: 'Anouk Villé' },
      ],
      commitments: [
        { person_id: 'anouk', day: '2026-07-11', project_id: 'mamemi', state: 'confirmed' },
      ],
      preps: [],
      blackouts: [],
      knots: [],
      ...month,
    });
    expect(groups.flatMap((g) => g.threads)).toHaveLength(1);
  });

  it('orders project groups by earliest committed day', () => {
    const groups = loomThreads({
      team: team.slice(0, 2),
      commitments: [
        { person_id: 'anouk', day: '2026-07-20', project_id: 'ultima', state: 'confirmed' },
        { person_id: 'mia', day: '2026-07-03', project_id: 'memorias', state: 'confirmed' },
      ],
      preps: [],
      blackouts: [],
      knots: [],
      ...month,
    });
    expect(groups.map((g) => g.key)).toEqual(['memorias', 'ultima']);
  });
});

describe('normalizeLaneAxis (ADR-095 §9)', () => {
  it('the English vocabulary passes through', () => {
    expect(normalizeLaneAxis('workspace')).toBe('workspace');
    expect(normalizeLaneAxis('project')).toBe('project');
    expect(normalizeLaneAxis('person')).toBe('person');
  });

  it('the Catalan generation still opens — translated once, never written back', () => {
    // The site is translated; the address bar is not. These three shipped in
    // an otherwise English URL vocabulary and somebody has them bookmarked.
    expect(normalizeLaneAxis('espai')).toBe('workspace');
    expect(normalizeLaneAxis('projecte')).toBe('project');
    expect(normalizeLaneAxis('persona')).toBe('person');
  });

  it('anything else falls through to the caller default', () => {
    expect(normalizeLaneAxis('line')).toBeNull();
    expect(normalizeLaneAxis(null)).toBeNull();
    expect(resolveLaneAxis('nope', 'alsonope')).toBe('workspace');
  });

  it('a stored Catalan preference is honoured too, not just the URL', () => {
    // localStorage carries the old word on every device that used the app
    // before today; dropping it would silently reset everyone to workspace.
    expect(resolveLaneAxis(null, 'persona')).toBe('person');
  });
});
