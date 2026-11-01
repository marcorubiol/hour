import { describe, expect, it } from 'vitest';
import { issuerFixHref, missingFields, orderedTaxes, partyLines, resolveParty, toFiscalPrint, type ProformaTaxLine } from './proforma';

const FULL = {
  fiscal_identity_id: 'fi-1',
  legal_name: 'MüK Cia SL',
  tax_id: 'B12345678',
  address_line_1: 'C/ Gran 1',
  address_line_2: null,
  postal_code: '08001',
  city: 'Barcelona',
  region: 'Barcelona',
  country: 'ES',
  iban: 'ES00 0000',
  swift_bic: null,
};

describe('resolveParty', () => {
  it('prints the frozen snapshot first', () => {
    const p = resolveParty({ snapshot: FULL, pointer: 'fi-2', row: { ...FULL, legal_name: 'Otra' }, name: 'MüK' });
    expect(p.state).toBe('ok');
    expect(p.fiscal?.legal_name).toBe('MüK Cia SL');
  });

  it('a pointer without a readable row is hidden, no pointer is none', () => {
    expect(resolveParty({ snapshot: null, pointer: 'fi-1', row: null, name: 'MüK' }).state).toBe('hidden');
    expect(resolveParty({ snapshot: null, pointer: null, row: null, name: 'MüK' })).toEqual({
      state: 'none',
      name: 'MüK',
      fiscal: null,
    });
  });
});

describe('missingFields', () => {
  it('names only what a complete document needs and lacks', () => {
    expect(missingFields({ fiscal: toFiscalPrint(FULL) })).toEqual([]);
    expect(missingFields({ fiscal: toFiscalPrint({ ...FULL, tax_id: ' ', postal_code: null }) })).toEqual([
      'tax_id',
      'postal_code',
    ]);
    expect(missingFields({ fiscal: null })).toEqual(['legal_name', 'tax_id', 'address_line_1', 'postal_code', 'city']);
  });
});

describe('partyLines', () => {
  it('reads like an address, with no stray separators', () => {
    expect(partyLines({ name: 'MüK', fiscal: toFiscalPrint(FULL) })).toEqual([
      'MüK Cia SL',
      'B12345678',
      'C/ Gran 1',
      '08001 Barcelona',
      'Barcelona, ES',
    ]);
    expect(partyLines({ name: 'MüK', fiscal: toFiscalPrint({ city: 'Girona' }) })).toEqual(['MüK', 'Girona']);
  });

  it('without a record, only the name it is known by', () => {
    expect(partyLines({ name: 'Teatre X', fiscal: null })).toEqual(['Teatre X']);
    expect(partyLines({ name: null, fiscal: null })).toEqual([]);
  });
});

describe('orderedTaxes', () => {
  it('keeps the document order', () => {
    const tax = (id: string, ordinal: number): ProformaTaxLine => ({
      id,
      label: id,
      kind: 'add',
      rate_pct: 21,
      base_amount: 100,
      amount: 21,
      exempt_reason: null,
      ordinal,
    });
    expect(orderedTaxes([tax('irpf', 2), tax('iva', 1)]).map((t) => t.id)).toEqual(['iva', 'irpf']);
  });
});

describe('issuerFixHref', () => {
  const ok = resolveParty({ snapshot: null, pointer: 'fi-1', row: FULL, name: 'MüK' });
  const none = resolveParty({ snapshot: null, pointer: null, row: null, name: 'MüK' });
  const hidden = resolveParty({ snapshot: null, pointer: 'fi-1', row: null, name: 'MüK' });
  const partial = resolveParty({ snapshot: null, pointer: 'fi-1', row: { ...FULL, tax_id: '' }, name: 'MüK' });
  const doc = (issuer: typeof ok, status = 'draft', workspace_slug: string | null = 'muk-cia') => ({
    issuer,
    status,
    workspace_slug,
  });

  it('links to the space fiscal block when the issuer is missing or incomplete', () => {
    expect(issuerFixHref(doc(none))).toBe('/h/muk-cia/settings?section=space#fiscal');
    expect(issuerFixHref(doc(partial))).toBe('/h/muk-cia/settings?section=space#fiscal');
  });

  it('says nothing when complete, unreadable, issued or without a space', () => {
    expect(issuerFixHref(doc(ok))).toBeNull();
    expect(issuerFixHref(doc(hidden))).toBeNull();
    expect(issuerFixHref(doc(none, 'issued'))).toBeNull();
    expect(issuerFixHref(doc(none, 'draft', null))).toBeNull();
  });
});
