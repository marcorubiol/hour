import { describe, expect, it } from 'vitest';
import { dateFacts } from './date-record';
import type { DateEvent } from './month-events';

const TZ = 'Europe/Madrid';

function date(over: Partial<DateEvent> = {}): DateEvent {
  return {
    id: 'd1',
    kind: 'rehearsal',
    status: 'confirmed',
    title: null,
    starts_at: '2026-11-12T09:00:00Z', // 10h in Madrid
    ends_at: '2026-11-12T13:00:00Z', // 14h
    all_day: false,
    venue_name: null,
    city: null,
    project: null,
    venue: null,
    ...over,
  };
}

describe('dateFacts', () => {
  it("reads a timed rehearsal's day and hours on the space's clock", () => {
    const f = dateFacts(date(), TZ);
    expect(f).toMatchObject({ first: '2026-11-12', last: '2026-11-12', start: '10h', end: '14h', name: null });
  });

  it("the venue's zone wins over the space's", () => {
    const f = dateFacts(date({ venue: { timezone: 'Europe/London' } }), TZ);
    expect(f.start).toBe('09h');
  });

  it('an all-day date has no hours, and spans the days it covers', () => {
    const f = dateFacts(
      date({ kind: 'residency', all_day: true, starts_at: '2026-11-16T00:00:00Z', ends_at: '2026-11-19T00:00:00Z' }),
      TZ,
    );
    expect(f).toMatchObject({ first: '2026-11-16', last: '2026-11-19', start: null, end: null });
  });

  it('a title names it; the venue and the city are where, never twice', () => {
    expect(dateFacts(date({ title: 'Ensayo con luces', venue_name: 'La Nau', city: 'Barcelona' }), TZ)).toMatchObject({
      name: 'Ensayo con luces',
      place: 'La Nau · Barcelona',
    });
    expect(dateFacts(date({ venue_name: 'La Nau', city: 'Barcelona' }), TZ)).toMatchObject({
      name: 'La Nau',
      place: 'Barcelona',
    });
  });

  it('«Otros» is named by its label when it has no title', () => {
    expect(dateFacts(date({ kind: 'other', label: 'Fotos' }), TZ).name).toBe('Fotos');
  });

  it('a trip is named by its two ends, and keeps them', () => {
    const f = dateFacts(date({ kind: 'travel_day', origin_city: 'Barcelona', destination_city: 'Sevilla' }), TZ);
    expect(f.name).toBe('Barcelona → Sevilla');
    expect(f.trip).toEqual({ from: 'Barcelona', to: 'Sevilla' });
    expect(f.place).toBeNull();
  });

  it("an old trip row's city is where it goes", () => {
    const f = dateFacts(date({ kind: 'travel_day', city: 'Girona' }), TZ);
    expect(f.name).toBe('Girona');
    expect(f.trip).toEqual({ from: null, to: 'Girona' });
  });

  it('an end hour equal to the start is not a range', () => {
    expect(dateFacts(date({ ends_at: '2026-11-12T09:00:00Z' }), TZ).end).toBeNull();
  });
});
