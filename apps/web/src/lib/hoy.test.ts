import { describe, expect, it } from 'vitest';
import {
  COMING_TILES,
  COMING_TILES_PHONE,
  comingTiles,
  nextAfterToday,
  nextWhen,
  outsideToday,
  pulseRowInScope,
  rowsSayCity,
  scopePulseInput,
  waitingPills,
  waitingRowCount,
} from './hoy';
import { resolveScope, type NavLine, type NavProject, type NavWorkspace } from './nav';
import { upcoming } from './pulse';
import type { DateEvent, PerformanceEvent } from './month-events';
import type { DeskItem } from './desk-feed';

const TZ = 'Europe/Madrid';
const NOW = new Date('2026-11-13T12:50:00Z'); // Friday 13, 13h50 in Madrid
const TODAY = '2026-11-13';

const mamemi = { id: 'p-mmi', slug: 'mamemi', name: 'MaMeMi', workspace_id: 'ws-muk' };
const avi = { id: 'p-avi', slug: 'avi', name: 'Avi', workspace_id: 'ws-avi' };

function perf(id: string, day: string, project = mamemi, o: Partial<PerformanceEvent> = {}): PerformanceEvent {
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
    venue: { name: 'Kursaal', city: 'Manresa', timezone: TZ },
    ...o,
  };
}
function date(id: string, startsAt: string, project = avi, o: Partial<DateEvent> = {}): DateEvent {
  return {
    id,
    kind: 'rehearsal',
    status: 'confirmed',
    title: null,
    starts_at: startsAt,
    ends_at: null,
    all_day: false,
    venue_name: 'Sala 2',
    city: null,
    project,
    venue: null,
    ...o,
  };
}

const workspaces = [
  { id: 'ws-muk', slug: 'muk-cia', name: 'MüK Cia' },
  { id: 'ws-avi', slug: 'avi', name: 'Avi' },
] as unknown as NavWorkspace[];
const projects = [
  { id: 'p-mmi', slug: 'mamemi', name: 'MaMeMi', workspaceId: 'ws-muk' },
  { id: 'p-avi', slug: 'avi', name: 'Avi', workspaceId: 'ws-avi' },
] as unknown as NavProject[];
const scopedTo = (pins: string[]) => resolveScope(pins, workspaces, [] as NavLine[], projects);
const everything = scopedTo([]);
const onMamemi = scopedTo(['p:p-mmi']);

describe('the scope narrows the pulse (ADR-202 § 13, tarea 145)', () => {
  const rows = { performances: [perf('show', '2026-11-19')], dates: [date('reh', '2026-11-13T09:00:00Z')], viewerTz: TZ };

  it('unscoped, every row stays, the same object', () => {
    expect(scopePulseInput(rows, everything)).toBe(rows);
  });

  it('scoped to a project, only its rows stay', () => {
    const scoped = scopePulseInput(rows, onMamemi);
    expect(scoped.performances.map((p) => p.id)).toEqual(['show']);
    expect(scoped.dates).toEqual([]);
    expect(pulseRowInScope(onMamemi, rows.dates[0])).toBe(false);
  });

  it('a space pin keeps the rows of its projects', () => {
    expect(scopePulseInput(rows, scopedTo(['s:avi'])).dates.map((d) => d.id)).toEqual(['reh']);
  });
});

describe('«1 más hoy fuera de…» (ADR-202 § 14, ADR-203 § 8)', () => {
  const rows = {
    performances: [perf('press', TODAY, mamemi, { start_at: `${TODAY}T15:00:00Z` })],
    dates: [date('reh', `${TODAY}T09:00:00Z`), date('later', '2026-11-20T09:00:00Z')],
    viewerTz: TZ,
  };

  it('counts today\'s rows the scope leaves out, the gone-by included, never another day\'s', () => {
    expect(outsideToday(rows, onMamemi, TODAY)).toBe(1);
  });

  it('unscoped, nothing is outside', () => {
    expect(outsideToday(rows, everything, TODAY)).toBe(0);
  });
});

describe('«Coming up»: one tile per day (ADR-202 § 6)', () => {
  it('groups by day after today, two a tile and «+N», within two weeks', () => {
    const rows = {
      performances: [
        perf('a', '2026-11-14', mamemi, { start_at: '2026-11-14T19:30:00Z' }),
        perf('b', '2026-11-19'),
        perf('far', '2026-12-12'),
      ],
      dates: [
        date('t1', '2026-11-14T08:12:00Z'),
        date('t2', '2026-11-14T10:00:00Z'),
        date('today', `${TODAY}T15:00:00Z`),
      ],
      viewerTz: TZ,
    };
    const tiles = comingTiles(upcoming(rows, NOW, 40), TODAY);
    expect(tiles.map((t) => t.day)).toEqual(['2026-11-14', '2026-11-19']);
    expect(tiles[0].items.map((x) => x.ref.id)).toEqual(['t1', 't2']);
    expect(tiles[0].more).toBe(1);
  });

  it('ten tiles at most', () => {
    const performances = Array.from({ length: 13 }, (_, i) => perf(`p${i}`, `2026-11-${String(14 + i).padStart(2, '0')}`));
    const tiles = comingTiles(upcoming({ performances, dates: [], viewerTz: TZ }, NOW, 40), TODAY);
    expect(tiles).toHaveLength(COMING_TILES);
  });

  it('four on a phone (ADR-205): the first four days with something, in order, each whole', () => {
    const performances = Array.from({ length: 6 }, (_, i) => perf(`p${i}`, `2026-11-${String(14 + i * 2).padStart(2, '0')}`));
    const dates = [date('d1', '2026-11-14T08:00:00Z'), date('d2', '2026-11-14T09:00:00Z')];
    const coming = upcoming({ performances, dates, viewerTz: TZ }, NOW, 40);
    const tiles = comingTiles(coming, TODAY, COMING_TILES_PHONE);
    expect(COMING_TILES_PHONE).toBe(4);
    expect(tiles.map((t) => t.day)).toEqual(['2026-11-14', '2026-11-16', '2026-11-18', '2026-11-20']);
    // The cut drops whole days, not things inside a tile: its «+N» stays.
    expect(tiles[0].more).toBe(1);
    // What is cut is still there for the desktop column and the Planner door.
    expect(comingTiles(coming, TODAY).map((t) => t.day)).toHaveLength(6);
  });

  it('with four days or fewer, the phone draws them all', () => {
    const performances = [perf('a', '2026-11-15'), perf('b', '2026-11-20')];
    const tiles = comingTiles(upcoming({ performances, dates: [], viewerTz: TZ }, NOW, 40), TODAY, COMING_TILES_PHONE);
    expect(tiles.map((t) => t.day)).toEqual(['2026-11-15', '2026-11-20']);
  });

  it('the hollow piece names the first thing after today, however far', () => {
    const coming = upcoming({ performances: [perf('far', '2026-12-12')], dates: [], viewerTz: TZ }, NOW, 40);
    expect(comingTiles(coming, TODAY)).toEqual([]);
    expect(nextAfterToday(coming, TODAY)?.ref.id).toBe('far');
  });

  it('the hollow piece says the year of a next thing that is not near, in the four languages', () => {
    const today = '2026-11-14';
    expect(nextWhen('2026-11-15', today, 'es')).toBe('mañana');
    expect(nextWhen('2026-11-26', today, 'en')).toBe('Thu 26 Nov');
    expect(nextWhen('2031-01-15', today, 'es')).toBe('mié 15 ene 2031');
    expect(nextWhen('2031-01-15', today, 'ca')).toBe('dc 15 gen 2031');
    expect(nextWhen('2031-01-15', today, 'en')).toBe('Wed 15 Jan 2031');
    expect(nextWhen('2031-01-15', today, 'fr')).toBe('mer 15 janv 2031');
  });
});

describe('«Te espera»: pills and rows (ADR-202 § 7, ADR-203 § 5 and § 9)', () => {
  const item = (concern: DeskItem['concern'], verbKey: string | null = null) => ({ concern, verbKey });

  it('one pill per kind with its figure, in a fixed order', () => {
    expect(
      waitingPills([item('task'), item('conversation', 'reply'), item('conversation', 'chase'), item('task'), item('money')]),
    ).toEqual([
      { kind: 'calls', n: 1 },
      { kind: 'replies', n: 1 },
      { kind: 'tasks', n: 2 },
      { kind: 'money', n: 1 },
    ]);
  });

  it('three rows a normal day, five a day with nothing, none on a gig day or in calm', () => {
    expect(waitingRowCount({ calm: false, gig: false, empty: false })).toBe(3);
    expect(waitingRowCount({ calm: false, gig: false, empty: true })).toBe(5);
    expect(waitingRowCount({ calm: false, gig: true, empty: false })).toBe(0);
    expect(waitingRowCount({ calm: true, gig: false, empty: true })).toBe(0);
  });
});

describe('the day\'s rows say their city only across cities', () => {
  it('one city, the rows keep quiet: the piece already says it', () => {
    expect(rowsSayCity(['Girona', 'Girona', null, 'girona '])).toBe(false);
  });
  it('more than one city, every row says it', () => {
    expect(rowsSayCity(['Barcelona', 'Girona'])).toBe(true);
  });
  it('rows without a city do not count', () => {
    expect(rowsSayCity([null, undefined, '', 'Girona'])).toBe(false);
    expect(rowsSayCity([])).toBe(false);
  });
});
