import { describe, expect, it } from 'vitest';
import { telHref, venueContactRows, venueOrganizations, venuePerformances, type VenuePerformance } from './venue-record';

const TODAY = '2026-11-01';

function perf(id: string, day: string, over: Partial<VenuePerformance> = {}): VenuePerformance {
  return { id, slug: id, performed_at: day, status: 'confirmed', project: null, conversation: null, ...over };
}

describe('venuePerformances', () => {
  it('splits coming (closest first, today included) from past (latest first), without the cancelled', () => {
    const { coming, past } = venuePerformances(
      [
        perf('a', '2026-12-01'),
        perf('b', '2026-11-01'),
        perf('c', '2026-10-01'),
        perf('d', '2026-10-20'),
        perf('e', '2026-11-05', { status: 'cancelled' }),
      ],
      TODAY,
    );
    expect(coming.map((p) => p.id)).toEqual(['b', 'a']);
    expect(past.map((p) => p.id)).toEqual(['d', 'c']);
  });
});

describe('venueOrganizations', () => {
  it('each organization once, the one of the latest performance first', () => {
    const org = (slug: string) => ({ id: slug, slug: null, organization: { slug, name: slug.toUpperCase() } });
    const orgs = venueOrganizations([
      perf('a', '2026-01-01', { conversation: org('x') }),
      perf('b', '2026-06-01', { conversation: org('y') }),
      perf('c', '2026-03-01', { conversation: org('x') }),
      perf('d', '2026-07-01'),
    ]);
    expect(orgs).toEqual([
      { slug: 'y', name: 'Y' },
      { slug: 'x', name: 'X' },
    ]);
  });
});

describe('venueContactRows', () => {
  it('a phone is a tel: link without its spaces, a mail a mailto:', () => {
    expect(telHref('+34 600 00 00 01')).toBe('tel:+34600000001');
    expect(
      venueContactRows([
        { name: 'Regidoria', role: 'tècnic', phone: '972 00 00 00', email: null },
        { name: 'Taquilla', email: 'a@b.cat' },
        { name: '  ' },
      ]),
    ).toEqual([
      { name: 'Regidoria', role: 'tècnic', phone: '972 00 00 00', telHref: 'tel:972000000', email: null, mailHref: null },
      { name: 'Taquilla', role: null, phone: null, telHref: null, email: 'a@b.cat', mailHref: 'mailto:a@b.cat' },
    ]);
  });
});
