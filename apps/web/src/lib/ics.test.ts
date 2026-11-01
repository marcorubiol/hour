import { describe, expect, it } from 'vitest';
import {
  buildCalendar,
  escapeText,
  foldLine,
  toIcsDate,
  toIcsUtc,
  type CalendarFeed,
} from './ics';

const NOW = new Date('2026-07-04T12:00:00Z');

function baseFeed(overrides: Partial<CalendarFeed> = {}): CalendarFeed {
  return {
    workspace: { name: 'MüK Cia', slug: 'muk-cia', timezone: 'Europe/Madrid' },
    performances: [],
    dates: [],
    ...overrides,
  };
}

describe('escapeText', () => {
  it('escapes RFC 5545 specials', () => {
    expect(escapeText('a,b;c\\d')).toBe('a\\,b\\;c\\\\d');
    expect(escapeText('line1\nline2')).toBe('line1\\nline2');
  });
});

describe('foldLine', () => {
  it('leaves short lines alone', () => {
    expect(foldLine('SUMMARY:short')).toBe('SUMMARY:short');
  });

  it('folds at 75 octets with a leading space on continuations', () => {
    const long = 'SUMMARY:' + 'x'.repeat(200);
    const folded = foldLine(long);
    const parts = folded.split('\r\n');
    expect(parts.length).toBeGreaterThan(1);
    for (const [i, part] of parts.entries()) {
      if (i > 0) expect(part.startsWith(' ')).toBe(true);
      expect(new TextEncoder().encode(part).length).toBeLessThanOrEqual(75);
    }
    // Nothing lost: unfolding restores the original.
    expect(parts.map((p, i) => (i > 0 ? p.slice(1) : p)).join('')).toBe(long);
  });

  it('never splits a multi-byte character', () => {
    const long = 'SUMMARY:' + 'ü'.repeat(100);
    const folded = foldLine(long);
    for (const part of folded.split('\r\n')) {
      // Round-trip through encode/decode stays intact when splits respect
      // character boundaries.
      const bytes = new TextEncoder().encode(part);
      expect(new TextDecoder('utf-8', { fatal: true }).decode(bytes)).toBe(part);
    }
  });
});

describe('timestamps', () => {
  it('renders UTC instants and plain dates', () => {
    expect(toIcsUtc('2026-07-04T18:30:00+02:00')).toBe('20260704T163000Z');
    expect(toIcsUtc('2026-07-04T18:30:00Z')).toBe('20260704T183000Z');
    expect(toIcsDate('2026-07-04')).toBe('20260704');
  });
});

describe('buildCalendar', () => {
  it('renders a valid empty calendar with the workspace name', () => {
    const ics = buildCalendar(baseFeed(), NOW);
    expect(ics.startsWith('BEGIN:VCALENDAR\r\n')).toBe(true);
    expect(ics.endsWith('END:VCALENDAR\r\n')).toBe(true);
    expect(ics).toContain('X-WR-CALNAME:MüK Cia · Hour');
    expect(ics).toContain('PRODID:-//Hour//Calendar Feed//EN');
  });

  it('renders a timed performance with venue location and 2h fallback end', () => {
    const ics = buildCalendar(
      baseFeed({
        performances: [
          {
            id: '0197f000-0000-7000-8000-000000000001',
            slug: 'teatre-x-2026-09-12',
            performed_at: '2026-09-12',
            status: 'confirmed',
            venue_name: null,
            city: null,
            country: null,
            load_in_at: '2026-09-12T14:00:00Z',
            soundcheck_at: null,
            start_at: '2026-09-12T19:00:00Z',
            loadout_at: null,
            wrap_at: null,
            updated_at: '2026-07-01T10:00:00Z',
            project: { name: 'MaMeMi' },
            venue: {
              name: 'Teatre X',
              city: 'Barcelona',
              country: 'ES',
              address: 'C/ Gran 1',
              timezone: 'Europe/Madrid',
            },
          },
        ],
      }),
      NOW,
    );
    expect(ics).toContain('UID:perf-0197f000-0000-7000-8000-000000000001@hour.zerosense.studio');
    expect(ics).toContain('DTSTART:20260912T190000Z');
    expect(ics).toContain('DTEND:20260912T210000Z'); // start + 2h fallback
    expect(ics).toContain('SUMMARY:MaMeMi · Teatre X');
    expect(ics).toContain('LOCATION:Teatre X\\, C/ Gran 1\\, Barcelona\\, ES');
    expect(ics).toContain('STATUS:CONFIRMED');
    expect(ics).toContain('LAST-MODIFIED:20260701T100000Z');
    // Money never leaves through the feed.
    expect(ics).not.toMatch(/fee_amount|fee_currency|invoice/i);
  });

  it('falls back to a 2h block when wrap_at precedes start_at (valid DB state, loadout NULL)', () => {
    const ics = buildCalendar(
      baseFeed({
        performances: [
          {
            id: 'pw',
            slug: null,
            performed_at: '2026-09-12',
            status: 'confirmed',
            venue_name: 'Sala Z',
            city: null,
            country: null,
            load_in_at: null,
            soundcheck_at: null,
            start_at: '2026-09-12T19:00:00Z',
            loadout_at: null,
            wrap_at: '2026-09-12T18:00:00Z', // before start — must NOT become DTEND
            updated_at: null,
            project: null,
            venue: null,
          },
        ],
      }),
      NOW,
    );
    expect(ics).toContain('DTSTART:20260912T190000Z');
    expect(ics).toContain('DTEND:20260912T210000Z'); // +2h, never the earlier wrap
    expect(ics).not.toContain('DTEND:20260912T180000Z');
  });

  it('renders an untimed performance as all-day with exclusive DTEND', () => {
    const ics = buildCalendar(
      baseFeed({
        performances: [
          {
            id: 'p2',
            slug: null,
            performed_at: '2026-12-31',
            status: 'confirmed',
            venue_name: 'Sala Y',
            city: 'Madrid',
            country: 'ES',
            load_in_at: null,
            soundcheck_at: null,
            start_at: null,
            loadout_at: null,
            wrap_at: null,
            updated_at: null,
            project: null,
            venue: null,
          },
        ],
      }),
      NOW,
    );
    expect(ics).toContain('DTSTART;VALUE=DATE:20261231');
    expect(ics).toContain('DTEND;VALUE=DATE:20270101');
    expect(ics).toContain('SUMMARY:Sala Y');
  });

  it('renders dates with kind/status and tentative mapping', () => {
    const ics = buildCalendar(
      baseFeed({
        dates: [
          {
            id: 'd1',
            kind: 'travel_day',
            status: 'tentative',
            title: null,
            starts_at: '2026-09-11T08:00:00Z',
            ends_at: '2026-09-11T14:00:00Z',
            all_day: false,
            venue_name: null,
            city: 'Barcelona',
            updated_at: null,
            project: { name: 'MaMeMi' },
          },
          {
            id: 'd2',
            kind: 'residency',
            status: 'confirmed',
            title: 'Residència tècnica',
            starts_at: '2026-10-01T00:00:00Z',
            ends_at: '2026-10-03T00:00:00Z',
            all_day: true,
            venue_name: 'La Nau',
            city: null,
            updated_at: null,
            project: null,
          },
        ],
      }),
      NOW,
    );
    expect(ics).toContain('UID:date-d1@hour.zerosense.studio');
    expect(ics).toContain('SUMMARY:MaMeMi · travel day');
    expect(ics).toContain('STATUS:TENTATIVE');
    // Multi-day all-day: DTEND exclusive = last day + 1.
    expect(ics).toContain('DTSTART;VALUE=DATE:20261001');
    expect(ics).toContain('DTEND;VALUE=DATE:20261004');
    expect(ics).toContain('SUMMARY:Residència tècnica');
  });
});

/** Unfold (RFC 5545 §3.1) and unescape the DESCRIPTION of the first event. */
function description(ics: string): string {
  const unfolded = ics.replace(/\r\n /g, '');
  const line = unfolded.split('\r\n').find((l) => l.startsWith('DESCRIPTION:')) ?? '';
  return line.slice('DESCRIPTION:'.length).replace(/\\n/g, '\n').replace(/\\([,;\\])/g, '$1');
}

function perf(overrides: Partial<CalendarFeed['performances'][number]> = {}): CalendarFeed['performances'][number] {
  return {
    id: 'p1',
    slug: 'teatre-x-2026-03-14',
    performed_at: '2026-03-14',
    status: 'paid',
    venue_name: null,
    city: null,
    country: null,
    load_in_at: '2026-03-14T14:00:00Z',
    soundcheck_at: '2026-03-14T17:30:00Z',
    start_at: '2026-03-14T20:00:00Z',
    loadout_at: '2026-03-14T22:00:00Z',
    wrap_at: '2026-03-14T23:30:00Z',
    updated_at: null,
    project: { name: 'MaMeMi' },
    venue: { name: 'Teatre X', city: 'Barcelona', country: 'ES', address: null, timezone: 'Europe/Madrid' },
    ...overrides,
  };
}

describe('legible descriptions (ADR-162)', () => {
  const ORIGIN = 'https://hour.zerosense.studio';

  it('says the running order in the feed language, with the Planner clock in the venue zone', () => {
    const ics = buildCalendar(baseFeed({ performances: [perf()] }), NOW, { locale: 'es', origin: ORIGIN });
    expect(description(ics).split('\n')).toEqual([
      'carga 15h',
      'prueba de sonido 18h30',
      'función 21h',
      'desmontaje 23h',
      'fin 0h30',
      `En Hour: ${ORIGIN}/h/muk-cia/performance/teatre-x-2026-03-14`,
    ]);
    expect(ics).toContain(`URL:${ORIGIN}/h/muk-cia/performance/teatre-x-2026-03-14`);
  });

  it('never says the raw status nor an ISO instant, and keeps money states out', () => {
    const ics = buildCalendar(baseFeed({ performances: [perf()] }), NOW, { locale: 'ca', origin: ORIGIN });
    const desc = description(ics);
    expect(desc).not.toMatch(/Status|Load in|T14:00|paid|cobrat/);
    expect(desc).toContain('càrrega 15h');
  });

  it('falls back to the space zone when the venue has none, and speaks the trade', () => {
    const ics = buildCalendar(
      baseFeed({
        workspace: { name: 'Banda', slug: 'banda', timezone: 'Atlantic/Canary' },
        performances: [perf({ venue: null, venue_name: 'Sala', load_in_at: null, soundcheck_at: null, loadout_at: null, wrap_at: null })],
      }),
      NOW,
      { locale: 'es', trade: 'music', origin: ORIGIN },
    );
    expect(description(ics).split('\n')[0]).toBe('concierto 20h');
  });

  it('carries the whole running order when the feed sends one (doors, curfew, free labels)', () => {
    const ics = buildCalendar(
      baseFeed({
        performances: [
          perf({
            schedule: [
              { kind: 'doors', label: null, at: '2026-03-14T19:30:00Z' },
              { kind: 'start', label: null, at: '2026-03-14T20:00:00Z' },
              { kind: null, label: 'Photocall', at: '2026-03-14T21:15:00Z' },
              { kind: 'curfew', label: null, at: '2026-03-14T22:59:00Z' },
            ],
          }),
        ],
      }),
      NOW,
      { locale: 'es' },
    );
    expect(description(ics).split('\n')).toEqual(['puertas 20h30', 'función 21h', 'Photocall 22h15', 'toque de queda 23h59']);
    // Without an origin there is no link to point at.
    expect(ics).not.toContain('URL:');
  });

  it('a performance without slug has no link', () => {
    const ics = buildCalendar(baseFeed({ performances: [perf({ slug: null })] }), NOW, { locale: 'en', origin: ORIGIN });
    expect(ics).not.toContain('URL:');
    expect(description(ics)).not.toContain('In Hour');
  });

  it('a date says its kind in the language, the hold, and links to its day in the Planner', () => {
    const ics = buildCalendar(
      baseFeed({
        dates: [
          {
            id: 'd1',
            kind: 'travel_day',
            status: 'tentative',
            title: null,
            starts_at: '2026-09-10T23:30:00Z',
            ends_at: '2026-09-11T08:00:00Z',
            all_day: false,
            venue_name: null,
            city: null,
            updated_at: null,
            project: { name: 'MaMeMi' },
          },
        ],
      }),
      NOW,
      { locale: 'es', origin: ORIGIN },
    );
    expect(ics).toContain('SUMMARY:MaMeMi · día de viaje');
    // 23h30 UTC is already the 11th in Madrid.
    expect(description(ics).split('\n')).toEqual([
      'día de viaje · opción',
      `En Hour: ${ORIGIN}/h/planner?view=day&d=2026-09-11`,
    ]);
    expect(ics).not.toMatch(/—/);
  });
});
