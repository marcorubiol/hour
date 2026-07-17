import { describe, expect, it } from 'vitest';
import {
  buildRoadsheet,
  isRoadsheetRole,
  ROADSHEET_ROLES,
  ROLE_SECTIONS,
  type PerformanceBundle,
} from './roadsheet';

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
