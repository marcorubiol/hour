/**
 * The run sheet adapter (`_tasks.md § 25`, ADR-090).
 *
 * These tests pin the SEAM, not the five columns. When `schedule_slot` lands
 * and the moments become rows with free labels, `runSheetSteps` is the only
 * thing that changes — and if these still pass, nothing that draws a day
 * noticed. That is the entire point of the adapter existing before the UI.
 */

import { describe, expect, test } from 'vitest';
import {
  runSheetSteps,
  perfInstant,
  performanceSlip,
  dateSlip,
  type PerformanceEvent,
  type DateEvent,
} from './month-events';

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

/**
 * The slip normaliser (ADR-095 §0).
 *
 * These pin the LAWS, not the fields. The design's argument is that four
 * drawings render one object, so the moment a second implementation of "what
 * is a slip" appears, the month and the board start drifting — which is
 * exactly the history this normaliser exists to end.
 */
const CTX = {
  workspaceSlug: 'fallback',
  workspaceSlugById: new Map([['ws1', 'muk-cia']]),
  workspaceTzById: new Map([['ws1', 'Europe/Madrid']]),
  viewerTz: 'Europe/Madrid',
  kindLabel: (k: string) => k.replace(/_/g, ' '),
  // Deterministic stand-in: a real wall time, secondary only when the two
  // zones differ — the real `dualTime` law, without Intl in a test.
  //
  // THE ZONE IS RECORDED, NOT SMUGGLED THROUGH THE OUTPUT. It used to ride
  // inside `primary` as `20:00@Europe/Madrid`, which worked only while
  // nothing downstream touched the string — and the moment `hourMark` turned
  // it into the Planner's clock, `20:00@Europe/Madrid` became `20h` and the
  // zone the test existed to check was silently gone. A stub that has to
  // survive its consumer's formatting is testing the formatter.
  dualTime: (at: string, tz: string | null, viewerTz: string) => {
    tzCalls.push(tz);
    return {
      primary: at.slice(11, 16),
      secondary: tz && tz !== viewerTz ? at.slice(11, 16) : null,
    };
  },
};
/** Every zone `dualTime` was called with, in order. Reset per test. */
const tzCalls: (string | null)[] = [];

const PROJ = { id: 'p1', slug: 'mamemi', name: 'MaMeMi', workspace_id: 'ws1' };

function gig(over: Partial<PerformanceEvent> = {}): PerformanceEvent {
  return {
    id: 'perf1',
    slug: 'terrassa-18',
    performed_at: '2026-07-18',
    status: 'confirmed',
    start_at: '2026-07-18T20:00:00Z',
    venue_name: null,
    city: null,
    country: null,
    line_id: null,
    project: PROJ,
    venue: null,
    ...over,
  };
}

function dateRow(over: Partial<DateEvent> = {}): DateEvent {
  return {
    id: 'd1',
    kind: 'rehearsal',
    status: 'confirmed',
    title: null,
    starts_at: '2026-07-18T10:00:00Z',
    all_day: false,
    venue_name: null,
    city: null,
    project: PROJ,
    venue: null,
    ...over,
  };
}

describe('performanceSlip', () => {
  test('a slip never prints the same place twice', () => {
    // The name already fell back to the city, so the city line is suppressed.
    const s = performanceSlip(gig({ city: 'Terrassa' }), CTX);
    expect(s.name).toBe('Terrassa');
    expect(s.city).toBeNull();
  });

  test('the name falls back venue → venue_name → city → project', () => {
    expect(performanceSlip(gig({ venue: { name: 'L’Atlàntida', city: null, timezone: null } }), CTX).name)
      .toBe('L’Atlàntida');
    expect(performanceSlip(gig({ venue_name: 'Antic Teatre' }), CTX).name).toBe('Antic Teatre');
    expect(performanceSlip(gig({ city: 'Olot' }), CTX).name).toBe('Olot');
    expect(performanceSlip(gig(), CTX).name).toBe('MaMeMi');
  });

  test('a venue-less gig reads its home space clock, never the browser’s', () => {
    // The zone its times were ENTERED in. Silently using the reader's would
    // move the gig by an hour and nothing on screen would say so.
    tzCalls.length = 0;
    performanceSlip(gig(), CTX);
    expect(tzCalls).toEqual(['Europe/Madrid']);
  });

  test('the hour is the Planner’s clock, not a wire format', () => {
    // `20:00` reads as a precise instant and costs five characters in the
    // tightest text in the app; nine gigs in ten are called at a round hour.
    expect(performanceSlip(gig(), CTX).time?.primary).toBe('20h');
  });

  test('the second clock appears only when the two disagree — and it is a gloss', () => {
    const away = performanceSlip(
      gig({ venue: { name: 'Cafe OTO', city: 'London', country: 'gb', timezone: 'Europe/London' } }),
      CTX,
    );
    expect(away.time?.secondary).not.toBeNull();
    expect(performanceSlip(gig(), CTX).time?.secondary).toBeNull();
  });

  test('country is upper-cased ISO-2, and the DRAWING decides whether to print it', () => {
    const s = performanceSlip(
      gig({ venue: { name: 'Cafe OTO', city: 'London', country: 'gb', timezone: null } }),
      CTX,
    );
    expect(s.country).toBe('GB');
  });

  test('cancelled normalises to released — the certainty, not the status', () => {
    expect(performanceSlip(gig({ status: 'cancelled' }), CTX).cert).toBe('released');
    expect(performanceSlip(gig({ status: 'hold_2' }), CTX).cert).toBe('hold');
    expect(performanceSlip(gig(), CTX).cert).toBe('confirmed');
  });

  test('a gig with no hour has no time at all — never a dash', () => {
    // A hold is a date somebody ASKED for, so most arrive without an hour.
    // The absence is a fact; drawing `—` reads as an hour that failed to print.
    expect(performanceSlip(gig({ start_at: null, status: 'hold' }), CTX).time).toBeNull();
  });

  test('href resolves through the workspace slug map, and is null without a slug', () => {
    expect(performanceSlip(gig(), CTX).href).toBe('/h/muk-cia/performance/terrassa-18');
    expect(performanceSlip(gig({ slug: null }), CTX).href).toBeNull();
  });
});

describe('dateSlip', () => {
  test('every kind survives verbatim — no translation table in the model', () => {
    expect(dateSlip(dateRow({ kind: 'travel_day' }), CTX).kind).toBe('travel_day');
    expect(dateSlip(dateRow({ kind: 'day_off' }), CTX).kind).toBe('day_off');
  });

  test('an all-day row has no clock', () => {
    expect(dateSlip(dateRow({ all_day: true }), CTX).time).toBeNull();
  });

  test('a date names itself by title, then venue, then city, then its kind', () => {
    expect(dateSlip(dateRow({ title: 'Assaig general' }), CTX).name).toBe('Assaig general');
    expect(dateSlip(dateRow({ venue_name: 'La Caldera' }), CTX).name).toBe('La Caldera');
    expect(dateSlip(dateRow({ city: 'Salt' }), CTX).name).toBe('Salt');
    expect(dateSlip(dateRow(), CTX).name).toBe('rehearsal');
  });

  test('a cancelled date is released too — one vocabulary, both primitives', () => {
    // If these two ever disagree the month draws two grammars on one sheet.
    expect(dateSlip(dateRow({ status: 'cancelled' }), CTX).cert).toBe('released');
    expect(dateSlip(dateRow({ status: 'tentative' }), CTX).cert).toBe('hold');
  });

  test('a date has no page of its own yet, so it carries no href', () => {
    expect(dateSlip(dateRow(), CTX).href).toBeNull();
  });
});
