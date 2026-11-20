import { describe, expect, test } from 'vitest';
import { zoneDay, zoneFormatter } from './zone-format';

describe('zoneFormatter: one formatter per shape and zone', () => {
  test('the same zone and shape hand back the same formatter', () => {
    expect(zoneFormatter('day', 'Europe/Madrid')).toBe(zoneFormatter('day', 'Europe/Madrid'));
    expect(zoneFormatter('day', 'Europe/Madrid')).not.toBe(zoneFormatter('day', 'America/Bogota'));
    expect(zoneFormatter('day', 'Europe/Madrid')).not.toBe(zoneFormatter('time', 'Europe/Madrid'));
  });

  test('the day is the zone’s own, either side of midnight', () => {
    const at = new Date('2026-11-20T23:30:00Z');
    expect(zoneDay(at, 'Europe/Madrid')).toBe('2026-11-21');
    expect(zoneDay(at, 'America/Bogota')).toBe('2026-11-20');
    expect(zoneDay(at.getTime(), 'UTC')).toBe('2026-11-20');
  });

  test('the hour is 24 h, and the parts reach the second', () => {
    const at = new Date('2026-07-17T18:30:05Z');
    expect(zoneFormatter('time', 'Europe/Madrid').format(at)).toBe('20:30');
    const parts = Object.fromEntries(
      zoneFormatter('parts', 'Europe/Madrid')
        .formatToParts(at)
        .map((p) => [p.type, p.value]),
    );
    expect(`${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}`).toBe(
      '2026-07-17T20:30:05',
    );
  });

  test('an unknown zone throws every time: a failure is never kept', () => {
    expect(() => zoneFormatter('day', 'Nowhere/Never')).toThrow(RangeError);
    expect(() => zoneFormatter('day', 'Nowhere/Never')).toThrow(RangeError);
  });
});
