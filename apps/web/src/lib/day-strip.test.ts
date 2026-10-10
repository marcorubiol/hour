import { describe, expect, it } from 'vitest';
import {
  hourOf,
  performanceThread,
  dateThread,
  stripWindow,
  overlaps,
  pct,
} from './day-strip';
import type { PerformanceEvent, DateEvent } from './month-events';

const TZ = 'UTC';
const PROJ = { id: 'p1', slug: 'mm', name: 'MaMeMi', workspace_id: 'ws1' };

function gig(over: Partial<PerformanceEvent> = {}): PerformanceEvent {
  return {
    id: 'g1',
    slug: 'g1',
    performed_at: '2026-07-18',
    status: 'confirmed',
    start_at: null,
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

describe('hourOf', () => {
  it('reads the hour in the given zone, as a fraction', () => {
    expect(hourOf('2026-07-18T20:30:00Z', 'UTC')).toBe(20.5);
    // 20:30Z is 22:30 in Madrid in July (CEST).
    expect(hourOf('2026-07-18T20:30:00Z', 'Europe/Madrid')).toBe(22.5);
  });
  it('an unparseable instant is null, never 0 — midnight is a real hour', () => {
    expect(hourOf('not-a-date', 'UTC')).toBeNull();
  });
});

describe('performanceThread — THE LAW: never a step that is not in the data', () => {
  it('a gig with four written steps draws four marks and one bar', () => {
    const t = performanceThread(
      gig({
        load_in_at: '2026-07-18T14:00:00Z',
        soundcheck_at: '2026-07-18T17:00:00Z',
        start_at: '2026-07-18T20:00:00Z',
        loadout_at: '2026-07-18T23:00:00Z',
      }),
      TZ,
      'Teatre Principal',
      'Terrassa',
      'confirmed',
    )!;
    expect(t.marks.map((m) => m.step)).toEqual(['load_in', 'soundcheck', 'start', 'loadout']);
    expect(t.spans).toEqual([{ from: 14, to: 23 }]);
    // Only the show is in full ink: it is why the row exists.
    expect(t.marks.filter((m) => m.show).map((m) => m.at)).toEqual([20]);
  });

  it('a gig with ONLY a show hour is an INSTANT, not a bar', () => {
    // A bar would claim a duration nobody stated. This is the defect the
    // prototype called out: every gig owning a run sheet nobody gave it.
    const t = performanceThread(gig({ start_at: '2026-07-18T20:00:00Z' }), TZ, 'X', null, 'confirmed')!;
    expect(t.spans).toEqual([]);
    expect(t.marks).toHaveLength(1);
    expect(t.marks[0].solo).toBe(true);
    expect(t.steps).toEqual(['start']);
  });

  it('a gig with NO hour at all draws nothing — it is not a thread', () => {
    // The normal case for a hold: a date somebody asked for. It belongs in the
    // day's words, never on the track, because there is nowhere to put it.
    expect(performanceThread(gig({ status: 'hold' }), TZ, 'X', null, 'hold')).toBeNull();
  });

  it('the steps it publishes are exactly the ones it drew', () => {
    // This is what an audit checks: every mark on the track is in `steps`.
    const t = performanceThread(
      gig({ load_in_at: '2026-07-18T14:00:00Z', start_at: '2026-07-18T20:00:00Z' }),
      TZ,
      'X',
      null,
      'confirmed',
    )!;
    expect(new Set(t.steps)).toEqual(new Set(t.marks.map((m) => m.step)));
  });
});

describe('dateThread', () => {
  it('a timed range is a bar with NO marks — a date has no run sheet', () => {
    const t = dateThread(
      dateRow({ starts_at: '2026-07-18T10:00:00Z', ends_at: '2026-07-18T14:00:00Z' }),
      TZ,
      'Assaig',
      'Barcelona',
      'confirmed',
    )!;
    expect(t.spans).toEqual([{ from: 10, to: 14 }]);
    expect(t.marks).toEqual([]);
    expect(t.steps).toEqual([]);
  });

  it('an all-day row is not a thread: it does not occupy a stretch of hours', () => {
    expect(dateThread(dateRow({ all_day: true }), TZ, 'X', null, 'confirmed')).toBeNull();
  });

  it('a start with no end is an instant', () => {
    const t = dateThread(dateRow({ ends_at: null }), TZ, 'X', null, 'confirmed')!;
    expect(t.spans).toEqual([]);
    expect(t.marks[0].solo).toBe(true);
  });

  describe('a trip with stages (ADR-089 P2)', () => {
    const trip = dateRow({
      kind: 'travel_day',
      starts_at: '2026-07-18T08:00:00Z',
      ends_at: '2026-07-18T12:00:00Z',
    });

    it('draws each stage as its own bar, with the gap between them', () => {
      const t = dateThread(trip, TZ, 'Sevilla', null, 'confirmed', [
        { depart_at: '2026-07-18T08:15:00Z', arrive_at: '2026-07-18T10:40:00Z' },
        { depart_at: '2026-07-18T11:00:00Z', arrive_at: '2026-07-18T11:40:00Z' },
      ])!;
      expect(t.spans).toEqual([
        { from: 8.25, to: 10 + 40 / 60 },
        { from: 11, to: 11 + 40 / 60 },
      ]);
      expect(t.a).toBe(8.25);
      expect(t.b).toBeCloseTo(11.667, 2);
    });

    it('a stage with one hour is an instant', () => {
      const t = dateThread(trip, TZ, 'X', null, 'confirmed', [{ depart_at: '2026-07-18T09:00:00Z', arrive_at: null }])!;
      expect(t.spans).toEqual([]);
      expect(t.marks).toEqual([{ at: 9, step: 'start', show: false, solo: true }]);
    });

    it('a night stage runs past midnight on the axis', () => {
      const t = dateThread(trip, TZ, 'X', null, 'confirmed', [
        { depart_at: '2026-07-18T23:00:00Z', arrive_at: '2026-07-19T01:30:00Z' },
      ])!;
      expect(t.spans).toEqual([{ from: 23, to: 25.5 }]);
    });

    it('stages without hours leave the trip as it was', () => {
      const t = dateThread(trip, TZ, 'X', null, 'confirmed', [{ depart_at: null, arrive_at: null }])!;
      expect(t.spans).toEqual([{ from: 8, to: 12 }]);
    });

    it('an all-day trip with timed stages still draws them', () => {
      const t = dateThread({ ...trip, all_day: true }, TZ, 'X', null, 'confirmed', [
        { depart_at: '2026-07-18T08:00:00Z', arrive_at: '2026-07-18T09:00:00Z' },
      ]);
      expect(t?.spans).toEqual([{ from: 8, to: 9 }]);
    });

    it('only a trip reads stages', () => {
      const t = dateThread(dateRow(), TZ, 'X', null, 'confirmed', [
        { depart_at: '2026-07-18T08:00:00Z', arrive_at: '2026-07-18T09:00:00Z' },
      ])!;
      expect(t.spans).not.toEqual([{ from: 8, to: 9 }]);
    });
  });
});

describe('stripWindow — the track is the DAY’s extent, not a fixed 00→24', () => {
  it('an evening day does not spend three quarters of its width on nothing', () => {
    const t = performanceThread(
      gig({ load_in_at: '2026-07-18T18:00:00Z', start_at: '2026-07-18T21:00:00Z' }),
      TZ, 'X', null, 'confirmed',
    )!;
    const w = stripWindow([t]);
    expect(w.from).toBe(17);
    expect(w.to).toBe(22);
  });

  it('never narrower than four hours — below that proportion stops meaning anything', () => {
    const t = dateThread(dateRow({ starts_at: '2026-07-18T10:00:00Z' }), TZ, 'X', null, 'confirmed')!;
    const w = stripWindow([t]);
    expect(w.to - w.from).toBeGreaterThanOrEqual(4);
  });

  it('and the four hours grow around the day, not away from it', () => {
    // One meeting, 12h–13h30. The minimum used to be paid entirely by `to`
    // (11h→15h): the day against the left wall with an hour and a half of
    // dead air behind it. Centred, the same four hours hold it in the middle.
    const t = dateThread(
      dateRow({ starts_at: '2026-07-18T12:00:00Z', ends_at: '2026-07-18T13:30:00Z' }),
      TZ, 'X', null, 'confirmed',
    )!;
    const w = stripWindow([t]);
    expect(w.to - w.from).toBe(4);
    expect((w.from + w.to) / 2).toBe(12.75); // the meeting's own middle
    expect(w.from).toBeLessThanOrEqual(12 - 0.5); // still clears the margin…
    expect(w.to).toBeGreaterThanOrEqual(13.5 + 0.5); // …on both sides
  });

  it('a short day at the wall keeps its four hours inside the clock', () => {
    const early = dateThread(dateRow({ starts_at: '2026-07-18T00:30:00Z' }), TZ, 'X', null, 'confirmed')!;
    expect(stripWindow([early])).toEqual({ from: 0, to: 4 });
    const late = dateThread(dateRow({ starts_at: '2026-07-18T23:30:00Z' }), TZ, 'X', null, 'confirmed')!;
    expect(stripWindow([late])).toEqual({ from: 20, to: 24 });
  });

  it('an empty day still has a window, so the ruler can draw', () => {
    expect(stripWindow([])).toEqual({ from: 9, to: 24 });
  });

  it('a night that runs long stretches the track past midnight', () => {
    const t = performanceThread(
      gig({
        load_in_at: '2026-07-18T15:00:00Z',
        start_at: '2026-07-18T20:30:00Z',
        loadout_at: '2026-07-18T23:30:00Z',
      }),
      'Europe/Madrid', 'X', null, 'confirmed',
    )!;
    // 17h load-in, 22h30 show, 01h30 load-out — which is 25h30 on this axis.
    expect(t.a).toBe(17);
    expect(t.b).toBe(25.5);
    const w = stripWindow([t]);
    expect(w.from).toBe(16);
    expect(w.to).toBe(26);
  });
});

describe('a thread that crosses midnight', () => {
  it('a gig’s load-out never lands before its own load-in', () => {
    const t = performanceThread(
      gig({ load_in_at: '2026-07-18T15:00:00Z', loadout_at: '2026-07-18T23:30:00Z' }),
      'Europe/Madrid', 'X', null, 'confirmed',
    )!;
    const at = t.marks.map((m) => m.at);
    expect(at).toEqual([...at].sort((x, y) => x - y)); // the running order IS the order
    expect(at).toEqual([17, 25.5]);
  });

  it('a date that ends after midnight keeps its span instead of collapsing', () => {
    const t = dateThread(
      dateRow({ starts_at: '2026-07-18T21:00:00Z', ends_at: '2026-07-19T00:00:00Z' }),
      'Europe/Madrid', 'X', null, 'confirmed',
    )!;
    expect(t.spans).toEqual([{ from: 23, to: 26 }]); // 23h → 02h, not an instant
    expect(t.marks).toEqual([]);
  });
});

describe('pct', () => {
  it('maps the window onto 0–100 and clamps outside it', () => {
    const w = { from: 10, to: 20 };
    expect(pct(10, w)).toBe(0);
    expect(pct(20, w)).toBe(100);
    expect(pct(15, w)).toBe(50);
    expect(pct(2, w)).toBe(0);
    expect(pct(23, w)).toBe(100);
  });
});

describe('overlaps — where two threads are live at once', () => {
  it('finds the stretch two threads share', () => {
    const a = dateThread(
      dateRow({ id: 'a', starts_at: '2026-07-18T10:00:00Z', ends_at: '2026-07-18T14:00:00Z' }),
      TZ, 'A', null, 'confirmed',
    )!;
    const b = dateThread(
      dateRow({ id: 'b', starts_at: '2026-07-18T12:00:00Z', ends_at: '2026-07-18T16:00:00Z' }),
      TZ, 'B', null, 'confirmed',
    )!;
    const win = { from: 9, to: 17 };
    const ov = overlaps([a, b], win);
    expect(ov).toHaveLength(1);
    expect(ov[0].from).toBeCloseTo(12, 1);
    expect(ov[0].to).toBeCloseTo(14, 1);
  });

  it('two threads that never meet produce nothing', () => {
    const a = dateThread(
      dateRow({ id: 'a', starts_at: '2026-07-18T10:00:00Z', ends_at: '2026-07-18T11:00:00Z' }),
      TZ, 'A', null, 'confirmed',
    )!;
    const b = dateThread(
      dateRow({ id: 'b', starts_at: '2026-07-18T15:00:00Z', ends_at: '2026-07-18T16:00:00Z' }),
      TZ, 'B', null, 'confirmed',
    )!;
    expect(overlaps([a, b], { from: 9, to: 17 })).toEqual([]);
  });
});

describe('the running order on the strip (ADR-090 P3)', () => {
  const m = (kind: string | null, label: string | null, at: string) => ({ kind, label, at, ends_at: null });

  it('a free moment is a tick: drawn, flagged free, out of the steps an audit counts', () => {
    const t = performanceThread(
      gig({
        schedule: [
          m('load_in', null, '2026-07-18T10:00:00Z'),
          m(null, 'photo call', '2026-07-18T17:00:00Z'),
          m('start', null, '2026-07-18T20:00:00Z'),
        ],
      }),
      TZ,
      'n',
      null,
      'confirmed',
    )!;
    expect(t.marks.map((x) => [x.at, x.step, !!x.free])).toEqual([
      [10, 'load_in', false],
      [17, 'moment', true],
      [20, 'start', false],
    ]);
    expect(t.marks[1].label).toBe('photo call');
    expect(t.steps).toEqual(['load_in', 'start']);
  });

  it('the strip is a time axis: a hand-made order is drawn by its hours', () => {
    const t = performanceThread(
      gig({
        schedule: [m('start', null, '2026-07-18T20:00:00Z'), m('load_in', null, '2026-07-18T10:00:00Z')],
      }),
      TZ,
      'n',
      null,
      'confirmed',
    )!;
    expect(t.marks.map((x) => x.at)).toEqual([10, 20]);
  });

  it('the night still runs long, measured by instant', () => {
    const t = performanceThread(
      gig({
        schedule: [m('start', null, '2026-07-18T22:00:00Z'), m(null, 'party', '2026-07-19T01:30:00Z')],
      }),
      TZ,
      'n',
      null,
      'confirmed',
    )!;
    expect(t.marks.map((x) => x.at)).toEqual([22, 25.5]);
  });

  it('a rehearsal with a running order draws its moments on its span', () => {
    const t = dateThread(
      dateRow({
        starts_at: '2026-07-18T10:00:00Z',
        ends_at: '2026-07-18T14:00:00Z',
        schedule: [m(null, 'warm-up', '2026-07-18T10:00:00Z'), m(null, 'pass', '2026-07-18T11:15:00Z')],
      }),
      TZ,
      'n',
      null,
      'confirmed',
    )!;
    expect(t.spans).toEqual([{ from: 10, to: 14 }]);
    expect(t.marks.map((x) => x.at)).toEqual([10, 11.25]);
  });

  it('an all-day rehearsal is placed by its running order, and not without one', () => {
    expect(dateThread(dateRow({ all_day: true }), TZ, 'n', null, 'c')).toBeNull();
    const t = dateThread(
      dateRow({
        all_day: true,
        schedule: [m(null, 'a', '2026-07-18T09:00:00Z'), m(null, 'b', '2026-07-18T13:00:00Z')],
      }),
      TZ,
      'n',
      null,
      'c',
    )!;
    expect(t.spans).toEqual([{ from: 9, to: 13 }]);
  });
});
