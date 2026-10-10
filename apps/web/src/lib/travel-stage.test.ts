import { describe, expect, it } from 'vitest';
import * as v from 'valibot';
import {
  StageInputSchema,
  TRANSPORT_MODES,
  chainedFrom,
  placeStage,
  sameOrder,
  stagePlace,
  stageRpcArgs,
  storedZone,
  zoneLabel,
  zoneNote,
} from './travel-stage';

const at = (hhmm: string) => `2026-10-14T${hhmm}:00.000Z`;
const st = (id: string, position: number, depart_at: string | null) => ({ id, position, depart_at });

describe('TRANSPORT_MODES', () => {
  it('is the enum of nine, in its order', () => {
    expect(TRANSPORT_MODES).toEqual([
      'plane', 'train', 'bus', 'car', 'taxi', 'metro', 'walk', 'ferry', 'other',
    ]);
  });
});

describe('placeStage', () => {
  it('puts a timed stage before the first one that departs later', () => {
    const stages = [st('a', 1, at('08:00')), st('b', 2, at('12:00')), st('n', 3, at('10:00'))];
    expect(placeStage(stages, 'n')).toEqual(['a', 'n', 'b']);
  });

  it('leaves an untimed stage where it is', () => {
    const stages = [st('a', 1, at('08:00')), st('n', 2, null), st('b', 3, at('12:00'))];
    expect(placeStage(stages, 'n')).toEqual(['a', 'n', 'b']);
  });

  it('keeps arrival order on equal hours', () => {
    const stages = [st('a', 1, at('10:00')), st('n', 2, at('10:00'))];
    expect(placeStage(stages, 'n')).toEqual(['a', 'n']);
  });

  it('does not jump over untimed stages that follow by hand', () => {
    const stages = [st('a', 1, at('08:00')), st('u', 2, null), st('n', 3, at('11:00'))];
    expect(placeStage(stages, 'n')).toEqual(['a', 'u', 'n']);
  });

  it('moves an edited stage down when its hour moves later', () => {
    const stages = [st('n', 1, at('15:00')), st('a', 2, at('08:00')), st('b', 3, at('12:00'))];
    expect(placeStage(stages, 'n')).toEqual(['a', 'b', 'n']);
  });

  it('reads positions, not array order', () => {
    const stages = [st('b', 2, at('12:00')), st('a', 1, at('08:00'))];
    expect(placeStage(stages, 'b')).toEqual(['a', 'b']);
  });

  it('returns the order untouched for an unknown id', () => {
    expect(placeStage([st('a', 1, null)], 'x')).toEqual(['a']);
  });
});

describe('chainedFrom', () => {
  it('leaves from where the last stage arrived', () => {
    expect(chainedFrom([{ to_city: 'Madrid', to_place: 'Atocha' }], 'Barcelona')).toMatchObject({
      city: 'Madrid',
      place: 'Atocha',
    });
  });

  it('starts at the trip origin when there is no stage', () => {
    expect(chainedFrom([], 'Barcelona')).toMatchObject({ city: 'Barcelona', place: null });
  });

  it('leaves from the stage its hour puts it after', () => {
    const stages = [
      { to_city: 'Madrid', to_place: null, depart_at: at('08:00') },
      { to_city: 'Toledo', to_place: null, depart_at: at('12:00') },
    ];
    expect(chainedFrom(stages, 'Barcelona', at('10:00')).city).toBe('Madrid');
    expect(chainedFrom(stages, 'Barcelona', at('07:00')).city).toBe('Barcelona');
    expect(chainedFrom(stages, 'Barcelona', at('13:00')).city).toBe('Toledo');
    expect(chainedFrom(stages, 'Barcelona', null).city).toBe('Toledo');
  });

  it('falls back to the origin when the last stage says nowhere', () => {
    expect(chainedFrom([{ to_city: null, to_place: null }], null)).toMatchObject({ city: null, place: null });
  });
});

describe('stagePlace', () => {
  it('names the place over the city, and nothing when neither', () => {
    expect(stagePlace('Madrid', 'Atocha')).toBe('Atocha');
    expect(stagePlace('Madrid', null)).toBe('Madrid');
    expect(stagePlace(null, null)).toBeNull();
  });
});

describe('StageInputSchema', () => {
  const base = {
    mode: 'train',
    from_city: ' Barcelona ',
    from_place: null,
    to_city: 'Madrid',
    to_place: '',
    depart_at: at('08:00'),
    arrive_at: at('10:40'),
    reference: null,
    notes: null,
  };

  it('accepts a whole stage and trims its words', () => {
    const out = v.parse(StageInputSchema, base);
    expect(out.from_city).toBe('Barcelona');
    expect(stageRpcArgs(out)).toMatchObject({ p_mode: 'train', p_from_city: 'Barcelona', p_to_place: null });
  });

  it('refuses an arrival before the departure', () => {
    expect(v.safeParse(StageInputSchema, { ...base, arrive_at: at('07:00') }).success).toBe(false);
  });

  it('refuses a mode outside the nine', () => {
    expect(v.safeParse(StageInputSchema, { ...base, mode: 'rocket' }).success).toBe(false);
  });
});

describe('sameOrder', () => {
  it('compares order, not membership', () => {
    expect(sameOrder(['a', 'b'], ['a', 'b'])).toBe(true);
    expect(sameOrder(['a', 'b'], ['b', 'a'])).toBe(false);
  });
});

describe('zones on a line', () => {
  it('labels a zone by its city', () => {
    expect(zoneLabel('America/New_York')).toBe('New York');
  });

  it('stores the space clock as null', () => {
    expect(storedZone('Europe/Madrid', 'Europe/Madrid')).toBeNull();
    expect(storedZone('Europe/London', 'Europe/Madrid')).toBe('Europe/London');
    expect(storedZone('  ', 'Europe/Madrid')).toBeNull();
  });

  it('says only the ends that are not on the space clock', () => {
    const m = 'Europe/Madrid';
    expect(zoneNote({ depart_tz: null, arrive_tz: null }, m)).toBeNull();
    expect(zoneNote({ depart_tz: m, arrive_tz: 'Europe/London' }, m)).toBe('→ London');
    expect(zoneNote({ depart_tz: 'Europe/Lisbon', arrive_tz: null }, m)).toBe('Lisbon →');
    expect(zoneNote({ depart_tz: 'Europe/Lisbon', arrive_tz: 'Europe/London' }, m)).toBe('Lisbon → London');
    expect(zoneNote({ depart_tz: 'Europe/London', arrive_tz: 'Europe/London' }, m)).toBe('London');
  });

  it('a stage leaves in the clock the one before it arrived in', () => {
    const prev = [{ to_city: 'London', to_place: null, arrive_tz: 'Europe/London' }];
    expect(chainedFrom(prev, null).tz).toBe('Europe/London');
  });

  it('a stage sends its zones to the RPC', () => {
    const out = v.parse(StageInputSchema, {
      mode: 'plane', from_city: null, from_place: null, to_city: null, to_place: null,
      depart_at: null, arrive_at: null, reference: null, notes: null, arrive_tz: 'Europe/London',
    });
    expect(stageRpcArgs(out)).toMatchObject({ p_depart_tz: null, p_arrive_tz: 'Europe/London' });
  });
});
