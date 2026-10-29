/**
 * Ahora (ADR-146) — the gig day of a touring technician.
 *
 * The three moments of the wireframes, on one day in Girona (Madrid zone,
 * UTC+2 in August, so 9h12 local is 07:12Z): the morning train, the
 * load-in, half an hour before the show. Plus the rules the screen leans on:
 * which day it shows, who to call, when it says how old its data is.
 */
import { describe, expect, test } from 'vitest';
import {
  ahoraDay,
  ahoraItems,
  ahoraRelaunch,
  ahoraRoadsheetRole,
  ahoraState,
  ahoraTimeline,
  countdownParts,
  freshnessShown,
  FRESH_MS,
  logisticsLines,
  mapsHref,
  minutesTo,
  telHref,
  venueCall,
} from './ahora';
import type { DateEvent, PerformanceEvent } from './month-events';
import type { TravelStageRow } from './travel-stage';

const TZ = 'Europe/Madrid';
const DAY = '2026-08-14';
const z = (hm: string, day = DAY) => `${day}T${hm}:00Z`;
const at = (hm: string, day = DAY) => new Date(z(hm, day));

function stage(over: Partial<TravelStageRow>): TravelStageRow {
  return {
    id: 's1',
    position: 1,
    mode: 'train',
    from_city: 'Barcelona',
    from_country: null,
    from_place: 'Sants',
    to_city: 'Girona',
    to_country: null,
    to_place: null,
    depart_at: z('07:12'),
    arrive_at: z('08:31'),
    depart_tz: null,
    arrive_tz: null,
    from_venue_id: null,
    to_venue_id: null,
    reference: 'K7Q2PX',
    notes: null,
    ...over,
  };
}

const TRIP: DateEvent = {
  id: 'trip',
  kind: 'travel_day',
  status: 'confirmed',
  title: null,
  starts_at: z('00:00'),
  ends_at: null,
  all_day: true,
  venue_name: null,
  city: 'Girona',
  destination_city: 'Girona',
  project: { id: 'pr', slug: 'pr', name: 'Obra', workspace_id: 'ws-mm' },
  venue: null,
  stages: [stage({}), stage({ id: 's2', position: 2, mode: 'taxi', from_place: 'Estació', to_place: 'Teatre', depart_at: z('08:40'), arrive_at: z('08:48'), reference: null })],
};

const SHOW: PerformanceEvent = {
  id: 'show',
  slug: 'show',
  performed_at: DAY,
  status: 'confirmed',
  start_at: z('18:30'),
  venue_name: 'Teatre Municipal',
  city: 'Girona',
  country: 'ES',
  line_id: null,
  project: { id: 'pr', slug: 'pr', name: 'Obra', workspace_id: 'ws-mm' },
  venue: { name: 'Teatre Municipal', city: 'Girona', timezone: TZ },
  schedule: [
    { kind: 'load_in', label: null, at: z('09:00'), ends_at: null },
    { kind: 'soundcheck', label: null, at: z('15:00'), ends_at: null },
    { kind: null, label: 'Cena', at: z('17:00'), ends_at: null },
    { kind: 'doors', label: null, at: z('18:00'), ends_at: null },
    { kind: 'start', label: null, at: z('18:30'), ends_at: null },
    { kind: 'loadout', label: null, at: z('19:50'), ends_at: null },
    { kind: 'curfew', label: null, at: z('21:30'), ends_at: null },
  ],
};

const input = { performances: [SHOW], dates: [TRIP], viewerTz: TZ };
const day = (now: Date) => {
  const items = ahoraItems(input);
  const d = ahoraDay(items, now, TZ);
  return { d, ...(d ? ahoraTimeline(items, d) : { items: [], points: [] }) };
};

describe('the three moments of a gig day', () => {
  test('morning: a countdown to the train, with its reference', () => {
    const now = at('06:30'); // 8h30 local
    const { points } = day(now);
    const s = ahoraState(points, now);
    expect(s.headline).toBe('countdown');
    expect(s.next?.of).toBe('stage');
    expect(minutesTo(s.next!.at, now)).toBe(42);
    expect(s.next?.of === 'stage' && s.next.stage.reference).toBe('K7Q2PX');
  });

  test('load-in: what you are in, until the next moment', () => {
    const now = at('12:10'); // 14h10 local
    const s = ahoraState(day(now).points, now);
    expect(s.headline).toBe('doing');
    expect(s.current?.of === 'moment' && s.current.key).toBe('load_in');
    expect(s.currentUntil).toBe(new Date(z('15:00')).toISOString());
    expect(minutesTo(s.next!.at, now)).toBe(170); // soundcheck in 2 h 50 min
  });

  test('30 minutes before: the countdown to the show beats the doors you are in', () => {
    const now = at('18:00'); // 20h00 local, doors open
    const s = ahoraState(day(now).points, now);
    expect(s.current?.of === 'moment' && s.current.key).toBe('doors');
    expect(s.headline).toBe('countdown');
    expect(s.next?.of === 'moment' && s.next.key).toBe('start');
    expect(minutesTo(s.next!.at, now)).toBe(30);
  });

  test('the trip and the show are ONE timeline, in time order', () => {
    const { items, points } = day(at('06:30'));
    expect(items.map((i) => i.id)).toEqual(['trip', 'show']);
    expect(points.slice(0, 3).map((p) => p.at)).toEqual([z('07:12'), z('08:40'), z('09:00')]);
  });

  test('between a stage that arrived and the next moment, nothing is «now»', () => {
    const now = at('08:55');
    const s = ahoraState(day(now).points, now);
    expect(s.current).toBeNull();
    expect(s.headline).toBe('countdown');
    expect(minutesTo(s.next!.at, now)).toBe(5);
  });

  test('after the curfew the day is done', () => {
    const now = at('21:40');
    const s = ahoraState(ahoraTimeline(ahoraItems(input), DAY).points, now);
    expect(s.current).toBeNull();
    expect(s.next).toBeNull();
    expect(s.headline).toBe('done');
  });
});

describe('which day Ahora shows', () => {
  test('today while something of it is on', () => {
    expect(day(at('06:30')).d).toBe(DAY);
  });
  test('once today is over, tomorrow (the eve asks for the call)', () => {
    const tomorrow = { ...SHOW, id: 'show2', performed_at: '2026-08-15', schedule: [{ kind: 'load_in', label: null, at: z('08:00', '2026-08-15'), ends_at: null }] };
    const items = ahoraItems({ ...input, performances: [SHOW, tomorrow] });
    expect(ahoraDay(items, at('21:45'), TZ)).toBe('2026-08-15');
  });
  test('nothing in the next 48 hours: null, and the screen says so', () => {
    const far = { ...SHOW, performed_at: '2026-08-20', schedule: [] };
    expect(ahoraDay(ahoraItems({ performances: [far], dates: [], viewerTz: TZ }), at('06:30'), TZ)).toBeNull();
  });
  test('a cancelled show and a rehearsal are not a gig day', () => {
    const rehearsal: DateEvent = { ...TRIP, id: 'r', kind: 'rehearsal', stages: null };
    const items = ahoraItems({ performances: [{ ...SHOW, status: 'cancelled' }], dates: [rehearsal], viewerTz: TZ });
    expect(items).toEqual([]);
  });
});

describe('countdown words', () => {
  test('minutes round up, never «0 min» before it happens', () => {
    expect(minutesTo(z('07:12'), new Date(`${DAY}T07:11:30Z`))).toBe(1);
  });
  test('hours and minutes', () => {
    expect(countdownParts(170)).toEqual({ h: 2, m: 50 });
    expect(countdownParts(42)).toEqual({ h: 0, m: 42 });
    expect(countdownParts(-3)).toEqual({ h: 0, m: 0 });
  });
});

describe('who to call at the venue', () => {
  test('the technical contact, by the words of its free role', () => {
    const c = venueCall([
      { name: 'Ana', role: 'Programación', phone: '600 111 111' },
      { name: 'Jordi Puig', role: 'Cap tècnic', phone: '612 000 000' },
    ]);
    expect(c).toEqual({ name: 'Jordi Puig', role: 'Cap tècnic', phone: '612 000 000', by: 'technical' });
  });
  test('production when nobody is technical', () => {
    expect(venueCall([{ name: 'A', role: 'Taquilla', phone: '1' }, { name: 'B', role: 'Producción', phone: '2' }])?.name).toBe('B');
  });
  test('else the main contact (the first one with a phone)', () => {
    const c = venueCall([{ name: 'No phone', role: null }, { name: 'Main', role: 'Dirección', phone: '3' }]);
    expect(c).toMatchObject({ name: 'Main', by: 'main' });
  });
  test('a technician with no phone loses to one who can be called', () => {
    expect(venueCall([{ name: 'Tech', role: 'Técnico' }, { name: 'Main', phone: '4' }])?.name).toBe('Main');
  });
  test('nobody with a phone: still named, no call', () => {
    expect(venueCall([{ name: 'Tech', role: 'Stage manager' }])).toMatchObject({ name: 'Tech', phone: null, by: 'technical' });
  });
  test('nothing usable on file', () => {
    expect(venueCall(null)).toBeNull();
    expect(venueCall({ name: 'x' })).toBeNull();
    expect(venueCall([{ role: 'Técnico' }])).toBeNull();
  });
  test('tel and maps links', () => {
    expect(telHref('+34 612 00 00 00')).toBe('tel:+34612000000');
    expect(mapsHref(['Plaça del Vi 1', 'Girona'])).toBe('https://maps.apple.com/?q=Pla%C3%A7a%20del%20Vi%201%2C%20Girona');
    expect(mapsHref([null, ''])).toBeNull();
  });
});

describe('the freshness line (amends ADR-144 § 6 for Ahora)', () => {
  const now = Date.parse(z('12:00'));
  test('online and recent: nothing', () => {
    expect(freshnessShown(now - 5 * 60_000, now, true)).toBe(false);
  });
  test('without network: always, however recent', () => {
    expect(freshnessShown(now - 60_000, now, false)).toBe(true);
  });
  test('older than one hour: said even online', () => {
    expect(freshnessShown(now - FRESH_MS - 1, now, true)).toBe(true);
    expect(freshnessShown(now - FRESH_MS, now, true)).toBe(false);
  });
  test('nothing landed yet: no line (there is no age to say)', () => {
    expect(freshnessShown(null, now, false)).toBe(false);
  });
});

describe('hotel, parking and load access: fixed keys in logistics', () => {
  test('canonical keys and the words people type, any case or accent', () => {
    expect(logisticsLines({ Hotel: 'Ultònia · check-in 14h', Aparcament: 'Plaça Catalunya', 'Accés de càrrega': 'c/ Ballesteries' })).toEqual({
      hotel: 'Ultònia · check-in 14h',
      parking: 'Plaça Catalunya',
      load_access: 'c/ Ballesteries',
    });
    expect(logisticsLines({ accommodation: { name: 'Ultònia', confirmation: 'H123' } })).toEqual({ hotel: 'Ultònia · H123' });
  });
  test('other lines stay in the details', () => {
    expect(logisticsLines({ catering: '19h' })).toEqual({});
    expect(logisticsLines(null)).toEqual({});
  });
});

describe('the road sheet Ahora asks for, and the way back in', () => {
  test('the space crew asks for the whole sheet, a guest for the technician’s cut', () => {
    expect(ahoraRoadsheetRole('member')).toBe('full');
    expect(ahoraRoadsheetRole(null)).toBe('full');
    expect(ahoraRoadsheetRole('guest')).toBe('tech_manager');
  });
  test('the home-screen app reopens in Ahora only on the day it was left open', () => {
    expect(ahoraRelaunch(DAY, DAY)).toBe(true);
    expect(ahoraRelaunch('2026-08-13', DAY)).toBe(false);
    expect(ahoraRelaunch(null, DAY)).toBe(false);
  });
});
