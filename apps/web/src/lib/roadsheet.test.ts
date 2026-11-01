import { describe, expect, it } from 'vitest';
import {
  buildRoadsheet,
  isRoadsheetRole,
  roadsheetRoleFor,
  ROADSHEET_ROLES,
  ROLE_SECTIONS,
  tripsOfPerformance,
  type PerformanceBundle,
  type TripRow,
} from './roadsheet';
import type { TravelStageRow } from './travel-stage';

function bundle(): PerformanceBundle {
  return {
    performance: {
      id: '019e3e72-0000-7000-8000-000000000001',
      slug: 'bcn-2026-10-17',
      performed_at: '2026-10-17',
      status: 'confirmed',
      venue_name: 'Sala Nau',
      city: 'Barcelona',
      country: 'ES',
      load_in_at: '2026-10-17T11:00:00+00:00',
      soundcheck_at: '2026-10-17T15:00:00+00:00',
      start_at: '2026-10-17T19:00:00+00:00',
      loadout_at: '2026-10-17T21:30:00+00:00',
      wrap_at: '2026-10-17T23:00:00+00:00',
      notes: 'internal: promoter prefers email',
      logistics: { parking: '2 vans, loading dock B' },
      hospitality: { per_diem: '30 EUR', dietary: 'one vegan' },
      technical: { power: '32A three-phase' },
    },
    project: { name: 'Última órbita', slug: 'ultima-orbita' },
    venue: {
      name: 'Sala Nau',
      city: 'Barcelona',
      country: 'ES',
      address: 'C/ Exemple 1',
      capacity: 400,
      timezone: 'Europe/Madrid',
      contacts: [{ role: 'production', email: 'prod@nau.example' }],
    },
    programmer: { full_name: 'Ana Prog', email: 'ana@fest.example', phone: '+34600000000' },
    cast: [
      {
        role: 'lead',
        person: { full_name: 'Lucía Cast', email: 'lucia@x.example', phone: '+34611111111' },
      },
      {
        role: 'lead',
        person: { full_name: 'Sara Sub', email: 'sara@x.example', phone: null },
        replaces: 'Lucía Cast',
        reason: 'injury',
      },
    ],
    crew: [
      {
        role: 'sound',
        person: { full_name: 'Marc Crew', email: 'marc@x.example', phone: '+34622222222' },
        contact_override: { phone: '+34699999999' },
        notes: 'arrives at load-in',
      },
    ],
    assets: [
      { kind: 'rider', direction: 'outbound', notes: null, uploaded_at: '2026-05-19T10:00:00Z' },
    ],
  };
}

describe('role matrix', () => {
  it('covers every declared role', () => {
    for (const role of ROADSHEET_ROLES) {
      expect(ROLE_SECTIONS[role].length).toBeGreaterThan(0);
    }
  });

  it('isRoadsheetRole accepts the vocabulary and rejects the rest', () => {
    expect(isRoadsheetRole('venue')).toBe(true);
    expect(isRoadsheetRole('tech_manager')).toBe(true);
    expect(isRoadsheetRole('admin')).toBe(false);
    expect(isRoadsheetRole('')).toBe(false);
  });

  it('no role ever exposes money — the bundle cannot even carry fees', () => {
    // Type-level guarantee: PerformanceBundle has no fee fields. Runtime
    // guard: the projection output never contains a fee key either.
    for (const role of ROADSHEET_ROLES) {
      const sheet = buildRoadsheet(bundle(), role) as unknown as Record<string, unknown>;
      expect('fee_amount' in sheet).toBe(false);
      expect('fee_currency' in sheet).toBe(false);
    }
  });
});

describe('buildRoadsheet — full', () => {
  it('exposes every section', () => {
    const sheet = buildRoadsheet(bundle(), 'full');
    expect(sheet.schedule?.start_at).toBe('2026-10-17T19:00:00+00:00');
    expect(sheet.hospitality).toEqual({ per_diem: '30 EUR', dietary: 'one vegan' });
    expect(sheet.technical).toEqual({ power: '32A three-phase' });
    expect(sheet.notes).toContain('internal');
    expect(sheet.contacts?.programmer.email).toBe('ana@fest.example');
    expect(sheet.crew?.[0].person?.phone).toBe('+34622222222');
    expect(sheet.crew?.[0].contact_override).toEqual({ phone: '+34699999999' });
    expect(sheet.assets).toHaveLength(1);
  });
});

describe('buildRoadsheet — venue', () => {
  it('hides hospitality, logistics, notes, programmer and personal contacts', () => {
    const sheet = buildRoadsheet(bundle(), 'venue');
    expect(sheet.hospitality).toBeNull();
    // Logistics mixes company-internal data (accommodation) into one
    // jsonb — withheld from venue until the shapes split.
    expect(sheet.logistics).toBeNull();
    expect(sheet.notes).toBeNull();
    expect(sheet.contacts).toBeNull();
    expect(sheet.assets).toBeNull();
    // Technical is the venue's business (their stage).
    expect(sheet.technical).not.toBeNull();
    // People appear as names + roles only.
    expect(sheet.crew?.[0].person).toEqual({ full_name: 'Marc Crew' });
    expect(sheet.crew?.[0].contact_override).toBeUndefined();
    expect(sheet.cast?.[1].replaces).toBe('Lucía Cast');
    expect(sheet.cast?.[0].person).toEqual({ full_name: 'Lucía Cast' });
  });
});

describe('buildRoadsheet — performer', () => {
  it('sees hospitality but not technical, and no personal contacts', () => {
    const sheet = buildRoadsheet(bundle(), 'performer');
    expect(sheet.hospitality).not.toBeNull();
    expect(sheet.technical).toBeNull();
    expect(sheet.notes).toBeNull();
    expect(sheet.cast?.[0].person).toEqual({ full_name: 'Lucía Cast' });
  });
});

describe('buildRoadsheet — tech_manager', () => {
  it('sees technical + assets + personal contacts, not hospitality or notes', () => {
    const sheet = buildRoadsheet(bundle(), 'tech_manager');
    expect(sheet.technical).not.toBeNull();
    expect(sheet.assets).toHaveLength(1);
    expect(sheet.crew?.[0].person?.email).toBe('marc@x.example');
    expect(sheet.hospitality).toBeNull();
    expect(sheet.notes).toBeNull();
    expect(sheet.contacts).toBeNull();
  });
});

describe('buildRoadsheet — degraded data', () => {
  it('falls back to denormalized venue_name for the title', () => {
    const b = bundle();
    b.venue = null;
    const sheet = buildRoadsheet(b, 'full');
    expect(sheet.title).toBe('Sala Nau');
    expect(sheet.venue).toBeNull();
    expect(sheet.venue_name).toBe('Sala Nau');
  });

  it('omits the programmer block when conversation is unset (self-produced)', () => {
    const b = bundle();
    b.programmer = null;
    const sheet = buildRoadsheet(b, 'full');
    expect(sheet.contacts).toBeNull();
  });
});

describe('roadsheetRoleFor — the whole sheet is for the space crew (ADR-146 § 6)', () => {
  it('the space crew gets `full`', () => {
    for (const r of ['owner', 'admin', 'member', 'viewer']) expect(roadsheetRoleFor('full', r)).toBe('full');
  });
  it('a bolo guest, or a login with no membership row, gets the technician’s cut', () => {
    expect(roadsheetRoleFor('full', 'guest')).toBe('tech_manager');
    expect(roadsheetRoleFor('full', null)).toBe('tech_manager');
    expect(buildRoadsheet(bundle(), roadsheetRoleFor('full', 'guest')).notes).toBeNull();
  });
  it('a preview role passes as asked: it only ever shows less', () => {
    expect(roadsheetRoleFor('venue', 'guest')).toBe('venue');
    expect(roadsheetRoleFor('tech_manager', 'owner')).toBe('tech_manager');
  });
});

// ── Travel (ADR-166) ────────────────────────────────────────────────────

function stage(over: Partial<TravelStageRow>): TravelStageRow {
  return {
    id: 's',
    position: 0,
    mode: 'train',
    from_city: 'Barcelona',
    from_country: null,
    from_place: 'Sants',
    to_city: 'Girona',
    to_country: null,
    to_place: null,
    depart_at: '2026-10-17T07:00:00Z',
    arrive_at: '2026-10-17T08:15:00Z',
    depart_tz: null,
    arrive_tz: null,
    from_venue_id: null,
    to_venue_id: null,
    reference: 'AB12',
    notes: 'internal stage note',
    ...over,
  };
}

function trip(over: Partial<TripRow>): TripRow {
  return {
    id: 'trip',
    kind: 'travel_day',
    status: 'confirmed',
    title: null,
    starts_at: '2026-10-17T06:00:00Z',
    ends_at: '2026-10-17T10:00:00Z',
    all_day: false,
    origin_city: 'Barcelona',
    destination_city: 'Girona',
    venue: null,
    stages: [],
    commitments: [],
    ...over,
  };
}

describe('tripsOfPerformance: which trip is «of this performance»', () => {
  const none = new Map<string, string>();
  const ids = (rows: TripRow[]) => tripsOfPerformance(rows, '2026-10-17', 'Europe/Madrid', none).map((t) => t.id);

  it('keeps the day and the eve, not the day after nor two days before', () => {
    expect(
      ids([
        trip({ id: 'day' }),
        trip({ id: 'eve', starts_at: '2026-10-16T15:00:00Z', ends_at: null }),
        trip({ id: 'after', starts_at: '2026-10-18T09:00:00Z', ends_at: null }),
        trip({ id: 'before', starts_at: '2026-10-15T09:00:00Z', ends_at: '2026-10-15T12:00:00Z' }),
      ]),
    ).toEqual(['eve', 'day']);
  });

  it('a long trip that started earlier and still runs on the eve counts', () => {
    expect(ids([trip({ id: 'long', starts_at: '2026-10-14T09:00:00Z', ends_at: '2026-10-16T20:00:00Z' })])).toEqual([
      'long',
    ]);
  });

  it('reads the day on the clock: 23h30 UTC on the 17th is the 18th in Madrid', () => {
    expect(ids([trip({ id: 'late', starts_at: '2026-10-17T23:30:00Z', ends_at: null })])).toEqual([]);
  });

  it('an all-day trip keeps its stored day', () => {
    expect(ids([trip({ id: 'ad', all_day: true, starts_at: '2026-10-16T00:00:00Z', ends_at: null })])).toEqual(['ad']);
  });

  it('drops cancelled rows and anything that is not a travel day', () => {
    expect(ids([trip({ id: 'x', status: 'cancelled' }), trip({ id: 'r', kind: 'rehearsal' })])).toEqual([]);
  });

  it('draws only timed stages, in time order, without their notes', () => {
    const [t] = tripsOfPerformance(
      [
        trip({
          stages: [
            stage({ id: 'b', depart_at: '2026-10-17T09:00:00Z', mode: 'car' }),
            stage({ id: 'u', depart_at: null }),
            stage({ id: 'a' }),
          ],
        }),
      ],
      '2026-10-17',
      'Europe/Madrid',
      none,
    );
    expect(t.stages.map((s) => s.mode)).toEqual(['train', 'car']);
    expect(t.stages[0]).not.toHaveProperty('notes');
    expect(t.stages[0].reference).toBe('AB12');
  });

  it('who goes is only who said «voy», by name: nobody is guessed (ADR-147)', () => {
    const names = new Map([
      ['p1', 'Ana'],
      ['p2', 'Biel'],
    ]);
    const [t] = tripsOfPerformance(
      [
        trip({
          commitments: [
            { person_id: 'p1', state: 'going' },
            { person_id: 'p2', state: 'not_going' },
            { person_id: 'p3', state: 'going' },
          ],
        }),
      ],
      '2026-10-17',
      null,
      names,
    );
    expect(t.going).toEqual(['Ana']);
    const [company] = tripsOfPerformance([trip({})], '2026-10-17', null, names);
    expect(company.going).toEqual([]);
  });
});

describe('buildRoadsheet: the travel section', () => {
  const withTravel = (): PerformanceBundle => ({
    ...bundle(),
    travel: tripsOfPerformance([trip({})], '2026-10-17', null, new Map()),
  });

  it('full, performer and tech_manager get it; the venue never does', () => {
    for (const role of ['full', 'performer', 'tech_manager'] as const) {
      expect(buildRoadsheet(withTravel(), role).travel).toHaveLength(1);
    }
    expect(buildRoadsheet(withTravel(), 'venue').travel).toBeNull();
    expect(ROLE_SECTIONS.venue).not.toContain('travel');
  });

  it('a bundle that did not read trips gives an empty section, not a crash', () => {
    expect(buildRoadsheet(bundle(), 'full').travel).toEqual([]);
  });
});
