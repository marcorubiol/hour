import { describe, expect, it } from 'vitest';
import * as v from 'valibot';
import { isValidTimezone, VenueContactSchema, VenuePatchSchema } from './venue';

describe('isValidTimezone', () => {
  it('accepts real IANA zones', () => {
    for (const tz of ['Europe/Madrid', 'Europe/Paris', 'America/New_York', 'UTC']) {
      expect(isValidTimezone(tz)).toBe(true);
    }
  });

  it('rejects garbage and near-misses', () => {
    for (const tz of ['Europe/Madrid2', 'CEST', 'Madrid', 'GMT+2h', '']) {
      expect(isValidTimezone(tz)).toBe(false);
    }
  });
});

describe('VenuePatchSchema', () => {
  it('accepts a timezone-only patch (the road sheet dual-time case)', () => {
    const r = v.safeParse(VenuePatchSchema, { timezone: 'Europe/Paris' });
    expect(r.success).toBe(true);
    if (r.success) expect(r.output).toEqual({ timezone: 'Europe/Paris' });
  });

  it('rejects an invalid timezone', () => {
    expect(v.safeParse(VenuePatchSchema, { timezone: 'Central Time' }).success).toBe(
      false,
    );
  });

  it('accepts null to clear nullable fields', () => {
    const r = v.safeParse(VenuePatchSchema, {
      timezone: null,
      address: null,
      capacity: null,
      notes: null,
    });
    expect(r.success).toBe(true);
  });

  it('rejects an empty name (the entity anchor) but allows omitting it', () => {
    expect(v.safeParse(VenuePatchSchema, { name: '' }).success).toBe(false);
    expect(v.safeParse(VenuePatchSchema, { name: '   ' }).success).toBe(false);
    expect(v.safeParse(VenuePatchSchema, { address: 'C/ Gran 1' }).success).toBe(true);
  });

  it('validates country as ISO alpha-2', () => {
    expect(v.safeParse(VenuePatchSchema, { country: 'ES' }).success).toBe(true);
    expect(v.safeParse(VenuePatchSchema, { country: 'fr' }).success).toBe(true);
    expect(v.safeParse(VenuePatchSchema, { country: 'ESP' }).success).toBe(false);
  });

  it('validates the contacts array (name required, email checked, max 20)', () => {
    const ok = v.safeParse(VenuePatchSchema, {
      contacts: [
        { name: 'Marta Regidora', role: 'Tech manager', phone: '+34 600 000 000' },
        { name: 'Taquilla', email: 'tickets@teatre.cat' },
      ],
    });
    expect(ok.success).toBe(true);

    expect(
      v.safeParse(VenuePatchSchema, { contacts: [{ role: 'sin nombre' }] }).success,
    ).toBe(false);
    expect(
      v.safeParse(VenuePatchSchema, {
        contacts: [{ name: 'X', email: 'nope' }],
      }).success,
    ).toBe(false);
    expect(
      v.safeParse(VenuePatchSchema, {
        contacts: Array.from({ length: 21 }, (_, i) => ({ name: `c${i}` })),
      }).success,
    ).toBe(false);
  });

  it('strips unknown keys (workspace_id/slug can never ride along)', () => {
    const r = v.safeParse(VenuePatchSchema, {
      timezone: 'Europe/Madrid',
      workspace_id: '11111111-1111-1111-1111-111111111111',
      slug: 'hacked',
    });
    expect(r.success).toBe(true);
    if (r.success) {
      expect('workspace_id' in r.output).toBe(false);
      expect('slug' in r.output).toBe(false);
    }
  });
});

describe('VenueContactSchema', () => {
  it('trims fields and accepts partial contact info', () => {
    const r = v.safeParse(VenueContactSchema, { name: '  Marta  ', phone: '600000000' });
    expect(r.success).toBe(true);
    if (r.success) expect(r.output.name).toBe('Marta');
  });
});
