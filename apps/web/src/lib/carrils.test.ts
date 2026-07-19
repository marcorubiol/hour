import { describe, expect, it } from 'vitest';
import {
  isWeekendIso,
  loomThreads,
  prepRuns,
  resolveCarrilsGroup,
  stackIntervals,
  type LoomTeamPerson,
} from './carrils';
import { resolveCalendarView } from './calendar';

describe('resolveCalendarView (carrils, ADR-079 §7)', () => {
  it('accepts carrils from the URL and from storage', () => {
    expect(resolveCalendarView('carrils', null, false)).toBe('carrils');
    expect(resolveCalendarView(null, 'carrils', true)).toBe('carrils');
  });

  it('never defaults to carrils — form-factor rule unchanged', () => {
    expect(resolveCalendarView(null, null, true)).toBe('agenda');
    expect(resolveCalendarView(null, null, false)).toBe('month');
  });
});

describe('resolveCarrilsGroup', () => {
  it('URL wins, then storage, then espai', () => {
    expect(resolveCarrilsGroup('persona', 'projecte')).toBe('persona');
    expect(resolveCarrilsGroup(null, 'projecte')).toBe('projecte');
    expect(resolveCarrilsGroup(undefined, undefined)).toBe('espai');
  });

  it('unknown values fall through', () => {
    expect(resolveCarrilsGroup('venue', 'nope')).toBe('espai');
    expect(resolveCarrilsGroup('week', 'persona')).toBe('persona');
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
