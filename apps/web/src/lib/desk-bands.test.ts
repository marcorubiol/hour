import { describe, expect, it } from 'vitest';
import { changesSince, elapsedSince, goingAsks, plannerDoor, sinceInstant, CHANGED_ROWS } from './desk-bands';
import { buildPersonAttribution, type TeamItem } from './people';
import type { DateEvent, PerformanceEvent } from './month-events';
import type { HotRow, LastMailout } from './conversation-overview';
import type { FeedThread } from './threads';

const NOW = new Date('2026-10-15T10:00:00Z');
const TODAY = '2026-10-15';
const project = { id: 'p1', slug: 'mamemi', name: 'MaMeMi', workspace_id: 'w1' };

function perf(id: string, day: string, o: Partial<PerformanceEvent> = {}): PerformanceEvent {
  return {
    id,
    slug: id,
    performed_at: day,
    status: 'confirmed',
    start_at: `${day}T18:00:00Z`,
    venue_name: 'Kursaal',
    city: 'Manresa',
    country: 'ES',
    line_id: null,
    project,
    venue: null,
    ...o,
  };
}
function date(id: string, day: string, o: Partial<DateEvent> = {}): DateEvent {
  return {
    id,
    kind: 'rehearsal',
    status: 'confirmed',
    title: null,
    starts_at: `${day}T00:00:00Z`,
    all_day: true,
    venue_name: null,
    city: null,
    project,
    venue: null,
    ...o,
  };
}

describe('goingAsks — the «voy · no voy» Hour has for you', () => {
  const team = [{ person_id: 'me', project_ids: ['p1'] }] as unknown as TeamItem[];
  const axis = buildPersonAttribution({ pinnedPersonIds: ['me'], team, blocks: [] });

  it('asks only where you are in by inference, in the next N days', () => {
    const asks = goingAsks(
      {
        performances: [
          perf('inferred', '2026-10-17'),
          perf('rostered', '2026-10-18', { person_ids: ['me'] }),
          perf('answered', '2026-10-19', { commitments: [{ person_id: 'me', state: 'going' }] as never }),
          perf('far', '2026-11-30'),
          perf('cancelled', '2026-10-20', { status: 'cancelled' }),
        ],
        dates: [date('rehearsal', '2026-10-16')],
        axis,
        viewerTz: 'Europe/Madrid',
      },
      TODAY,
      14,
    );
    expect(asks.map((a) => a.id)).toEqual(['rehearsal', 'inferred']);
  });

  it('a login with no person asks nothing; an excluded row is not asked twice', () => {
    const none = buildPersonAttribution({ pinnedPersonIds: [], team, blocks: [] });
    const input = { performances: [perf('a', '2026-10-17')], dates: [], axis: none, viewerTz: 'UTC' };
    expect(goingAsks(input, TODAY, 14)).toEqual([]);
    expect(goingAsks({ ...input, axis }, TODAY, 14, new Set(['a']))).toEqual([]);
  });
});

describe('changesSince — «Ha cambiado»', () => {
  const since = '2026-10-14T18:00:00Z';
  const thread = (id: string, at: string, unread: number) =>
    ({ thread_id: id, last_message_at: at, unread_count: unread }) as unknown as FeedThread;
  const hot = (id: string, at: string, turn: 'ours' | 'theirs') =>
    ({ id, at, turn, title: id, workspace_id: 'w1' }) as unknown as HotRow;

  it('threads with new messages after the visit, rooms whose last word is theirs, newest first', () => {
    const out = changesSince(
      {
        threads: [thread('new', '2026-10-15T08:00:00Z', 2), thread('read', '2026-10-15T09:00:00Z', 0), thread('old', '2026-10-13T08:00:00Z', 4)],
        hot: [hot('replied', '2026-10-15T09:30:00Z', 'ours'), hot('waiting', '2026-10-15T09:40:00Z', 'theirs'), hot('before', '2026-10-14T10:00:00Z', 'ours')],
        lastMailout: null,
      },
      since,
      NOW,
    );
    expect(out.map((c) => c.kind + ':' + (c.kind === 'thread' ? c.thread.thread_id : c.kind === 'reply' ? c.row.id : ''))).toEqual([
      'reply:replied',
      'thread:new',
    ]);
  });

  it('a reply «Te espera» already holds is not news twice', () => {
    const out = changesSince(
      { threads: [], hot: [hot('waiting', '2026-10-15T09:30:00Z', 'ours'), hot('other', '2026-10-15T09:40:00Z', 'ours')], lastMailout: null },
      since,
      NOW,
      new Set(['waiting']),
    );
    expect(out.map((c) => (c.kind === 'reply' ? c.row.id : c.kind))).toEqual(['other']);
  });

  it('the last send is news for two weeks, whatever the visit', () => {
    const m = (queued: string) => ({ id: 'm', queued_at: queued }) as unknown as LastMailout;
    expect(changesSince({ threads: [], hot: [], lastMailout: m('2026-10-05T10:00:00Z') }, since, NOW)).toHaveLength(1);
    expect(changesSince({ threads: [], hot: [], lastMailout: m('2026-09-20T10:00:00Z') }, since, NOW)).toHaveLength(0);
  });

  it('at most five lines', () => {
    const threads = Array.from({ length: 8 }, (_, i) => thread(`t${i}`, `2026-10-15T0${i}:00:00Z`, 1));
    expect(changesSince({ threads, hot: [], lastMailout: null }, since, NOW)).toHaveLength(CHANGED_ROWS);
  });

  it('the last visit reads in minutes, then hours, then days', () => {
    const at = (ms: number) => new Date(NOW.getTime() - ms).toISOString();
    expect(elapsedSince(at(20_000), NOW)).toEqual({ unit: 'min', n: 1 });
    expect(elapsedSince(at(42 * 60_000), NOW)).toEqual({ unit: 'min', n: 42 });
    expect(elapsedSince(at(3 * 3_600_000 + 5 * 60_000), NOW)).toEqual({ unit: 'h', n: 3 });
    expect(elapsedSince(at(50 * 3_600_000), NOW)).toEqual({ unit: 'd', n: 2 });
  });

  it('with no visit on file, since is a week back', () => {
    expect(sinceInstant(null, NOW)).toBe('2026-10-08T10:00:00.000Z');
    expect(sinceInstant('garbage', NOW)).toBe('2026-10-08T10:00:00.000Z');
    expect(sinceInstant(since, NOW)).toBe('2026-10-14T18:00:00.000Z');
  });
});

describe('plannerDoor — the Planner census, its window', () => {
  it('counts confirmed and holds by status family, and travel days, inside the window', () => {
    const fig = plannerDoor(
      {
        performances: [
          perf('a', '2026-10-17'),
          perf('b', '2026-10-20', { status: 'hold_1' }),
          perf('c', '2026-10-21', { status: 'cancelled' }),
          perf('d', '2027-03-01'),
        ],
        dates: [date('t', '2026-10-16', { kind: 'travel_day' }), date('r', '2026-10-16')],
        viewerTz: 'UTC',
      },
      { from: TODAY, to: '2027-01-03' },
    );
    expect(fig).toEqual({ confirmed: 1, holds: 1, travel: 1 });
  });
});
