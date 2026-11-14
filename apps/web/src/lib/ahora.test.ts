/**
 * What remains of Ahora (ADR-146): the rules Hoy, the road sheet and the map
 * links lean on: the countdown, who to call, the map link, when it says how
 * old its data is.
 */
import { describe, expect, test } from 'vitest';
import {
  ahoraRoadsheetRole,
  countdownParts,
  freshnessShown,
  FRESH_MS,
  isMapsApp,
  logisticsLines,
  mapsHref,
  minutesTo,
  telHref,
  venueCall,
} from './ahora';

describe('countdown words', () => {
  test('minutes round up, never «0 min» before it happens', () => {
    expect(minutesTo('2026-08-14T07:12:00Z', new Date('2026-08-14T07:11:30Z'))).toBe(1);
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
  test('maps links in each app, Apple by default (ADR-206)', () => {
    const at = ['Plaça del Vi 1', 'Girona'];
    const q = 'Pla%C3%A7a%20del%20Vi%201%2C%20Girona';
    expect(mapsHref(at, 'apple')).toBe(`https://maps.apple.com/?q=${q}`);
    expect(mapsHref(at, 'google')).toBe(`https://www.google.com/maps/search/?api=1&query=${q}`);
    expect(mapsHref(at, 'waze')).toBe(`https://waze.com/ul?q=${q}&navigate=yes`);
    expect(mapsHref(at)).toBe(mapsHref(at, 'apple'));
    expect(mapsHref(['  '], 'waze')).toBeNull();
    expect(isMapsApp('google')).toBe(true);
    expect(isMapsApp('here')).toBe(false);
    expect(isMapsApp(null)).toBe(false);
  });
});

describe('the freshness line (amends ADR-144 § 6 for Ahora)', () => {
  const now = Date.parse('2026-08-14T12:00:00Z');
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

describe('the road sheet Hoy\'s piece asks for (ADR-146 § 6)', () => {
  test('the space crew asks for the whole sheet, a guest for the technician’s cut', () => {
    expect(ahoraRoadsheetRole('member')).toBe('full');
    expect(ahoraRoadsheetRole(null)).toBe('full');
    expect(ahoraRoadsheetRole('guest')).toBe('tech_manager');
  });
});
