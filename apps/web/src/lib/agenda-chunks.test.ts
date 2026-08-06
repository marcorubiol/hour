import { describe, expect, it } from 'vitest';
import {
  agendaChunks,
  emptyTailMonths,
  type AgendaChunk,
  type AgendaDayStats,
} from './agenda-chunks';

/** Every ISO day from `from` to `to`, inclusive. */
function span(from: string, to: string): string[] {
  const out: string[] = [];
  let t = Date.parse(`${from}T00:00:00Z`);
  const end = Date.parse(`${to}T00:00:00Z`);
  while (t <= end) {
    out.push(new Date(t).toISOString().slice(0, 10));
    t += 86400000;
  }
  return out;
}

const QUIET: AgendaDayStats = { free: true, marked: false, firm: 0, held: 0 };

function statsFrom(over: Record<string, Partial<AgendaDayStats>>) {
  return (day: string): AgendaDayStats => ({ ...QUIET, ...over[day] });
}

function months(chunks: AgendaChunk[]): string[] {
  return chunks.filter((c) => c.t === 'month').map((c) => (c.t === 'month' ? c.mk : ''));
}

describe('agendaChunks', () => {
  // The bug seen on screen 2026-08-03: week 18 of 2026 (27 apr → 3 may) is
  // fully free, and the old day-walk collapsed it whole — consuming 1 May
  // inside it, so May lost its divider and hung its weeks under April.
  it('a free week straddling a month turn cannot swallow the next divider', () => {
    const chunks = agendaChunks({
      days: span('2026-04-01', '2026-05-31'),
      todayIso: '2026-03-01',
      dayStats: statsFrom({
        '2026-04-10': { free: false, firm: 1 },
        '2026-05-20': { free: false, firm: 1 },
      }),
    });
    expect(months(chunks)).toEqual(['2026-04', '2026-05']);
    // The straddler prints once per month it touches, split at the turn.
    const segs = chunks.filter((c) => c.t === 'week' && c.n === 18);
    expect(segs).toHaveLength(2);
    expect(segs[0]).toMatchObject({ from: '2026-04-27', to: '2026-04-30', free: 4 });
    expect(segs[1]).toMatchObject({ from: '2026-05-01', to: '2026-05-03', free: 3 });
  });

  it('an empty month arrives collapsed: one chunk, no weeks, no days', () => {
    const chunks = agendaChunks({
      days: span('2026-06-01', '2026-06-30'),
      todayIso: '2026-03-01',
      dayStats: () => QUIET,
    });
    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toMatchObject({ t: 'month', mk: '2026-06', collapsed: true, free: 30 });
  });

  it("today's month and week never auto-collapse — and the open week prints all 7 days", () => {
    const chunks = agendaChunks({
      days: span('2026-06-01', '2026-06-30'),
      todayIso: '2026-06-10',
      dayStats: () => QUIET,
    });
    expect(chunks[0]).toMatchObject({ t: 'month', collapsed: false });
    const weeks = chunks.filter((c) => c.t === 'week');
    const open = weeks.filter((c) => c.t === 'week' && c.open);
    expect(open).toHaveLength(1);
    expect(open[0]).toMatchObject({ from: '2026-06-08', to: '2026-06-14' });
    const days = chunks.filter((c) => c.t === 'day').map((c) => (c.t === 'day' ? c.day : ''));
    expect(days).toEqual(span('2026-06-08', '2026-06-14'));
  });

  it('opening an empty month unfolds its weeks and days — not a second row of doors', () => {
    const base = {
      days: span('2026-06-01', '2026-06-30'),
      todayIso: '2026-03-01',
      dayStats: () => QUIET,
    };
    const opened = agendaChunks({ ...base, monthOverride: new Map([['2026-06', true]]) });
    expect(opened.filter((c) => c.t === 'week').every((c) => c.t === 'week' && c.open)).toBe(true);
    expect(opened.filter((c) => c.t === 'day')).toHaveLength(30);

    // …and one week can still be shut by hand inside it.
    const oneShut = agendaChunks({
      ...base,
      monthOverride: new Map([['2026-06', true]]),
      weekOverride: new Map([['w2026-06-01', false]]),
    });
    const days = oneShut.filter((c) => c.t === 'day').map((c) => (c.t === 'day' ? c.day : ''));
    expect(days).toEqual(span('2026-06-08', '2026-06-30'));
  });

  it('an open week prints its empty days too — the run line is dead', () => {
    const chunks = agendaChunks({
      days: span('2026-04-06', '2026-04-12'),
      todayIso: '2026-03-01',
      dayStats: statsFrom({ '2026-04-10': { free: false, firm: 1 } }),
    });
    const days = chunks.filter((c) => c.t === 'day');
    expect(days).toHaveLength(7);
  });

  it('a busy month can be shut by hand and keeps honest counts', () => {
    const chunks = agendaChunks({
      days: span('2026-04-01', '2026-04-30'),
      todayIso: '2026-03-01',
      dayStats: statsFrom({
        '2026-04-10': { free: false, firm: 1 },
        '2026-04-11': { free: false, held: 2 },
      }),
      monthOverride: new Map([['2026-04', false]]),
    });
    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toMatchObject({ t: 'month', collapsed: true, firm: 1, held: 2, free: 28 });
  });

  it('emptyTailMonths counts the quiet tail — and today keeps its month alive', () => {
    const stats = statsFrom({ '2026-04-10': { free: false, firm: 1 } });
    // April full, May and June quiet → a 2-month tail.
    expect(emptyTailMonths(span('2026-04-01', '2026-06-30'), '2026-03-01', stats)).toBe(2);
    // Today living in the last quiet month stops the count cold.
    expect(emptyTailMonths(span('2026-04-01', '2026-06-30'), '2026-06-10', stats)).toBe(0);
    // A marked day (a note) is content for this purpose too.
    expect(
      emptyTailMonths(
        span('2026-04-01', '2026-06-30'),
        '2026-03-01',
        statsFrom({ '2026-05-20': { marked: true } }),
      ),
    ).toBe(1);
  });

  it('a marked day (a note) blocks collapse but still counts as a free night', () => {
    const chunks = agendaChunks({
      days: span('2026-06-01', '2026-06-30'),
      todayIso: '2026-03-01',
      dayStats: statsFrom({ '2026-06-05': { marked: true } }),
    });
    expect(chunks[0]).toMatchObject({ t: 'month', collapsed: false, free: 30 });
    const noted = chunks.find((c) => c.t === 'week' && c.from <= '2026-06-05' && c.to >= '2026-06-05');
    expect(noted).toMatchObject({ open: true });
  });
});
