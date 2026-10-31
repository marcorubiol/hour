/**
 * Hoy's agenda (ADR-150): the day in order, the card moves with the clock,
 * the past dims, the show stays marked.
 */
import { describe, expect, test } from 'vitest';
import { agendaDay, agendaPoints, dayAgenda } from './day-agenda';
import { buildPersonAttribution } from './people';
import type { DateEvent, PerformanceEvent } from './month-events';

const TZ = 'Europe/Madrid';
const DAY = '2026-08-14';
// Madrid is UTC+2 in August: local 9h12 is 07:12Z.
const at = (local: string, day = DAY) => {
  const [h, m] = local.split(':').map(Number);
  return new Date(Date.UTC(Number(day.slice(0, 4)), Number(day.slice(5, 7)) - 1, Number(day.slice(8, 10)), h - 2, m));
};
const iso = (local: string, day = DAY) => at(local, day).toISOString();

function perf(over: Partial<PerformanceEvent> = {}): PerformanceEvent {
  return {
    id: 'p-show',
    slug: 'p-show',
    performed_at: DAY,
    status: 'confirmed',
    start_at: null,
    venue_name: 'Teatre de Salt',
    city: 'Girona',
    country: null,
    line_id: null,
    project: { id: 'pr-gota', name: 'Gota', workspace_id: 'ws-a' } as PerformanceEvent['project'],
    venue: { timezone: TZ } as PerformanceEvent['venue'],
    ...over,
  };
}

function date(over: Partial<DateEvent> = {}): DateEvent {
  return {
    id: 'd1',
    kind: 'rehearsal',
    status: 'confirmed',
    title: null,
    starts_at: iso('12:00'),
    ends_at: iso('14:00'),
    all_day: false,
    venue_name: null,
    city: null,
    project: { id: 'pr-other', name: 'Avi', workspace_id: 'ws-a' } as DateEvent['project'],
    venue: null,
    ...over,
  };
}

const train = date({
  id: 'd-train',
  kind: 'travel_day',
  all_day: true,
  starts_at: `${DAY}T00:00:00Z`,
  ends_at: null,
  project: { id: 'pr-gota', name: 'Gota', workspace_id: 'ws-a' } as DateEvent['project'],
  stages: [
    {
      id: 's1',
      position: 1,
      mode: 'train',
      from_city: 'Barcelona',
      from_country: null,
      from_place: 'Sants',
      to_city: 'Girona',
      to_country: null,
      to_place: null,
      depart_at: iso('09:12'),
      arrive_at: iso('10:05'),
      depart_tz: null,
      arrive_tz: null,
      from_venue_id: null,
      to_venue_id: null,
      reference: 'K7Q2PX',
      notes: null,
    },
  ] as DateEvent['stages'],
});
const rehearsal = date({ id: 'd-reh' });
const show = perf({
  load_in_at: iso('11:00'),
  soundcheck_at: iso('17:00'),
  start_at: iso('20:30'),
  wrap_at: iso('22:00'),
});
const input = { performances: [show], dates: [rehearsal, train], viewerTz: TZ };

const word = (a: ReturnType<typeof dayAgenda>, i: number | null) => {
  if (i === null) return null;
  const w = a.points[i].what;
  return w.of === 'moment' ? w.key : w.of === 'stage' ? w.mode : w.kind;
};

describe('the day in order', () => {
  test('every moment, stage and date, in time order; the show is the main one', () => {
    const points = agendaPoints(input, DAY);
    expect(points.map((p) => (p.what.of === 'moment' ? p.what.key : p.what.of === 'stage' ? p.what.mode : p.what.kind))).toEqual([
      'train',
      'load_in',
      'rehearsal',
      'soundcheck',
      'start',
      'wrap',
    ]);
    expect(points.filter((p) => p.main).map((p) => p.what.of === 'moment' && p.what.key)).toEqual(['start']);
  });

  test('a wrap closes the sheet: it is never what you are in', () => {
    const a = dayAgenda(input, DAY, at('22:30'));
    expect(a.current).toBeNull();
    expect(a.headline).toBe('done');
  });
});

describe('the card moves with the day', () => {
  test('09h: the train in 12 minutes', () => {
    const a = dayAgenda(input, DAY, at('09:00'));
    expect(a.headline).toBe('countdown');
    expect(word(a, a.focus)).toBe('train');
    expect(a.past.some(Boolean)).toBe(false);
  });

  test('08h: more than an hour ahead, the card says the hour of the train', () => {
    const a = dayAgenda(input, DAY, at('08:00'));
    expect(a.headline).toBe('at');
    expect(word(a, a.focus)).toBe('train');
  });

  test('13h: inside the rehearsal (innermost), until 14h; the train is past', () => {
    const a = dayAgenda(input, DAY, at('13:00'));
    expect(a.headline).toBe('doing');
    expect(word(a, a.focus)).toBe('rehearsal');
    expect(a.until).toBe(iso('14:00'));
    expect(a.past[0]).toBe(true);
    // The load-in is not over: the rehearsal sits inside it.
    expect(a.past[1]).toBe(false);
  });

  test('10h30: in the load-in until 17h; the rehearsal at noon is its own row, not its end', () => {
    const a = dayAgenda(input, DAY, at('10:30'));
    // 11h00 is within the hour: the card counts down to the load-in.
    expect(a.headline).toBe('countdown');
    const b = dayAgenda(input, DAY, at('11:05'));
    expect(b.headline).toBe('countdown'); // the rehearsal in 55 min
    const c = dayAgenda(input, DAY, at('10:55'));
    expect(word(c, c.focus)).toBe('load_in');
    const d = dayAgenda({ ...input, dates: [train] }, DAY, at('11:30'));
    expect(d.headline).toBe('doing');
    expect(d.until).toBe(iso('17:00'));
  });

  test('15h: back in the load-in, until the soundcheck at 17h', () => {
    const a = dayAgenda(input, DAY, at('15:00'));
    expect(a.headline).toBe('doing');
    expect(word(a, a.focus)).toBe('load_in');
    expect(a.until).toBe(iso('17:00'));
    expect(a.past[2]).toBe(true);
  });

  test('16h20: the soundcheck in 40 minutes beats the load-in', () => {
    const a = dayAgenda(input, DAY, at('16:20'));
    expect(a.headline).toBe('countdown');
    expect(word(a, a.focus)).toBe('soundcheck');
    expect(word(a, a.current)).toBe('load_in');
  });

  test('20h: the show in 30 minutes', () => {
    const a = dayAgenda(input, DAY, at('20:00'));
    expect(a.headline).toBe('countdown');
    expect(word(a, a.focus)).toBe('start');
    expect(a.points[a.focus!].main).toBe(true);
  });

  test('21h: in the show, until the wrap', () => {
    const a = dayAgenda(input, DAY, at('21:00'));
    expect(a.headline).toBe('doing');
    expect(word(a, a.focus)).toBe('start');
    expect(a.until).toBe(iso('22:00'));
  });
});

describe('which day', () => {
  const tomorrow = perf({ id: 'p-tom', performed_at: '2026-08-15', start_at: iso('20:00', '2026-08-15') });

  test('today while anything of it is still on or ahead', () => {
    expect(agendaDay({ ...input, performances: [show, tomorrow] }, at('21:00'), '2026-08-15')).toBe(DAY);
  });

  test('once today is over, the day of what comes next', () => {
    expect(agendaDay({ ...input, performances: [show, tomorrow] }, at('22:30'), '2026-08-15')).toBe('2026-08-15');
  });
});

describe('the same rows as the pulse', () => {
  test('a company date of a project you are not on is not on your day', () => {
    const axis = buildPersonAttribution({
      pinnedPersonIds: ['me'],
      team: [
        { person_id: 'me', workspace_id: 'ws-a', slug: 'me', full_name: 'Me', project_ids: ['pr-gota'] },
        { person_id: 'you', workspace_id: 'ws-a', slug: 'you', full_name: 'You', project_ids: ['pr-other'] },
      ],
    });
    const points = agendaPoints({ ...input, axis }, DAY);
    expect(points.some((p) => p.ref.id === 'd-reh')).toBe(false);
    expect(points.some((p) => p.ref.id === 'd-train')).toBe(true);
  });

  test('a cancelled row is not on the day', () => {
    expect(agendaPoints({ ...input, performances: [{ ...show, status: 'cancelled' }] }, DAY).some((p) => p.ref.id === 'p-show')).toBe(false);
  });
});
