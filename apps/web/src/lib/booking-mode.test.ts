import { describe, expect, it } from 'vitest';
import { bookingModeOf, bookingModePatch, defaultBookingMode } from './booking-mode';

describe('booking mode follows the trade (tarea 140)', () => {
  it('music ranks its holds, stage and an unknown trade do not', () => {
    expect(defaultBookingMode('music')).toBe('prioritized');
    expect(defaultBookingMode('stage')).toBe('simple');
    expect(defaultBookingMode(null)).toBe('simple');
    expect(defaultBookingMode(undefined)).toBe('simple');
  });

  it('an absent or unknown stored mode reads as the trade’s own', () => {
    expect(bookingModeOf({ trade: 'music' })).toBe('prioritized');
    expect(bookingModeOf({ trade: 'music', booking_mode: null })).toBe('prioritized');
    expect(bookingModeOf({ trade: 'stage', booking_mode: 'nonsense' })).toBe('simple');
    expect(bookingModeOf({})).toBe('simple');
  });

  it('a stored mode wins over the trade', () => {
    expect(bookingModeOf({ trade: 'music', booking_mode: 'simple' })).toBe('simple');
    expect(bookingModeOf({ trade: 'stage', booking_mode: 'prioritized' })).toBe('prioritized');
  });

  it('choosing the trade’s own clears the key; departing from it stores the mode', () => {
    expect(bookingModePatch('prioritized', 'music')).toBe('');
    expect(bookingModePatch('simple', 'stage')).toBe('');
    expect(bookingModePatch('simple', 'music')).toBe('simple');
    expect(bookingModePatch('prioritized', 'stage')).toBe('prioritized');
  });
});
