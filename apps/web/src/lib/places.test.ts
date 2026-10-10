import { describe, expect, it } from 'vitest';
import {
  cityZone,
  looksLikeCode,
  normPlace,
  pickPlace,
  searchPlaces,
  shardFor,
  shardName,
  underTheirTown,
  zonesDiffer,
  type PlaceIndex,
} from './places';

/** A tiny gazetteer with the shape the build writes. */
function index(): PlaceIndex {
  const zones = ['Europe/Madrid', 'America/Caracas', 'Europe/London', 'America/Santiago'];
  const rows: Array<[string, string, number, number, string[]]> = [
    ['Valencia', 'VE', 1, 1_400_000, ['Valencia']],
    ['Valencia', 'ES', 0, 800_000, ['Valencia', 'València', 'Valence']],
    ['Paterna', 'ES', 0, 70_000, ['Paterna']],
    ['London', 'GB', 2, 8_900_000, ['London', 'Londres', 'Londra']],
    ['Santiago', 'CL', 3, 4_800_000, ['Santiago']],
    ['Santiago de Compostela', 'ES', 0, 95_000, ['Santiago de Compostela', 'Santiago']],
    ['Alicante', 'ES', 0, 330_000, ['Alicante', 'Alacant']],
    ['Elche', 'ES', 0, 230_000, ['Elche', 'Elx']],
  ];
  return {
    v: 1,
    zones,
    cities: {
      n: rows.map((r) => r[0]),
      c: rows.map((r) => r[1]),
      z: rows.map((r) => r[2]),
      p: rows.map((r) => r[3]),
      k: rows.map((r) => `|${r[4].map(normPlace).join('|')}|`),
    },
    airports: [['ALC', 'LEAL', 'Alicante-Elche Airport', 'Alicante', 'ES', 0]],
  };
}

describe('normPlace', () => {
  it('folds accents, case and punctuation', () => {
    expect(normPlace(' València ')).toBe('valencia');
    expect(normPlace("L'Hospitalet de Llobregat")).toBe('l hospitalet de llobregat');
  });
});

describe('searchPlaces', () => {
  it('asks between places that are different clocks', () => {
    const r = searchPlaces(index(), 'Valencia');
    expect(r.map((x) => `${x.country} ${x.tz}`)).toEqual(['VE America/Caracas', 'ES Europe/Madrid']);
    expect(zonesDiffer(r)).toBe(true);
  });

  it('orders the preferred countries first, and still offers the rest', () => {
    const r = searchPlaces(index(), 'Valencia', { prefer: ['ES'] });
    expect(r.map((x) => x.country)).toEqual(['ES', 'VE']);
  });

  it('answers to the names people use in ca/es/en', () => {
    expect(searchPlaces(index(), 'Londres')[0]).toMatchObject({ city: 'London', tz: 'Europe/London' });
    expect(searchPlaces(index(), 'Alacant')[0]).toMatchObject({ city: 'Alicante', country: 'ES' });
    expect(searchPlaces(index(), 'València')[0].country).toBe('VE');
  });

  it('matches on the start of any name', () => {
    expect(searchPlaces(index(), 'Lond')[0].city).toBe('London');
  });

  it('two places of one country stay two; one place listed twice is once', () => {
    const r = searchPlaces(index(), 'Santiago');
    expect(r.map((x) => `${x.city} ${x.country}`)).toEqual(['Santiago CL', 'Santiago de Compostela ES']);
    const twice = searchPlaces([index(), index()], 'Paterna');
    expect(twice).toHaveLength(1);
  });

  it('searches every file of the gazetteer at once', () => {
    const village: PlaceIndex = {
      v: 1,
      zones: ['Europe/Paris'],
      cities: { n: ['Valensole'], c: ['FR'], z: [0], p: [3000], k: ['|valensole|'] },
      airports: [],
    };
    const r = searchPlaces([index(), village], 'Valens');
    expect(r.map((x) => x.city)).toContain('Valensole');
  });

  it('an airport code puts the airport first', () => {
    const r = searchPlaces(index(), 'alc');
    expect(r[0]).toMatchObject({ kind: 'airport', code: 'ALC', city: 'Alicante', place: 'Alicante-Elche Airport' });
    expect(searchPlaces(index(), 'LEAL')[0].code).toBe('ALC');
  });

  it('says nothing for one letter or nowhere', () => {
    expect(searchPlaces(index(), 'v')).toEqual([]);
    expect(searchPlaces(index(), 'Nowhere')).toEqual([]);
  });

  it('a single answer is no choice to make', () => {
    expect(zonesDiffer(searchPlaces(index(), 'Paterna'))).toBe(false);
  });
});

describe('shards and codes', () => {
  it('reads two letters, longer where the prefix was split', () => {
    const split = new Set(['sa', 'sai']);
    expect(shardFor('Vilanova', split)).toBe(shardName('vi'));
    expect(shardFor('Saint-Martin', split)).toBe(shardName('sain'));
    expect(shardFor('Salt', split)).toBe(shardName('sal'));
    expect(shardFor('Sa', split)).toBe(shardName('sa'));
    expect(shardFor('V', split)).toBeNull();
  });

  it('names a shard file safely in any script', () => {
    expect(shardName('va')).toBe('3a-2p');
    expect(shardName('łó')).toMatch(/^[0-9a-z-]+$/);
  });

  it('a code is three letters, or four in capitals', () => {
    expect(looksLikeCode('lgw')).toBe(true);
    expect(looksLikeCode('LEAL')).toBe(true);
    expect(looksLikeCode('Sant')).toBe(false);
    expect(looksLikeCode('Valencia')).toBe(false);
  });
});

describe('every clock gets a seat', () => {
  it('many places of one zone do not push the other zone off the list', () => {
    const many: PlaceIndex = {
      v: 1,
      zones: ['Europe/Madrid', 'America/Santiago'],
      cities: {
        n: [...Array.from({ length: 10 }, (_, i) => `Santiago ${i}`), 'Santiago'],
        c: [...Array(10).fill('ES'), 'CL'],
        z: [...Array(10).fill(0), 1],
        p: [...Array(10).fill(1000), 10],
        k: [...Array.from({ length: 10 }, (_, i) => `|santiago ${i}|santiago|`), '|santiago|'],
      },
      airports: [],
    };
    const r = searchPlaces(many, 'Santiago', { limit: 4, prefer: ['ES'] });
    expect(r).toHaveLength(4);
    expect(r.map((x) => x.country)).toContain('CL');
  });
});

describe('pickPlace', () => {
  it('keeps the spelling of a whole name, and ours for a start', () => {
    const [alacant] = searchPlaces(index(), 'Alacant');
    expect(pickPlace('Alacant', alacant)).toEqual({ city: 'Alacant', place: null, country: 'ES', tz: 'Europe/Madrid' });
    const [alac] = searchPlaces(index(), 'Alac');
    expect(pickPlace('Alac', alac).city).toBe('Alicante');
  });

  it('an airport writes its city and its name', () => {
    const [alc] = searchPlaces(index(), 'ALC');
    expect(pickPlace('ALC', alc)).toEqual({
      city: 'Alicante',
      place: 'Alicante-Elche Airport',
      country: 'ES',
      tz: 'Europe/Madrid',
    });
  });
});

describe('venues', () => {
  it('a venue picked writes its name as the place, its city and its venue', () => {
    expect(
      pickPlace('Teatre', {
        kind: 'venue',
        city: 'Alacant',
        country: 'ES',
        tz: 'Europe/Madrid',
        place: 'Teatre Principal',
        venueId: 'v1',
        tzFrom: 'venue',
        exact: false,
      }),
    ).toEqual({ city: 'Alacant', place: 'Teatre Principal', country: 'ES', tz: 'Europe/Madrid', venueId: 'v1' });
  });

  it('a city gives its zone only when it is one answer', () => {
    expect(cityZone(index(), 'Alacant', 'ES')).toBe('Europe/Madrid');
    expect(cityZone(index(), 'Valencia', 'ES')).toBe('Europe/Madrid');
    expect(cityZone(index(), 'Valencia', null)).toBeNull();
    expect(cityZone(index(), 'Nowhere', null)).toBeNull();
  });
});

describe('underTheirTown', () => {
  const venue = (city: string, country: string | null = 'ES') => ({
    kind: 'venue' as const,
    city,
    country,
    tz: 'Europe/Madrid',
    place: `Teatre de ${city}`,
    venueId: city,
    exact: false,
  });

  it('puts a venue right under its town, even under our spelling of it', () => {
    const places = searchPlaces(index(), 'Alacant');
    const out = underTheirTown([...places, ...searchPlaces(index(), 'Elche')], [venue('Alacant')], 'Alacant');
    expect(out.map((x) => x.kind)).toEqual(['city', 'venue', 'city']);
  });

  it('keeps a venue of a town not on the list, after the first place', () => {
    const out = underTheirTown(searchPlaces(index(), 'London'), [venue('Elx')], 'London');
    expect(out[1].kind).toBe('venue');
  });

  it('does not put a Spanish venue under a town of another country', () => {
    const out = underTheirTown(searchPlaces(index(), 'Valencia'), [venue('Valencia')], 'Valencia');
    const at = out.findIndex((x) => x.kind === 'venue');
    expect(out[at - 1].country).toBe('ES');
  });
});
