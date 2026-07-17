import { describe, expect, it } from 'vitest';
import { dualTime, instantToWallClock, timeInTz, wallClockToInstant } from './datetime';

describe('timeInTz', () => {
  it('renders wall time in the requested zone', () => {
    expect(timeInTz('2026-10-24T11:00:00Z', 'Europe/Madrid')).toBe('13:00');
    expect(timeInTz('2026-10-24T11:00:00Z', 'UTC')).toBe('11:00');
  });

  it('handles the 2026-10-25 CEST→CET switch (demo MAD show window)', () => {
    // Before the switch: UTC+2.
    expect(timeInTz('2026-10-24T23:30:00Z', 'Europe/Madrid')).toBe('01:30');
    // After the switch (01:00Z): UTC+1.
    expect(timeInTz('2026-10-25T02:30:00Z', 'Europe/Madrid')).toBe('03:30');
  });
});

describe('dualTime', () => {
  it('venue zone leads, viewer zone trails when different', () => {
    const d = dualTime('2026-10-24T11:00:00Z', 'Europe/Madrid', 'Europe/London');
    expect(d.primary).toBe('13:00');
    expect(d.secondary).toBe('12:00');
  });

  it('collapses to a single time when zones agree on the wall clock', () => {
    const d = dualTime('2026-10-24T11:00:00Z', 'Europe/Madrid', 'Europe/Paris');
    expect(d.primary).toBe('13:00');
    expect(d.secondary).toBeNull();
  });

  it('falls back to the viewer zone when the venue has none', () => {
    const d = dualTime('2026-10-24T11:00:00Z', null, 'Europe/Madrid');
    expect(d.primary).toBe('13:00');
    expect(d.secondary).toBeNull();
  });

  it('exposes day rollover across zones', () => {
    const d = dualTime('2026-10-24T23:30:00Z', 'Europe/Madrid', 'UTC');
    expect(d.primary).toBe('01:30');
    expect(d.primaryDay).toBe('2026-10-25');
    expect(d.secondary).toBe('23:30');
    expect(d.secondaryDay).toBe('2026-10-24');
  });
});

describe('wallClockToInstant / instantToWallClock', () => {
  it('interprets the wall time in the given zone, not the runtime zone', () => {
    // London summer (BST, +1): typing "20:30" for a London gig must store
    // 19:30Z — THE foreign-gig entry contract.
    expect(wallClockToInstant('2026-08-28T20:30', 'Europe/London')).toBe(
      '2026-08-28T19:30:00.000Z',
    );
    // Madrid summer (CEST, +2) and winter (CET, +1).
    expect(wallClockToInstant('2026-07-17T20:30', 'Europe/Madrid')).toBe(
      '2026-07-17T18:30:00.000Z',
    );
    expect(wallClockToInstant('2026-01-15T20:30', 'Europe/Madrid')).toBe(
      '2026-01-15T19:30:00.000Z',
    );
    // A far zone with no DST since 2022 (UTC-6): day rolls over in UTC.
    expect(wallClockToInstant('2026-07-17T20:30', 'America/Mexico_City')).toBe(
      '2026-07-18T02:30:00.000Z',
    );
  });

  it('roundtrips without drift (London gig edited from Barcelona)', () => {
    const stored = wallClockToInstant('2026-08-28T20:30', 'Europe/London')!;
    const shown = instantToWallClock(stored, 'Europe/London');
    expect(shown).toBe('2026-08-28T20:30');
    expect(wallClockToInstant(shown, 'Europe/London')).toBe(stored);
    // The same instant reads 21:30 for the Barcelona viewer — display
    // concern (dualTime), never what gets stored.
    expect(instantToWallClock(stored, 'Europe/Madrid')).toBe('2026-08-28T21:30');
  });

  it('DST spring forward (positive-offset zone): a nonexistent wall time shifts forward', () => {
    // Europe/Madrid jumps 02:00 → 03:00 on 2026-03-29; 02:30 never happens.
    expect(wallClockToInstant('2026-03-29T02:30', 'Europe/Madrid')).toBe(
      '2026-03-29T01:30:00.000Z', // = 03:30 CEST
    );
    // The neighbours on both sides stay exact.
    expect(wallClockToInstant('2026-03-29T01:59', 'Europe/Madrid')).toBe(
      '2026-03-29T00:59:00.000Z', // CET
    );
    expect(wallClockToInstant('2026-03-29T03:00', 'Europe/Madrid')).toBe(
      '2026-03-29T01:00:00.000Z', // CEST
    );
  });

  it('DST fall back (positive-offset zone): an ambiguous wall time resolves to the later occurrence', () => {
    // Europe/Madrid repeats 02:00–03:00 on 2026-10-25; 02:30 happens twice
    // (00:30Z CEST, then 01:30Z CET). Deterministic pick: the CET one.
    expect(wallClockToInstant('2026-10-25T02:30', 'Europe/Madrid')).toBe(
      '2026-10-25T01:30:00.000Z',
    );
    expect(wallClockToInstant('2026-10-25T03:30', 'Europe/Madrid')).toBe(
      '2026-10-25T02:30:00.000Z', // unambiguous again
    );
  });

  it('DST in a negative-offset zone resolves the other way (pinned, deterministic)', () => {
    // America/New_York fall back 2026-11-01: 01:30 happens twice (05:30Z
    // EDT, then 06:30Z EST) — west of UTC the EARLIER occurrence wins.
    expect(wallClockToInstant('2026-11-01T01:30', 'America/New_York')).toBe(
      '2026-11-01T05:30:00.000Z',
    );
    // Spring forward 2026-03-08: 02:30 never happens — resolves backward
    // (06:30Z renders as 01:30 EST). Still roundtrip-safe for real times.
    expect(wallClockToInstant('2026-03-08T02:30', 'America/New_York')).toBe(
      '2026-03-08T06:30:00.000Z',
    );
  });

  it('rejects malformed input and empty values', () => {
    expect(wallClockToInstant('', 'Europe/Madrid')).toBeNull();
    expect(wallClockToInstant('2026-13-45T99:99', 'Europe/Madrid')).toBeNull();
    expect(wallClockToInstant('not-a-date', 'Europe/Madrid')).toBeNull();
    expect(instantToWallClock(null, 'Europe/Madrid')).toBe('');
    expect(instantToWallClock('garbage', 'Europe/Madrid')).toBe('');
  });

  it('accepts seconds in the wall string (API roundtrips)', () => {
    expect(wallClockToInstant('2026-07-17T20:30:45', 'Europe/Madrid')).toBe(
      '2026-07-17T18:30:45.000Z',
    );
  });
});
