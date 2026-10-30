import { describe, expect, it } from 'vitest';
import {
  attributionFor,
  buildPersonAttribution,
  noCastKey,
  noCastProjectId,
  peopleOf,
  personRowKeys,
} from './people';

const pins = (ids: string[]) => new Set(ids);
const going = (id: string) => ({ person_id: id, state: 'going' as const });
const notGoing = (id: string) => ({ person_id: id, state: 'not_going' as const });

describe('peopleOf', () => {
  it('a roster is who goes, and a closed list', () => {
    expect(peopleOf({ roster: ['laia', 'cloe'] })).toEqual({
      personIds: ['laia', 'cloe'],
      link: 'explicit',
      rostered: true,
      withdrawnIds: [],
    });
  });

  /**
   * ADR-147: no inference. A date nobody gave their word on is `unknown`,
   * which is NOT "nobody is on it": a caller that prints «free» off it is
   * claiming a night on the strength of missing data.
   */
  it('a row nobody is named on is `unknown`, never a guess', () => {
    const nobody = { personIds: [], link: 'unknown', rostered: false, withdrawnIds: [] };
    expect(peopleOf({})).toEqual(nobody);
    expect(peopleOf({ roster: null, commitments: null })).toEqual(nobody);
  });

  it('«voy» puts one person on a date, and settles nobody else', () => {
    const got = peopleOf({ commitments: [going('laia')] });
    expect(got.personIds).toEqual(['laia']);
    expect(got.link).toBe('explicit');
    expect(got.rostered).toBe(false);
  });

  it('«voy» joins a roster', () => {
    expect(peopleOf({ roster: ['cloe'], commitments: [going('pau')] }).personIds).toEqual(['cloe', 'pau']);
  });

  it('«no voy» is recorded, and a roster is never filtered by it', () => {
    const date = peopleOf({ commitments: [notGoing('laia')] });
    expect(date.personIds).toEqual([]);
    expect(date.link).toBe('unknown');
    expect(date.withdrawnIds).toEqual(['laia']);
    // The roster is the record (Quién va); the disagreement is the record's to show.
    expect(peopleOf({ roster: ['laia'], commitments: [notGoing('laia')] }).personIds).toEqual(['laia']);
  });

  it('dedupes and keeps the order the inputs offered', () => {
    expect(peopleOf({ roster: ['laia', 'cloe', 'laia'] }).personIds).toEqual(['laia', 'cloe']);
    expect(peopleOf({ roster: ['laia'], commitments: [going('laia')] }).personIds).toEqual(['laia']);
  });
});

describe('attributionFor', () => {
  it('an empty pin set does not narrow', () => {
    expect(attributionFor(peopleOf({ roster: ['laia'] }), pins([]))).toBe('explicit');
    expect(attributionFor(peopleOf({}), pins([]))).toBe('explicit');
  });

  it('a roster or a «voy» naming the pinned person is a fact', () => {
    expect(attributionFor(peopleOf({ roster: ['laia', 'cloe'] }), pins(['laia']))).toBe('explicit');
    expect(attributionFor(peopleOf({ commitments: [going('laia')] }), pins(['laia']))).toBe('explicit');
  });

  it('a roster without the pinned person is a «no»', () => {
    expect(attributionFor(peopleOf({ roster: ['laia'] }), pins(['nils']))).toBe('no');
  });

  /**
   * The case that started ADR-147: Manou's train, a date of MaMeMi with
   * nobody named, was asked of Marco because he is in the cast. Now it is
   * the company's date: shown to him, claimed for nobody.
   */
  it('a date nobody is named on, of the pinned person\'s project, is the company\'s', () => {
    const date = peopleOf({});
    expect(attributionFor(date, pins(['marco']), ['marco', 'manou'])).toBe('unattributed');
    // Somebody else's «voy» on a date does not make it «not yours»: the list is open.
    expect(attributionFor(peopleOf({ commitments: [going('manou')] }), pins(['marco']), ['marco', 'manou'])).toBe(
      'unattributed',
    );
  });

  it('a date of a project the pinned person is not on is a «no»', () => {
    expect(attributionFor(peopleOf({}), pins(['marco']), ['laia'])).toBe('no');
  });

  it('a date of a project with nobody on file concerns everybody', () => {
    expect(attributionFor(peopleOf({}), pins(['marco']), [])).toBe('unattributed');
    expect(attributionFor(peopleOf({}), pins(['marco']))).toBe('unattributed');
  });

  /**
   * The trap: the row resolves to nobody, and `unattributed` would read as
   * «the company's day, still yours» — the rail would keep showing the very
   * thing you just said no to.
   */
  it('a «no voy» is a «no» for whoever said it', () => {
    const people = peopleOf({ commitments: [notGoing('laia')] });
    expect(attributionFor(people, pins(['laia']), ['laia', 'pau'])).toBe('no');
    expect(attributionFor(people, pins(['pau']), ['laia', 'pau'])).toBe('unattributed');
  });
});

describe('buildPersonAttribution', () => {
  const team = [
    { person_id: 'laia', workspace_id: 'ws1', slug: 'laia', full_name: 'Laia', project_ids: ['memorias'] },
    { person_id: 'cloe', workspace_id: 'ws1', slug: 'cloe', full_name: 'Cloe', project_ids: ['memorias', 'tres'] },
    { person_id: 'mia', workspace_id: 'ws1', slug: 'mia', full_name: 'Mia', project_ids: ['mamemi'] },
  ];

  it('is inert with nobody pinned, and says so', () => {
    const axis = buildPersonAttribution({ pinnedPersonIds: [], team });
    expect(axis.active).toBe(false);
    expect(axis.attribute({ projectId: 'mamemi' })).toBe('explicit');
  });

  it('judges a gig by its roster', () => {
    const axis = buildPersonAttribution({ pinnedPersonIds: ['laia'], team });
    expect(axis.attribute({ projectId: 'memorias', roster: ['laia', 'cloe'] })).toBe('explicit');
    expect(axis.attribute({ projectId: 'tres', roster: ['cloe'] })).toBe('no');
  });

  it('a date of the pinned person\'s project is the company\'s; of another project, a «no»', () => {
    const axis = buildPersonAttribution({ pinnedPersonIds: ['laia'], team });
    expect(axis.attribute({ projectId: 'memorias' })).toBe('unattributed');
    expect(axis.attribute({ projectId: 'mamemi' })).toBe('no');
  });

  it('inverts the team feed so one person can be on several projects', () => {
    const axis = buildPersonAttribution({ pinnedPersonIds: ['cloe'], team });
    expect(axis.attribute({ projectId: 'memorias' })).toBe('unattributed');
    expect(axis.attribute({ projectId: 'tres' })).toBe('unattributed');
  });

  it('a word settles the person it is from', () => {
    const axis = buildPersonAttribution({ pinnedPersonIds: ['laia'], team });
    expect(axis.attribute({ projectId: 'memorias', commitments: [going('laia')] })).toBe('explicit');
    expect(axis.attribute({ projectId: 'memorias', commitments: [notGoing('laia')] })).toBe('no');
    // «Voy» counts on a project the person is not on file for: a fact is a fact.
    expect(axis.attribute({ projectId: 'mamemi', commitments: [going('laia')] })).toBe('explicit');
  });

  it('a team feed with no project_ids cannot rule a date out, and keeps it', () => {
    const bare = [{ person_id: 'laia', workspace_id: 'ws1', slug: 'laia', full_name: 'Laia' }];
    const axis = buildPersonAttribution({ pinnedPersonIds: ['laia'], team: bare });
    expect(axis.attribute({ projectId: 'memorias' })).toBe('unattributed');
    expect(axis.attribute({ projectId: 'memorias', roster: ['laia'] })).toBe('explicit');
  });
});

describe('personRowKeys', () => {
  it('routes people to their own rows', () => {
    expect(personRowKeys(peopleOf({ roster: ['laia'] }), 'memorias')).toEqual({
      keys: ['laia'],
      link: 'explicit',
    });
    expect(personRowKeys(peopleOf({ commitments: [going('pau')] }), 'memorias')).toEqual({
      keys: ['pau'],
      link: 'explicit',
    });
  });

  /** A company date resolves to nobody, and a row that resolves to nobody is a row the view loses. */
  it('a row nobody is named on lands on its project, never nowhere', () => {
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
