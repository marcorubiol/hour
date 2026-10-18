import { describe, expect, it } from 'vitest';
import { cellMark, gapWindows, mondayOf, seasonWindow, unclosed } from './season';

describe('seasonWindow', () => {
  it('draws twelve Monday rows and counts from today', () => {
    // 2026-10-16 is a Friday.
    const w = seasonWindow('2026-10-16');
    expect(w.weeks).toHaveLength(12);
    expect(w.weeks.every((r) => r.length === 7)).toBe(true);
    expect(w.weeks[0][0]).toBe('2026-10-12');
    expect(w.to).toBe('2027-01-03');
    expect(w.from).toBe('2026-10-16');
    expect(w.days[0]).toBe('2026-10-16');
    expect(w.days[w.days.length - 1]).toBe('2027-01-03');
    // 84 cells minus the four days of this week already gone.
    expect(w.days).toHaveLength(80);
  });

  it('a Monday opens its own row with nothing behind it', () => {
    const w = seasonWindow('2026-10-12');
    expect(w.weeks[0][0]).toBe('2026-10-12');
    expect(w.days).toHaveLength(84);
  });

  it('mondayOf a Sunday is the Monday before', () => {
    expect(mondayOf('2026-10-18')).toBe('2026-10-12');
  });
});

describe('gapWindows', () => {
  const days = ['01', '02', '03', '04', '05', '06', '07', '08', '09', '10'].map((d) => `2026-11-${d}`);

  it('groups free runs of three nights or more', () => {
    const gaps = gapWindows(days, ['2026-11-04', '2026-11-06']);
    expect(gaps).toEqual([
      { from: '2026-11-01', to: '2026-11-03', nights: 3 },
      { from: '2026-11-07', to: '2026-11-10', nights: 4 },
    ]);
  });

  it('a night on tour is not for sale', () => {
    const gaps = gapWindows(days, [], ['2026-11-03', '2026-11-04', '2026-11-05', '2026-11-06', '2026-11-07']);
    expect(gaps).toEqual([{ from: '2026-11-08', to: '2026-11-10', nights: 3 }]);
  });

  it('honours a custom minimum and says nothing about a full calendar', () => {
    expect(gapWindows(days, days)).toEqual([]);
    expect(gapWindows(days.slice(0, 2), [], [], 2)).toEqual([
      { from: '2026-11-01', to: '2026-11-02', nights: 2 },
    ]);
  });
});

describe('unclosed', () => {
  const ready = { hotel: true, technical: true };

  it('a closed gig is missing nothing', () => {
    const v = unclosed(
      { start_at: '2026-11-01T19:00:00Z', readiness: ready, person_ids: ['p'], city: 'Girona' },
      { home: 'Girona', travelCovered: false },
    );
    expect(v).toEqual({ missing: [], travelGuess: false });
  });

  it('names each empty field, readiness absent reads as not ticked', () => {
    const v = unclosed(
      { start_at: null, readiness: null, person_ids: [], city: 'Girona' },
      { home: 'Girona', travelCovered: false },
    );
    expect(v.missing).toEqual(['time', 'hotel', 'technical', 'cast']);
  });

  it('an unknown roster is not an empty one; a «voy» is somebody going', () => {
    expect(
      unclosed({ start_at: 'x', readiness: ready, city: null }, { home: null, travelCovered: false }).missing,
    ).toEqual([]);
    expect(
      unclosed(
        { start_at: 'x', readiness: ready, person_ids: [], commitments: [{ state: 'going' }], city: null },
        { home: null, travelCovered: false },
      ).missing,
    ).toEqual([]);
  });

  it('travel is only ever a guess: another city, nothing covering it', () => {
    const perf = { start_at: 'x', readiness: ready, person_ids: ['p'], city: 'Lisboa' };
    expect(unclosed(perf, { home: 'Barcelona', travelCovered: false }).travelGuess).toBe(true);
    expect(unclosed(perf, { home: 'Barcelona', travelCovered: true }).travelGuess).toBe(false);
    // Same city, any spelling.
    expect(unclosed({ ...perf, city: 'gíróna ' }, { home: 'Girona', travelCovered: false }).travelGuess).toBe(false);
    // No home on file: no guess at all.
    expect(unclosed(perf, { home: null, travelCovered: false }).travelGuess).toBe(false);
    // Never a fact.
    expect(unclosed(perf, { home: 'Barcelona', travelCovered: false }).missing).toEqual([]);
  });
});

describe('cellMark', () => {
  it('draws a proposal as an option, like every other drawing', () => {
    expect(cellMark([{ day: 'd', family: 'proposed', kind: 'perf' }])).toBe('option');
  });
  it('firm beats option beats any other date', () => {
    expect(cellMark([])).toBeNull();
    expect(cellMark([{ day: 'd', family: 'confirmed', kind: 'date' }])).toBe('date');
    expect(
      cellMark([
        { day: 'd', family: 'confirmed', kind: 'date' },
        { day: 'd', family: 'hold', kind: 'perf' },
      ]),
    ).toBe('option');
    expect(
      cellMark([
        { day: 'd', family: 'hold', kind: 'perf' },
        { day: 'd', family: 'confirmed', kind: 'perf' },
      ]),
    ).toBe('firm');
  });

  it('travel is not a mark of its own', () => {
    expect(cellMark([{ day: 'd', family: 'confirmed', kind: 'travel' }])).toBeNull();
  });
});
