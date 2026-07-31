/**
 * The run sheet adapter (`_tasks.md § 25`, ADR-090).
 *
 * These tests pin the SEAM, not the five columns. When `schedule_slot` lands
 * and the moments become rows with free labels, `runSheetSteps` is the only
 * thing that changes — and if these still pass, nothing that draws a day
 * noticed. That is the entire point of the adapter existing before the UI.
 */

import { describe, expect, test } from 'vitest';
import { runSheetSteps, perfInstant, type PerformanceEvent } from './month-events';

function perf(over: Partial<PerformanceEvent> = {}): PerformanceEvent {
  return {
    id: 'p1',
    slug: 'p1',
    performed_at: '2026-07-31',
    status: 'confirmed',
    start_at: null,
    venue_name: null,
    city: null,
    country: null,
    line_id: null,
    project: null,
    venue: null,
    ...over,
  };
}

describe('runSheetSteps', () => {
  test('returns the five moments in the running order, not the object order', () => {
    const steps = runSheetSteps(
      perf({
        // deliberately scrambled: the adapter owns the order
        wrap_at: '2026-07-31T23:30:00Z',
        start_at: '2026-07-31T20:00:00Z',
        load_in_at: '2026-07-31T14:00:00Z',
        loadout_at: '2026-07-31T22:00:00Z',
        soundcheck_at: '2026-07-31T17:00:00Z',
      }),
    );
    expect(steps.map((s) => s.key)).toEqual([
      'load_in',
      'soundcheck',
      'start',
      'loadout',
      'wrap',
    ]);
  });

  test('skips what nobody filled in — a gap is not an empty row', () => {
    const steps = runSheetSteps(
      perf({ load_in_at: '2026-07-31T14:00:00Z', start_at: '2026-07-31T20:00:00Z' }),
    );
    expect(steps).toEqual([
      { key: 'load_in', at: '2026-07-31T14:00:00Z' },
      { key: 'start', at: '2026-07-31T20:00:00Z' },
    ]);
  });

  test('a performance with no times at all is an empty list, never a null', () => {
    expect(runSheetSteps(perf())).toEqual([]);
  });

  test('absent columns and null columns read the same', () => {
    // Rows fetched by a feed that does not SELECT them arrive as undefined;
    // rows that were never filled arrive as null. Neither is a moment.
    expect(runSheetSteps(perf({ soundcheck_at: null, wrap_at: undefined }))).toEqual([]);
  });

  test('the key is a vocabulary, not a label — nothing here is printable', () => {
    const steps = runSheetSteps(perf({ soundcheck_at: '2026-07-31T17:00:00Z' }));
    expect(steps[0].key).toBe('soundcheck');
    // If this ever reads "Soundcheck", i18n has been bypassed.
    expect(steps[0].key).not.toMatch(/[A-Z]/);
  });
});

describe('perfInstant (unchanged by the adapter)', () => {
  test('prefers load-in, falls back to start', () => {
    expect(perfInstant(perf({ load_in_at: 'a', start_at: 'b' }))).toBe('a');
    expect(perfInstant(perf({ start_at: 'b' }))).toBe('b');
    expect(perfInstant(perf())).toBeNull();
  });
});
