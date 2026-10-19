/**
 * Añadir al plan (ADR-139 p3 A): one skeleton for every type, one date
 * control that Hour turns into rows, and what is deduced before asking.
 */
import { describe, expect, it } from 'vitest';
import {
  ALL_WEEKDAYS,
  DATE_TYPE_KEYS,
  EVENT_TYPE_KEYS,
  QUICK_MORE,
  QUICK_PRIMARY,
  afterCreate,
  availabilityBody,
  dateBody,
  deducePerson,
  deduceProject,
  deduceTrip,
  deduceWorkspace,
  draftWritten,
  fillEmpty,
  freshDraft,
  performanceBody,
  performanceStatus,
  planWhen,
  skeletonFor,
  switchType,
  whenLabel,
  type QuickType,
  type When,
} from './quick-add';

const TZ = 'Europe/Madrid';
const ALL: QuickType[] = [...QUICK_PRIMARY, ...QUICK_MORE];

const when = (over: Partial<When> = {}): When => ({
  day: '2026-11-14',
  until: '',
  until_on: false,
  timed: false,
  start: '10:00',
  end: '',
  repeat: false,
  weekdays: [...ALL_WEEKDAYS],
  exceptions: [],
  ...over,
});

describe('the types', () => {
  it('offers the seven kinds and unavailability, each once', () => {
    expect([...ALL].sort()).toEqual([...EVENT_TYPE_KEYS, 'unavailable'].sort());
    expect(DATE_TYPE_KEYS).not.toContain('performance');
  });
});

describe('skeletonFor · Qué · Cuándo · Dónde · Más for every type', () => {
  it('gives every type the same four blocks', () => {
    for (const type of ALL) {
      const sk = skeletonFor(type);
      expect(Object.keys(sk).sort(), type).toEqual(['more', 'owner', 'title', 'when', 'where']);
      expect(Object.keys(sk.when).sort(), type).toEqual(['hours', 'hoursOpen', 'repeat', 'untilOpen']);
    }
  });

  it('the big line writes the venue of a performance, the note of an unavailability, the title of a date', () => {
    expect(skeletonFor('performance').title).toBe('venue');
    expect(skeletonFor('unavailable').title).toBe('note');
    for (const type of DATE_TYPE_KEYS) expect(skeletonFor(type).title).toBe('title');
  });

  it('a performance has no hours at creation (ADR-090 P3), nor a day off, nor an unavailability', () => {
    expect(skeletonFor('performance').when.hours).toBe(false);
    expect(skeletonFor('day_off').when.hours).toBe(false);
    expect(skeletonFor('unavailable').when.hours).toBe(false);
    expect(skeletonFor('rehearsal').when.hoursOpen).toBe(true);
  });

  it('residency, day off and unavailability open with «hasta»', () => {
    for (const type of ['residency', 'day_off', 'unavailable'] as const) {
      expect(skeletonFor(type).when.untilOpen, type).toBe(true);
    }
    expect(skeletonFor('rehearsal').when.untilOpen).toBe(false);
  });

  it('a trip has two ends; a day off and an unavailability have no place', () => {
    expect(skeletonFor('travel_day').where).toBe('trip');
    expect(skeletonFor('travel_day').when.repeat).toBe(false);
    expect(skeletonFor('day_off').where).toBe('none');
    expect(skeletonFor('unavailable').where).toBe('none');
    expect(skeletonFor('unavailable').owner).toBe('person');
    expect(skeletonFor('performance').more.bolo).toBe(true);
    expect(skeletonFor('other').more.label).toBe(true);
  });
});

describe('planWhen · one date control, Hour picks the rows', () => {
  it('one day, no hour: one all-day row', () => {
    const plan = planWhen('rehearsal', when(), TZ);
    expect(plan).toMatchObject({ shape: 'one', starts_at: '2026-11-14T00:00:00.000Z', ends_at: null, all_day: true });
  });

  it('one day with hours: one timed row in the space clock', () => {
    const plan = planWhen('rehearsal', when({ timed: true, start: '10:00', end: '14:00' }), TZ);
    expect(plan).toMatchObject({
      shape: 'one',
      starts_at: '2026-11-14T09:00:00.000Z',
      ends_at: '2026-11-14T13:00:00.000Z',
      all_day: false,
    });
  });

  it('a residency from the 16th to the 19th is ONE row with an end', () => {
    const plan = planWhen('residency', when({ day: '2026-11-16', until: '2026-11-19', until_on: true }), TZ);
    expect(plan).toMatchObject({
      shape: 'one',
      starts_at: '2026-11-16T00:00:00.000Z',
      ends_at: '2026-11-19T00:00:00.000Z',
      all_day: true,
    });
  });

  it('several days with hours are a series, each day at its hour', () => {
    const plan = planWhen(
      'rehearsal',
      when({ day: '2026-11-16', until: '2026-11-18', until_on: true, timed: true, start: '10:00' }),
      TZ,
    );
    expect(plan.shape).toBe('series');
    if (plan.shape !== 'series') return;
    expect(plan.starts).toEqual(['2026-11-16T09:00:00.000Z', '2026-11-17T09:00:00.000Z', '2026-11-18T09:00:00.000Z']);
    expect(plan.ends).toBeNull();
  });

  it('a DST jump inside a series moves no day', () => {
    const plan = planWhen(
      'rehearsal',
      when({ day: '2026-10-24', until: '2026-10-26', until_on: true, timed: true, start: '10:00' }),
      TZ,
    );
    if (plan.shape !== 'series') throw new Error(plan.shape);
    expect(plan.starts).toEqual(['2026-10-24T08:00:00.000Z', '2026-10-25T09:00:00.000Z', '2026-10-26T09:00:00.000Z']);
  });

  it('«repetir» keeps only the weekdays of the rule, minus the punched days', () => {
    const plan = planWhen(
      'rehearsal',
      when({
        day: '2026-11-02',
        until: '2026-11-13',
        until_on: true,
        repeat: true,
        weekdays: [2, 4],
        exceptions: ['2026-11-05'],
      }),
      TZ,
    );
    expect(plan).toMatchObject({ shape: 'series', all_day: true, days: ['2026-11-03', '2026-11-10', '2026-11-12'] });
  });

  it('a performance over several days is a run (one per day), never one long row', () => {
    const plan = planWhen('performance', when({ day: '2026-11-14', until: '2026-11-16', until_on: true }), TZ);
    expect(plan).toMatchObject({ shape: 'series', days: ['2026-11-14', '2026-11-15', '2026-11-16'] });
  });

  it('a trip of several days is one row of whole days, hours or not', () => {
    const plan = planWhen(
      'travel_day',
      when({ day: '2026-11-14', until: '2026-11-15', until_on: true, timed: true }),
      TZ,
    );
    expect(plan).toMatchObject({ shape: 'one', all_day: true, ends_at: '2026-11-15T00:00:00.000Z' });
  });

  it('an unavailability is a range; an empty «hasta» is that one day', () => {
    expect(planWhen('unavailable', when({ until_on: true }), TZ)).toMatchObject({
      shape: 'range',
      from: '2026-11-14',
      to: '2026-11-14',
    });
    expect(planWhen('unavailable', when({ until_on: true, until: '2026-11-16' }), TZ)).toMatchObject({
      shape: 'range',
      to: '2026-11-16',
    });
  });

  it('an open «hasta» on the same day is one day, not an error', () => {
    expect(planWhen('residency', when({ until_on: true, until: '2026-11-14' }), TZ)).toMatchObject({
      shape: 'one',
      ends_at: null,
    });
  });

  it('says what is wrong, under which field, only when asked to plan', () => {
    expect(planWhen('rehearsal', when({ day: '' }), TZ)).toEqual({
      shape: 'error',
      error: { field: 'day', key: 'create.pick_start' },
    });
    expect(planWhen('rehearsal', when({ until_on: true, until: '2026-11-01' }), TZ)).toMatchObject({
      error: { field: 'until' },
    });
    expect(planWhen('rehearsal', when({ timed: true, start: '14:00', end: '10:00' }), TZ)).toMatchObject({
      error: { field: 'end', key: 'create.end_before_start' },
    });
    expect(
      planWhen('rehearsal', when({ until_on: true, until: '2027-06-01' }), TZ),
    ).toMatchObject({ error: { field: 'repeat', key: 'block.too_many' } });
    expect(
      planWhen('rehearsal', when({ until_on: true, until: '2026-11-20', repeat: true, weekdays: [] }), TZ),
    ).toMatchObject({ error: { field: 'repeat', key: 'block.too_few' } });
  });
});

describe('deducing before asking', () => {
  it('project: the pinned scope, else the only one, else the last used if still active', () => {
    expect(deduceProject({ preset: 'p2', projectIds: ['p1', 'p2'] })).toBe('p2');
    expect(deduceProject({ preset: null, projectIds: ['p1'] })).toBe('p1');
    expect(deduceProject({ preset: null, projectIds: ['p1', 'p2'], last: 'p2' })).toBe('p2');
    expect(deduceProject({ preset: null, projectIds: ['p1', 'p2'], last: 'gone' })).toBe('');
    expect(deduceProject({ preset: null, projectIds: ['p1', 'p2'] })).toBe('');
  });

  it('space of an unavailability: the project’s, the scope’s, the only one', () => {
    expect(deduceWorkspace({ projectWorkspace: 'w2', preset: 'w1', workspaceIds: ['w1', 'w2'] })).toBe('w2');
    expect(deduceWorkspace({ projectWorkspace: null, preset: 'w1', workspaceIds: ['w1', 'w2'] })).toBe('w1');
    expect(deduceWorkspace({ projectWorkspace: null, preset: null, workspaceIds: ['w1'] })).toBe('w1');
    expect(deduceWorkspace({ projectWorkspace: null, preset: null, workspaceIds: ['w1', 'w2'] })).toBe('');
  });

  it('person: whoever marks it, when on that team; else the whole company', () => {
    const team = [{ person_id: 'me', workspace_id: 'w1' }];
    expect(deducePerson('me', team, 'w1')).toBe('me');
    expect(deducePerson('me', team, 'w2')).toBe('');
    expect(deducePerson(null, team, 'w1')).toBe('');
  });

  const perfs = [
    { id: 'a', performed_at: '2026-11-14', city: 'Girona', venue_name: 'T. Municipal' },
    { id: 'b', performed_at: '2026-11-21', city: 'Lyon', venue_name: null },
  ];

  it('trip: towards the nearest performance ahead, with its city as destination', () => {
    expect(deduceTrip('2026-11-13', perfs)).toEqual({
      direction: 'outbound',
      origin: '',
      destination: 'Girona',
      performance_id: 'a',
    });
    expect(deduceTrip('2026-11-14', perfs)?.performance_id).toBe('a');
  });

  it('trip: back from the one just before, when none is ahead', () => {
    expect(deduceTrip('2026-11-15', perfs)).toEqual({
      direction: 'return',
      origin: 'Girona',
      destination: '',
      performance_id: 'a',
    });
  });

  it('trip: no performance near, no guess', () => {
    expect(deduceTrip('2026-12-10', perfs)).toBeNull();
    expect(deduceTrip('', perfs)).toBeNull();
  });

  it('a guess fills only what is empty', () => {
    expect(fillEmpty({ origin: 'Barcelona', city: '' }, { origin: 'Girona', city: 'Lyon' })).toEqual({
      origin: 'Barcelona',
      city: 'Lyon',
    });
  });
});

describe('the draft', () => {
  it('a fresh draft is not written: what Hour proposes is not a draft', () => {
    const d = freshDraft('2026-11-14');
    d.project = 'p1';
    d.bolo = 'b1';
    expect(draftWritten(d)).toBe(false);
    d.title = 'Ensayo con luces';
    expect(draftWritten(d)).toBe(true);
  });

  it('opens each type with its own defaults', () => {
    expect(freshDraft('2026-11-14', 'rehearsal').when.timed).toBe(true);
    expect(freshDraft('2026-11-14', 'residency').when.until_on).toBe(true);
    expect(freshDraft('2026-11-14').certainty).toBe('option');
    expect(freshDraft('2026-11-14', 'unavailable').certainty).toBe('confirmed');
  });

  it('switching type keeps what was written and opens what the new type opens', () => {
    const d = freshDraft('2026-11-14');
    d.title = 'Mercat';
    d.city = 'Barcelona';
    const r = switchType(d, 'rehearsal');
    expect(r).toMatchObject({ type: 'rehearsal', title: 'Mercat', city: 'Barcelona' });
    expect(r.when.timed).toBe(true);
    const off = switchType(r, 'day_off');
    expect(off.when.timed).toBe(false);
    expect(off.when.until_on).toBe(true);
    // An empty «hasta» goes with the type that opened it.
    expect(switchType(off, 'rehearsal').when.until_on).toBe(false);
  });

  it('switching type moves an untouched certainty, keeps a chosen one', () => {
    const d = freshDraft('2026-11-14');
    expect(switchType(d, 'unavailable').certainty).toBe('confirmed');
    d.certainty = 'confirmed';
    expect(switchType(d, 'rehearsal').certainty).toBe('confirmed');
  });

  it('after an add: same type, project and certainty, the rest empty, same day', () => {
    const d = freshDraft('2026-11-14', 'performance');
    Object.assign(d, { project: 'p1', title: 'Girona', city: 'Girona', certainty: 'confirmed' });
    const next = afterCreate(d);
    expect(next).toMatchObject({ type: 'performance', project: 'p1', certainty: 'confirmed', title: '', city: '' });
    expect(next.when.day).toBe('2026-11-14');
    expect(draftWritten(next)).toBe(false);
  });
});

describe('what is sent', () => {
  it('performance: the big line is the venue; opción is a hold, with its rank', () => {
    const d = freshDraft('2026-11-14');
    Object.assign(d, { project: 'p1', title: ' T. Municipal ', city: 'Girona', rank: '2' });
    const plan = planWhen('performance', d.when, TZ);
    if (plan.shape !== 'one') throw new Error(plan.shape);
    expect(performanceBody(d, plan)).toEqual({
      project_id: 'p1',
      performed_at: '2026-11-14',
      venue_name: 'T. Municipal',
      city: 'Girona',
      status: 'hold_2',
      line_id: null,
      bolo_id: null,
    });
    expect(performanceStatus('confirmed', '2')).toBe('confirmed');
    expect(performanceStatus('option', '')).toBe('hold');
  });

  it('a run sends its days', () => {
    const d = freshDraft('2026-11-14');
    d.project = 'p1';
    d.when = when({ until_on: true, until: '2026-11-15' });
    const plan = planWhen('performance', d.when, TZ);
    if (plan.shape === 'error' || plan.shape === 'range') throw new Error(plan.shape);
    expect(performanceBody(d, plan).performed_at).toEqual(['2026-11-14', '2026-11-15']);
  });

  it('a date carries only its own kind’s fields', () => {
    const d = freshDraft('2026-11-14', 'rehearsal');
    Object.assign(d, { project: 'p1', venue: 'Mercat', label: 'nope', direction: 'return' });
    const plan = planWhen('rehearsal', d.when, TZ);
    if (plan.shape !== 'one') throw new Error(plan.shape);
    const { series, body } = dateBody(d, plan);
    expect(series).toBe(false);
    expect(body).toMatchObject({ kind: 'rehearsal', venue_name: 'Mercat', status: 'tentative' });
    expect(body).not.toHaveProperty('travel_direction');
    expect(body).not.toHaveProperty('label');
  });

  it('a trip sends its two ends, and its destination as city', () => {
    const d = switchType(freshDraft('2026-11-14'), 'travel_day');
    Object.assign(d, { project: 'p1', origin: 'Barcelona', city: 'Lyon', direction: 'outbound', venue: 'x' });
    const plan = planWhen('travel_day', d.when, TZ);
    if (plan.shape !== 'one') throw new Error(plan.shape);
    expect(dateBody(d, plan).body).toMatchObject({
      travel_direction: 'outbound',
      origin_city: 'Barcelona',
      destination_city: 'Lyon',
      city: 'Lyon',
      venue_name: null,
    });
  });

  it('«Otros» sends its label; a series sends starts, not starts_at', () => {
    const d = switchType(freshDraft('2026-11-14'), 'other');
    Object.assign(d, { project: 'p1', label: 'Reunión' });
    d.when = when({ until_on: true, until: '2026-11-15', timed: true });
    const plan = planWhen('other', d.when, TZ);
    if (plan.shape !== 'series') throw new Error(plan.shape);
    const { series, body } = dateBody(d, plan);
    expect(series).toBe(true);
    expect(body).toMatchObject({ label: 'Reunión', all_day: false });
    expect(body).toHaveProperty('starts');
    expect(body).not.toHaveProperty('starts_at');
    expect(body).not.toHaveProperty('performance_id');
  });

  it('an unavailability: its range, its person (or the company), «opción» as provisional', () => {
    const d = switchType(freshDraft('2026-11-14'), 'unavailable');
    Object.assign(d, { workspace: 'w1', person: '', title: '' });
    d.when = when({ until_on: true, until: '2026-11-16' });
    const plan = planWhen('unavailable', d.when, TZ);
    if (plan.shape !== 'range') throw new Error(plan.shape);
    expect(availabilityBody(d, plan)).toEqual({
      workspace_id: 'w1',
      person_id: null,
      starts_on: '2026-11-14',
      ends_on: '2026-11-16',
      certainty: 'unavailable',
      note: null,
    });
    d.certainty = 'option';
    expect(availabilityBody(d, plan).certainty).toBe('tentative');
  });
});

describe('whenLabel · what the «Cuándo» chip says', () => {
  it('a day, a span, hours, a rule', () => {
    expect(whenLabel('rehearsal', when(), 'es-ES', 'días')).toBe('sáb 14 nov');
    expect(whenLabel('rehearsal', when({ timed: true, end: '14:00' }), 'es-ES', 'días')).toBe('sáb 14 nov · 10h–14h');
    expect(whenLabel('residency', when({ until_on: true, until: '2026-11-19' }), 'es-ES', 'días')).toBe(
      '14 nov – 19 nov',
    );
    expect(
      whenLabel(
        'rehearsal',
        when({ until_on: true, until: '2026-11-20', repeat: true, weekdays: [1, 3, 5] }),
        'es-ES',
        'días',
      ),
    ).toBe('14 nov – 20 nov · 3 días');
  });

  it('a performance never shows an hour', () => {
    expect(whenLabel('performance', when({ timed: true }), 'es-ES', 'días')).toBe('sáb 14 nov');
  });
});
