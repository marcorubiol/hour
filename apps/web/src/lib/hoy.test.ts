import { addManualThing, readPreparation } from './preparation';
import { describe, expect, it } from 'vitest';
import {
  yourStop,
  COMING_TILES,
  COMING_TILES_PHONE,
  comingOpen,
  comingTiles,
  nextAfterToday,
  nextWhen,
  outsideToday,
  piecePerformance,
  pulseRowInScope,
  rowsSayCity,
  scopePulseInput,
  showsDay,
  waitingDrawsPills,
  waitingPills,
  waitingRowCount,
} from './hoy';
import { resolveScope, type NavLine, type NavProject, type NavWorkspace } from './nav';
import { upcoming } from './pulse';
import { dayAgenda } from './day-agenda';
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

  it('the dot: some performance of the day still needs something, by the record\'s rule (ADR-211 § 3)', () => {
    const performances = [
      perf('ok', '2026-11-14', mamemi, { person_ids: ['p'], has_bolo: true }),
      perf('nobolo', '2026-11-15', mamemi, { has_bolo: false }),
      perf('nohour', '2026-11-16', mamemi, { start_at: null }),
      perf('hold', '2026-11-17', mamemi, { status: 'hold', start_at: null, hold_notice_days: 0 }),
    ];
    const dates = [date('trip', '2026-11-18T08:00:00Z', avi, { kind: 'travel_day' })];
    const tiles = comingTiles(upcoming({ performances, dates, viewerTz: TZ }, NOW, 40), TODAY);
    expect(tiles.map((t) => [t.day, t.missing, t.open])).toEqual([
      ['2026-11-14', false, 0],
      ['2026-11-15', true, 1],
      ['2026-11-16', true, 1],
      ['2026-11-17', false, 0],
      ['2026-11-18', false, 0],
    ]);
    // Open is neutral: none of these has hurry (hold deadline, unshared sheet).
    expect(tiles.every((t) => t.urgent === null)).toBe(true);
  });

  it('the tile follows its project\'s preparation list (ADR-221): what is off does not count', () => {
    const performances = [perf('nohour', '2026-11-16', mamemi, { start_at: null })];
    const coming = upcoming({ performances, dates: [], viewerTz: TZ }, NOW, 40);
    const off = readPreparation({ items: [{ id: 'hours', on: false }] });
    expect(comingTiles(coming, TODAY).map((t) => t.open)).toEqual([1]);
    expect(comingTiles(coming, TODAY, 10, () => off).map((t) => [t.missing, t.open])).toEqual([[false, 0]]);
  });

  it('the project\'s own open things count in the tile (ADR-221, fase 3), and a closed one does not', () => {
    const list = addManualThing(readPreparation(null), 'Rider', 'm_rider001');
    const performances = [
      perf('open', '2026-11-16', mamemi, { prep: null }),
      perf('done', '2026-11-17', mamemi, { prep: { m_rider001: { estado: 'hecho' } } }),
    ];
    const coming = upcoming({ performances, dates: [], viewerTz: TZ }, NOW, 40);
    expect(comingTiles(coming, TODAY, 10, () => list).map((t) => [t.day, t.open])).toEqual([
      ['2026-11-16', 1],
      ['2026-11-17', 0],
    ]);
  });

  it('the tile is amber only for a thing inside its days, and says which and when (ADR-221, fase 4)', () => {
    const performances = [perf('nohour', '2026-11-16', mamemi, { start_at: null })];
    const coming = upcoming({ performances, dates: [], viewerTz: TZ }, NOW, 40);
    const never = comingTiles(coming, TODAY, 10, () => readPreparation(null));
    expect(never[0].urgent).toBeNull();
    const hurry = comingTiles(coming, TODAY, 10, () => readPreparation({ items: [{ id: 'hours', on: true, days: 10 }] }));
    expect(hurry[0].urgent).toMatchObject({ what: 'hours', day: '2026-11-16' });
    expect(hurry[0].urgent?.item?.ref.id).toBe('nohour');
  });

  it('one amber a screen (ADR-227): only what falls due first; the rest, a grey figure of performances', () => {
    const list = readPreparation({ items: [{ id: 'hours', on: true, days: 10 }] });
    const performances = [
      perf('a', '2026-11-16', mamemi, { start_at: null }),
      perf('b', '2026-11-15', mamemi, { start_at: null }),
      perf('c', '2026-11-26', mamemi, { start_at: null }),
      perf('ok', '2026-11-17', mamemi, { person_ids: ['p'], has_bolo: true }),
    ];
    const coming = upcoming({ performances, dates: [], viewerTz: TZ }, NOW, 40);
    const tiles = comingTiles(coming, TODAY, Infinity, () => list);
    expect(tiles.map((t) => [t.day, t.openShows])).toEqual([
      ['2026-11-15', 1],
      ['2026-11-16', 1],
      ['2026-11-17', 0],
      ['2026-11-26', 1],
    ]);
    const open = comingOpen(tiles);
    expect(open.urgentDay).toBe('2026-11-15');
    expect(open.urgent?.item?.ref.id).toBe('b');
    expect(open.rest).toBe(2);
    // Nothing with hurry: no amber, and the figure counts them all.
    const calm = comingOpen(comingTiles(coming, TODAY, Infinity, () => readPreparation(null)));
    expect(calm).toEqual({ urgent: null, urgentDay: null, rest: 3 });
    expect(comingOpen([])).toEqual({ urgent: null, urgentDay: null, rest: 0 });
  });

  it('«Te espera» without pills when three things or fewer are all rows (ADR-229)', () => {
    expect(waitingDrawsPills(2, 3)).toBe(false);
    expect(waitingDrawsPills(3, 3)).toBe(false);
    expect(waitingDrawsPills(3, 5)).toBe(false);
    expect(waitingDrawsPills(4, 5)).toBe(true);
    // Rows folded (calm, a gig day): the pills are the only count.
    expect(waitingDrawsPills(2, 0)).toBe(true);
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

describe('two or more performances today: none weighs more (ADR-207)', () => {
  const at = (h: string) => `${TODAY}T${h}:00:00Z`;
  const day = (performances: PerformanceEvent[], now: string, dates: DateEvent[] = []) =>
    dayAgenda({ performances, dates, viewerTz: TZ }, TODAY, new Date(now));
  const noon = perf('noon', TODAY, mamemi, { start_at: at('11') });
  const night = perf('night', TODAY, mamemi, { start_at: at('20') });

  it('one performance, the focus speaks; a rehearsal beside it does not count', () => {
    expect(showsDay(day([night], at('09'), [date('reh', at('10'))]))).toBeNull();
  });

  it('two of one project: their hours, the first ahead, nothing begun', () => {
    const s = showsDay(day([night, noon], at('09')))!;
    expect(s.shows.map((p) => p.ref.id)).toEqual(['noon', 'night']);
    expect(s.oneProject).toBe(true);
    expect(s.hours.map((p) => p.ref.id)).toEqual(['noon', 'night']);
    expect([s.on, s.ahead?.ref.id, s.begun]).toEqual([null, 'noon', false]);
  });

  it('two projects: not one project', () => {
    expect(showsDay(day([noon, perf('other', TODAY, avi, { start_at: at('20') })], at('09')))!.oneProject).toBe(false);
  });

  it('three or more: the first and the last hour', () => {
    const s = showsDay(day([noon, night, perf('mid', TODAY, mamemi, { start_at: at('16') })], at('09')))!;
    expect(s.shows).toHaveLength(3);
    expect(s.hours.map((p) => p.ref.id)).toEqual(['noon', 'night']);
  });

  it('while one is on: it is the one on, it has begun, and the actions follow it', () => {
    const a = day([noon, night], at('12'));
    const s = showsDay(a)!;
    expect([s.on?.ref.id, s.begun]).toEqual(['noon', true]);
    expect(piecePerformance(a)?.ref.id).toBe('noon');
  });

  it('during its load-in a performance is not on: the first is still ahead', () => {
    const loadIn = (id: string, h: string, start: string) =>
      perf(id, TODAY, mamemi, {
        start_at: at(start),
        schedule: [
          { kind: 'load_in', label: null, at: at(h), ends_at: null },
          { kind: 'start', label: null, at: at(start), ends_at: null },
        ],
      });
    const s = showsDay(day([loadIn('noon', '09', '11'), night], at('10')))!;
    expect([s.on, s.ahead?.ref.id, s.begun]).toEqual([null, 'noon', false]);
  });

  it('the actions go to the next to start, not to what the focus is', () => {
    const a = day([noon, night], at('09'), [date('reh', at('08'), avi, { ends_at: at('10') })]);
    expect(a.points[a.focus!].ref.of).toBe('date');
    expect(piecePerformance(a)?.ref.id).toBe('noon');
  });
});

describe('«tu hora»: the first stop of the day when the list names you (ADR-234)', () => {
  const perf = (over: Record<string, unknown> = {}) =>
    ({
      id: 'p',
      performed_at: '2026-11-21T19:00:00Z',
      start_at: '2026-11-21T19:00:00Z',
      load_in_at: '2026-11-21T15:00:00Z',
      soundcheck_at: '2026-11-21T17:30:00Z',
      commitments: [{ person_id: 'me', state: 'going' }],
      ...over,
    }) as unknown as Parameters<typeof yourStop>[0];

  it('named by your «voy»: the earliest hour of the running order', () => {
    expect(yourStop(perf(), 'me')?.at).toBe('2026-11-21T15:00:00Z');
  });
  it('named by the roster too', () => {
    expect(yourStop(perf({ commitments: [], person_ids: ['me'] }), 'me')?.at).toBe('2026-11-21T15:00:00Z');
  });
  it('not named, «no voy», nobody, or no hours: nothing', () => {
    expect(yourStop(perf(), 'other')).toBeNull();
    expect(yourStop(perf({ commitments: [{ person_id: 'me', state: 'not_going' }] }), 'me')).toBeNull();
    expect(yourStop(perf(), null)).toBeNull();
    expect(yourStop(perf({ start_at: null, load_in_at: null, soundcheck_at: null }), 'me')).toBeNull();
  });
});
