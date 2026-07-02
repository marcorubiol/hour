import { describe, expect, it } from 'vitest';
import { dualTime, timeInTz } from './datetime';

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
