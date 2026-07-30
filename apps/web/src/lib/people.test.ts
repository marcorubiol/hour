import { describe, expect, it } from 'vitest';
import {
  awayIndex,
  awayPersonIdsOn,
  buildPersonScope,
  matchesPinnedPeople,
  noCastKey,
  noCastProjectId,
  peopleOf,
  personRowKeys,
  type AwayInput,
} from './people';

const away = (ids: string[]) => new Set(ids);

describe('peopleOf', () => {
  it('an explicit roster wins and comes back as a fact', () => {
    expect(peopleOf({ roster: ['laia', 'cloe'], projectCast: ['mia'] })).toEqual({
      personIds: ['laia', 'cloe'],
      link: 'explicit',
    });
  });

  /**
   * THE rule of this module. Somebody cast on a gig who is also away that
   * day is a CLASH, and `conflictsFor` is what reports it (severity
   * 'blackout'). Dropping them here would delete the clash from the only
   * surface built to catch it — the bug would read as "no conflict".
   */
  it('never filters an explicit roster by who is away — that is the clash', () => {
    const got = peopleOf({
      roster: ['laia', 'cloe'],
      awayPersonIds: away(['laia']),
    });
    expect(got.personIds).toEqual(['laia', 'cloe']);
    expect(got.link).toBe('explicit');
  });

  it('falls back to the project cast, and says it is an inference', () => {
    expect(peopleOf({ roster: [], projectCast: ['mia', 'jordi'] })).toEqual({
      personIds: ['mia', 'jordi'],
      link: 'inferred',
    });
    // A null roster is the same fact as an empty one.
    expect(peopleOf({ roster: null, projectCast: ['mia'] }).link).toBe('inferred');
  });

  /**
   * The gate the Loom is missing today: without it one thread says both
   * "away all day" and "maybe rehearsing at 10h" on the same day.
   */
  it('inference stops at the door of an absence', () => {
    const got = peopleOf({
      projectCast: ['mia', 'jordi', 'anouk'],
      awayPersonIds: away(['jordi']),
    });
    expect(got.personIds).toEqual(['mia', 'anouk']);
    expect(got.link).toBe('inferred');
  });

  /**
   * `unknown` is NOT "nobody is on it". A caller that prints "free" off an
   * unknown is claiming a night is available on the strength of missing
   * data, which is the one thing the person axis must never do.
   */
  it('gives up as `unknown` rather than guessing, and unknown is its own word', () => {
    expect(peopleOf({})).toEqual({ personIds: [], link: 'unknown' });
    expect(peopleOf({ projectCast: ['mia'], awayPersonIds: away(['mia']) })).toEqual({
      personIds: [],
      link: 'unknown',
    });
  });

  it('dedupes and keeps the order the inputs offered', () => {
    expect(peopleOf({ roster: ['laia', 'cloe', 'laia'] }).personIds).toEqual(['laia', 'cloe']);
    expect(peopleOf({ projectCast: ['mia', 'mia', 'jordi'] }).personIds).toEqual(['mia', 'jordi']);
  });
});

describe('matchesPinnedPeople', () => {
  it('an empty pin set does not narrow', () => {
    expect(matchesPinnedPeople(peopleOf({ roster: ['laia'] }), new Set())).toBe('explicit');
    expect(matchesPinnedPeople(peopleOf({}), new Set())).toBe('explicit');
  });

  it('reports the evidence, not just the hit', () => {
    const gig = peopleOf({ roster: ['laia', 'cloe'] });
    const rehearsal = peopleOf({ projectCast: ['laia', 'mia'] });
    expect(matchesPinnedPeople(gig, away(['laia']))).toBe('explicit');
    expect(matchesPinnedPeople(rehearsal, away(['laia']))).toBe('inferred');
  });

  it('says no when the pinned people are not on it', () => {
    expect(matchesPinnedPeople(peopleOf({ roster: ['laia'] }), away(['nils']))).toBe('no');
    expect(matchesPinnedPeople(peopleOf({}), away(['nils']))).toBe('no');
  });

  it('an explicit hit outranks an inferred one on the same row', () => {
    // Roster present ⇒ the whole row is a fact; no member of it is inferred.
    const row = peopleOf({ roster: ['laia'], projectCast: ['mia'] });
    expect(matchesPinnedPeople(row, away(['laia', 'mia']))).toBe('explicit');
  });
});

describe('awayPersonIdsOn', () => {
  const blocks: AwayInput[] = [
    { person_id: 'mia', starts_on: '2026-07-15', ends_on: '2026-07-20' },
    { person_id: 'pol', starts_on: '2026-07-28', ends_on: '2026-08-01' },
    // A company closure — not a person being away.
    { person_id: null, starts_on: '2026-08-01', ends_on: '2026-08-15' },
  ];

  it('is inclusive at both ends', () => {
    expect([...awayPersonIdsOn(blocks, '2026-07-15')]).toEqual(['mia']);
    expect([...awayPersonIdsOn(blocks, '2026-07-20')]).toEqual(['mia']);
    expect([...awayPersonIdsOn(blocks, '2026-07-14')]).toEqual([]);
    expect([...awayPersonIdsOn(blocks, '2026-07-21')]).toEqual([]);
  });

  it('crosses the month boundary like any other range', () => {
    expect([...awayPersonIdsOn(blocks, '2026-07-31')]).toEqual(['pol']);
  });

  /**
   * A workspace does not go on holiday. Folding closures in here would make
   * every member of the company un-inferable for the whole of August, and a
   * date inside a closure is a conflict the engine reports anyway.
   */
  it('ignores company closures', () => {
    expect([...awayPersonIdsOn(blocks, '2026-08-10')]).toEqual([]);
  });
});

describe('awayIndex', () => {
  it('agrees with the per-day answer on every day of the window', () => {
    const blocks: AwayInput[] = [
      { person_id: 'mia', starts_on: '2026-07-02', ends_on: '2026-07-04' },
      { person_id: 'pol', starts_on: '2026-07-04', ends_on: '2026-07-04' },
      { person_id: null, starts_on: '2026-07-01', ends_on: '2026-07-05' },
    ];
    const days = ['2026-07-01', '2026-07-02', '2026-07-03', '2026-07-04', '2026-07-05'];
    const index = awayIndex(blocks, days);

    for (const day of days) {
      expect([...index.get(day)!].sort()).toEqual([...awayPersonIdsOn(blocks, day)].sort());
    }
    // Every requested day exists as a key, even the empty ones — a caller
    // must never get `undefined` and read it as "nobody is away".
    expect([...index.keys()]).toEqual(days);
    expect([...index.get('2026-07-04')!].sort()).toEqual(['mia', 'pol']);
  });
});

describe('buildPersonScope', () => {
  const team = [
    { person_id: 'laia', workspace_id: 'ws1', slug: 'laia', full_name: 'Laia', project_ids: ['memorias'] },
    { person_id: 'cloe', workspace_id: 'ws1', slug: 'cloe', full_name: 'Cloe', project_ids: ['memorias', 'tres'] },
    { person_id: 'mia', workspace_id: 'ws1', slug: 'mia', full_name: 'Mia', project_ids: ['mamemi'] },
  ];

  it('is inert with nobody pinned, and says so', () => {
    const scope = buildPersonScope({ pinnedPersonIds: [], team, blocks: [] });
    expect(scope.active).toBe(false);
    expect(scope.verdict({ projectId: 'mamemi', day: '2026-07-18' })).toBe('explicit');
  });

  it('keeps a gig whose roster names the pinned person', () => {
    const scope = buildPersonScope({ pinnedPersonIds: ['laia'], team, blocks: [] });
    expect(
      scope.verdict({ projectId: 'memorias', day: '2026-07-18', roster: ['laia', 'cloe'] }),
    ).toBe('explicit');
    expect(scope.verdict({ projectId: 'tres', day: '2026-07-18', roster: ['cloe'] })).toBe('no');
  });

  /** A date carries no roster, so it is judged by its project's cast. */
  it('keeps a date of a project the pinned person is on file for — as an inference', () => {
    const scope = buildPersonScope({ pinnedPersonIds: ['laia'], team, blocks: [] });
    expect(scope.verdict({ projectId: 'memorias', day: '2026-07-18' })).toBe('inferred');
    expect(scope.verdict({ projectId: 'mamemi', day: '2026-07-18' })).toBe('no');
  });

  it('inverts the team feed so one person can be on several projects', () => {
    const scope = buildPersonScope({ pinnedPersonIds: ['cloe'], team, blocks: [] });
    expect(scope.verdict({ projectId: 'memorias', day: '2026-07-18' })).toBe('inferred');
    expect(scope.verdict({ projectId: 'tres', day: '2026-07-18' })).toBe('inferred');
  });

  it('drops an inferred day the pinned person is away, and keeps the gig they are cast on', () => {
    const scope = buildPersonScope({
      pinnedPersonIds: ['laia'],
      team,
      blocks: [{ person_id: 'laia', starts_on: '2026-07-17', ends_on: '2026-07-19' }],
    });
    // The guess yields to the absence…
    expect(scope.verdict({ projectId: 'memorias', day: '2026-07-18' })).toBe('no');
    // …but a real roster on that same day survives: that is the clash, and
    // hiding it would remove it from the view built to catch it.
    expect(
      scope.verdict({ projectId: 'memorias', day: '2026-07-18', roster: ['laia'] }),
    ).toBe('explicit');
    // Outside the absence the inference is back.
    expect(scope.verdict({ projectId: 'memorias', day: '2026-07-20' })).toBe('inferred');
  });

  it('a team feed with no project_ids cannot infer, and does not pretend to', () => {
    const bare = [{ person_id: 'laia', workspace_id: 'ws1', slug: 'laia', full_name: 'Laia' }];
    const scope = buildPersonScope({ pinnedPersonIds: ['laia'], team: bare, blocks: [] });
    expect(scope.verdict({ projectId: 'memorias', day: '2026-07-18' })).toBe('no');
    // An explicit roster still works — it never needed the pool.
    expect(scope.verdict({ projectId: 'memorias', day: '2026-07-18', roster: ['laia'] })).toBe(
      'explicit',
    );
  });

  it('a row with no project is judged by its roster alone', () => {
    const scope = buildPersonScope({ pinnedPersonIds: ['laia'], team, blocks: [] });
    expect(scope.verdict({ projectId: null, day: '2026-07-18', roster: ['laia'] })).toBe('explicit');
    expect(scope.verdict({ projectId: null, day: '2026-07-18' })).toBe('no');
  });
});

describe('personRowKeys', () => {
  it('routes people to their own rows', () => {
    expect(personRowKeys(peopleOf({ roster: ['laia'] }), 'memorias')).toEqual({
      keys: ['laia'],
      link: 'explicit',
    });
  });

  /**
   * A project with nobody on file still has nights: a row that resolves to
   * nobody is a row the view loses.
   */
  it('a row nobody owns lands on its project, never nowhere', () => {
    expect(personRowKeys(peopleOf({}), 'tres')).toEqual({
      keys: ['nocast:tres'],
      link: 'unknown',
    });
  });

  it('a row with neither people nor project has no key — and says so', () => {
    expect(personRowKeys(peopleOf({}), null)).toEqual({ keys: [], link: 'unknown' });
  });

  it('the synthetic key round-trips and cannot be mistaken for a person', () => {
    expect(noCastProjectId(noCastKey('mamemi'))).toBe('mamemi');
    expect(noCastProjectId('019f21d2-7482-77e6-9ad9-27d881cff305')).toBeNull();
  });
});
