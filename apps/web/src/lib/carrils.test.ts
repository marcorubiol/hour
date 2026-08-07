import { describe, expect, it } from 'vitest';
import {
  isWeekendIso,
  normalizeLaneAxis,
  prepRuns,
  resolveLaneAxis,
  stackIntervals,
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
  it('URL wins, then storage, then scope', () => {
    expect(resolveLaneAxis('person', 'scope')).toBe('person');
    expect(resolveLaneAxis(null, 'person')).toBe('person');
    expect(resolveLaneAxis(undefined, undefined)).toBe('scope');
  });

  it('unknown values fall through', () => {
    expect(resolveLaneAxis('venue', 'nope')).toBe('scope');
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

describe('normalizeLaneAxis (ADR-094, ADR-095 §9)', () => {
  it('the current vocabulary passes through', () => {
    expect(normalizeLaneAxis('scope')).toBe('scope');
    expect(normalizeLaneAxis('person')).toBe('person');
  });

  it('the entity generation lands on scope — the dial stopped naming entity types', () => {
    // `workspace` and `project` were both answers to «how do I narrow?»,
    // and the scope bar already answers that. A row is a thing or a person;
    // both old words meant «a thing», so both land on 'scope'.
    expect(normalizeLaneAxis('workspace')).toBe('scope');
    expect(normalizeLaneAxis('project')).toBe('scope');
  });

  it('the Catalan generation still opens — translated once, never written back', () => {
    // The site is translated; the address bar is not. These three shipped in
    // an otherwise English URL vocabulary and somebody has them bookmarked.
    expect(normalizeLaneAxis('espai')).toBe('scope');
    expect(normalizeLaneAxis('projecte')).toBe('scope');
    expect(normalizeLaneAxis('persona')).toBe('person');
  });

  it('anything else falls through to the caller default', () => {
    expect(normalizeLaneAxis('line')).toBeNull();
    expect(normalizeLaneAxis(null)).toBeNull();
    expect(resolveLaneAxis('nope', 'alsonope')).toBe('scope');
  });

  it('a stored legacy preference is honoured too, not just the URL', () => {
    // localStorage carries the old word on every device that used the app
    // before today; dropping it would silently reset everyone to scope.
    expect(resolveLaneAxis(null, 'persona')).toBe('person');
    expect(resolveLaneAxis(null, 'workspace')).toBe('scope');
    expect(resolveLaneAxis(null, 'projecte')).toBe('scope');
  });

  it('a legacy URL beats a stored preference — the pasted link is the request', () => {
    // Somebody sends ?lanes=project to a device whose stored dial says
    // person: the link wins, translated. The chain order never changed.
    expect(resolveLaneAxis('project', 'person')).toBe('scope');
    expect(resolveLaneAxis('espai', 'person')).toBe('scope');
  });

  it('the writer can never emit a legacy token (law 6/25)', () => {
    // The page writes `lanes=` straight from the resolved axis, so the
    // writer's whole vocabulary is this function's RANGE. Prove the range:
    // every word any generation ever used resolves to a current one.
    const everyKnownToken = [
      'scope',
      'person',
      'workspace',
      'project',
      'espai',
      'projecte',
      'persona',
    ];
    for (const token of everyKnownToken) {
      expect(['scope', 'person']).toContain(resolveLaneAxis(token, null));
    }
  });
});
