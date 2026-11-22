import { describe, expect, it } from 'vitest';
import {
  buildPersonalCalendar,
  buildPersonalEvents,
  buildSingleEventIcs,
  eventFingerprint,
  toIcsLocal,
  type PersonalCalendarFeed,
  type PersonalDateRow,
  type PersonalPerformanceRow,
} from './calendar-events';

const NOW = new Date('2026-11-22T12:00:00Z');
const WS_MUK = { id: 'ws-1', name: 'MüK Cia', slug: 'muk-cia', timezone: 'Europe/Madrid', trade: 'stage' };
const WS_MUSIC = { id: 'ws-2', name: 'Banda X', slug: 'banda-x', timezone: 'Europe/London', trade: 'music' };

function perf(overrides: Partial<PersonalPerformanceRow> = {}): PersonalPerformanceRow {
  return {
    id: '0197f000-0000-7000-8000-000000000001',
    slug: 'teatre-central-2026-12-10',
    performed_at: '2026-12-10',
    status: 'confirmed',
    venue_name: null,
    city: null,
    country: null,
    load_in_at: '2026-12-10T14:00:00Z',
    soundcheck_at: '2026-12-10T16:00:00Z',
    start_at: '2026-12-10T19:00:00Z',
    loadout_at: '2026-12-10T21:00:00Z',
    wrap_at: '2026-12-10T22:00:00Z',
    updated_at: '2026-11-20T10:00:00Z',
    unanswered: false,
    schedule: null,
    workspace: WS_MUK,
    project: { name: 'MaMeMi' },
    venue: {
      name: 'Teatre Central',
      city: 'Barcelona',
      country: 'ES',
      address: 'C/ Gran 1',
      timezone: 'Europe/Madrid',
    },
    ...overrides,
  };
}

function dateRow(overrides: Partial<PersonalDateRow> = {}): PersonalDateRow {
  return {
    id: '0197f000-0000-7000-8000-000000000002',
    kind: 'rehearsal',
    status: 'confirmed',
    title: 'Ensayo general',
    starts_at: '2026-12-09T09:00:00Z',
    ends_at: '2026-12-09T13:00:00Z',
    all_day: false,
    venue_name: 'Nau Ivanow',
    city: 'Barcelona',
    updated_at: '2026-11-20T10:00:00Z',
    workspace: WS_MUK,
    project: { name: 'MaMeMi' },
    stages: [],
    ...overrides,
  };
}

function feed(overrides: Partial<PersonalCalendarFeed> = {}): PersonalCalendarFeed {
  return {
    alarm_mode: 'none',
    performances: [],
    dates: [],
    ...overrides,
  };
}

describe('calendar-events (ADR-241 Fase 1)', () => {
  it('spans the full workday from load_in to wrap and puts showtime in the title (Decision 3)', () => {
    const events = buildPersonalEvents(feed({ performances: [perf()] }), {
      locale: 'es',
      origin: 'https://hour.zerosense.studio',
    });
    expect(events).toHaveLength(1);
    const e = events[0];
    expect(e.uid).toBe('perf-0197f000-0000-7000-8000-000000000001@hour.zerosense.studio');
    // 14:00Z = 15:00 CET, 19:00Z = 20:00 CET (showtime), 22:00Z = 23:00 CET
    expect(e.startUtc).toBe('2026-12-10T14:00:00.000Z');
    expect(e.endUtc).toBe('2026-12-10T22:00:00.000Z');
    expect(e.summary).toBe('MaMeMi · Teatre Central · 20h');
    expect(e.summary).not.toContain('—');
    expect(e.status).toBe('CONFIRMED');
    expect(e.transparency).toBe('OPAQUE');
    expect(e.timezone).toBe('Europe/Madrid');
    expect(e.url).toBe('https://hour.zerosense.studio/h/muk-cia/performance/teatre-central-2026-12-10');
    expect(e.description).toContain('15h');
    expect(e.description).toContain('20h');
    expect(e.description).toContain('https://hour.zerosense.studio/h/muk-cia/performance/teatre-central-2026-12-10');
  });

  it('does not repeat showtime in title when there is no earlier moment before start_at, and falls back to +2h', () => {
    const events = buildPersonalEvents(
      feed({
        performances: [
          perf({
            load_in_at: null,
            soundcheck_at: null,
            loadout_at: null,
            wrap_at: null,
            start_at: '2026-12-10T19:00:00Z',
          }),
        ],
      }),
      { locale: 'es' },
    );
    expect(events[0].summary).toBe('MaMeMi · Teatre Central');
    expect(events[0].startUtc).toBe('2026-12-10T19:00:00.000Z');
    expect(events[0].endUtc).toBe('2026-12-10T21:00:00.000Z');
  });

  it('marks options (hold) and unanswered convocations as TENTATIVE with title suffixes (Decision 2)', () => {
    const events = buildPersonalEvents(
      feed({
        performances: [
          perf({ id: 'p-opt', status: 'hold_1', unanswered: false }),
          perf({ id: 'p-call', status: 'confirmed', unanswered: true }),
          perf({ id: 'p-both', status: 'hold', unanswered: true }),
          perf({ id: 'p-cancel', status: 'cancelled' }),
          perf({ id: 'p-prop', status: 'proposed' }),
        ],
      }),
      { locale: 'es' },
    );
    expect(events.map((e) => e.entityId)).toEqual(['p-opt', 'p-call', 'p-both']);
    expect(events[0].status).toBe('TENTATIVE');
    expect(events[0].summary).toBe('MaMeMi · Teatre Central · 20h · opción');
    expect(events[1].status).toBe('TENTATIVE');
    expect(events[1].summary).toBe('MaMeMi · Teatre Central · 20h · por contestar');
    expect(events[2].status).toBe('TENTATIVE');
    expect(events[2].summary).toBe('MaMeMi · Teatre Central · 20h · opción · por contestar');
  });

  it('models travel_day as a single event from first departure to last arrival with stages in notes', () => {
    const events = buildPersonalEvents(
      feed({
        dates: [
          dateRow({
            id: 'd-trip',
            kind: 'travel_day',
            title: 'Viaje a Madrid',
            all_day: true,
            starts_at: '2026-12-10T00:00:00Z',
            ends_at: '2026-12-10T23:59:59Z',
            stages: [
              {
                mode: 'train',
                from_city: 'Barcelona',
                from_place: 'Sants',
                to_city: 'Zaragoza',
                to_place: null,
                depart_at: '2026-12-10T08:30:00Z',
                arrive_at: '2026-12-10T10:00:00Z',
                depart_tz: 'Europe/Madrid',
                arrive_tz: 'Europe/Madrid',
              },
              {
                mode: 'train',
                from_city: 'Zaragoza',
                from_place: null,
                to_city: 'Madrid',
                to_place: 'Atocha',
                depart_at: '2026-12-10T10:30:00Z',
                arrive_at: '2026-12-10T12:15:00Z',
                depart_tz: 'Europe/Madrid',
                arrive_tz: 'Europe/Madrid',
              },
            ],
          }),
        ],
      }),
      { locale: 'es', origin: 'https://hour.zerosense.studio' },
    );
    expect(events).toHaveLength(1);
    expect(events[0].startUtc).toBe('2026-12-10T08:30:00.000Z');
    expect(events[0].endUtc).toBe('2026-12-10T12:15:00.000Z');
    expect(events[0].transparency).toBe('OPAQUE');
    expect(events[0].description).toContain('Sants → Zaragoza');
    expect(events[0].description).toContain('Zaragoza → Atocha');
  });

  it('models day_off as all-day TRANSPARENT with no alarm even when feed has an alarm', () => {
    const ics = buildPersonalCalendar(
      feed({
        alarm_mode: '2h_before',
        dates: [
          dateRow({
            id: 'd-off',
            kind: 'day_off',
            title: null,
            all_day: false,
            starts_at: '2026-12-11T09:00:00Z',
            ends_at: '2026-12-11T18:00:00Z',
          }),
        ],
      }),
      NOW,
      { locale: 'es' },
    );
    expect(ics).toContain('DTSTART;VALUE=DATE:20261211');
    expect(ics).toContain('DTEND;VALUE=DATE:20261212');
    expect(ics).toContain('TRANSP:TRANSPARENT');
    expect(ics).not.toContain('BEGIN:VALARM');
  });

  it('renders TZID wall clocks, SEQUENCE, and optional VALARM (Decision 4)', () => {
    expect(toIcsLocal('2026-12-10T14:00:00Z', 'Europe/Madrid')).toBe('20261210T150000');

    const noAlarm = buildPersonalCalendar(feed({ alarm_mode: 'none', performances: [perf()] }), NOW, {
      locale: 'es',
    });
    expect(noAlarm).toContain('X-WR-CALNAME:hour');
    expect(noAlarm).toContain('DTSTART;TZID=Europe/Madrid:20261210T150000');
    expect(noAlarm).toContain('DTEND;TZID=Europe/Madrid:20261210T230000');
    expect(noAlarm).toContain('SEQUENCE:0');
    expect(noAlarm).toContain('TRANSP:OPAQUE');
    expect(noAlarm).not.toContain('BEGIN:VALARM');

    const twoHours = buildPersonalCalendar(feed({ alarm_mode: '2h_before', performances: [perf()] }), NOW, {
      locale: 'es',
    });
    expect(twoHours).toContain('BEGIN:VALARM\r\nACTION:DISPLAY\r\nTRIGGER:-PT2H');

    const dayBefore = buildPersonalCalendar(feed({ alarm_mode: 'day_before', performances: [perf()] }), NOW, {
      locale: 'es',
    });
    expect(dayBefore).toContain('BEGIN:VALARM\r\nACTION:DISPLAY\r\nTRIGGER:-P1D');
  });

  it('combines events across multiple workspaces and builds standalone VCALENDAR for CalDAV', () => {
    const events = buildPersonalEvents(
      feed({
        performances: [
          perf({ id: 'p-1', workspace: WS_MUK }),
          perf({
            id: 'p-2',
            workspace: WS_MUSIC,
            venue: { name: 'Roundhouse', city: 'London', country: 'UK', address: null, timezone: 'Europe/London' },
            project: { name: 'Tour UK' },
          }),
        ],
      }),
      { locale: 'en', origin: 'https://hour.zerosense.studio' },
    );
    expect(events).toHaveLength(2);
    expect(events[0].timezone).toBe('Europe/Madrid');
    expect(events[1].timezone).toBe('Europe/London');

    const single = buildSingleEventIcs(events[1], NOW);
    expect(single.startsWith('BEGIN:VCALENDAR\r\n')).toBe(true);
    expect(single).toContain('UID:perf-p-2@hour.zerosense.studio');
    expect(single).toContain('DTSTART;TZID=Europe/London:20261210T140000');
  });

  it('computes a stable fingerprint that ignores updatedAt and sequence', async () => {
    const [e1] = buildPersonalEvents(feed({ performances: [perf({ updated_at: '2026-11-20T10:00:00Z' })] }));
    const [e2] = buildPersonalEvents(feed({ performances: [perf({ updated_at: '2026-11-22T18:00:00Z' })] }));
    const [e3] = buildPersonalEvents(feed({ performances: [perf({ status: 'hold' })] }));

    expect(await eventFingerprint(e1)).toBe(await eventFingerprint({ ...e2, sequence: 7 }));
    expect(await eventFingerprint(e1)).not.toBe(await eventFingerprint(e3));
  });
});
