import { describe, expect, it } from 'vitest';
import { boloHistory, type BoloHistoryInput } from './bolo-history';
import { boloMoney, invoicesByBolo, type MoneyBolo, type MoneyInvoiceItem } from './money';

const TODAY = '2027-04-10';
const MADRID = 'Europe/Madrid';
/** Noon on the reader's clock, whatever zone the test runs in: `boloMoney` reads the local day. */
const noon = (day: string) => new Date(`${day}T12:00:00`);

const bolo = (over: Partial<MoneyBolo> = {}): MoneyBolo => ({
  id: 'b',
  project_id: 'p',
  line_id: null,
  conversation_id: null,
  venue_name: 'Teatre Principal',
  city: 'Olot',
  country: 'ES',
  fee_amount: 1800,
  fee_currency: 'EUR',
  status: 'confirmed',
  collected: 0,
  function_count: 1,
  first_performed_at: '2027-03-07',
  last_performed_at: '2027-03-07',
  contract_sent_at: '2026-12-01T10:00:00Z',
  contract_signed_at: '2026-12-12T10:00:00Z',
  created_at: '2026-11-20T09:00:00Z',
  confirmed_at: '2026-11-28T09:00:00Z',
  project: { id: 'p', slug: 'obra', name: 'Obra', accent: null, workspace_id: 'w' },
  ...over,
});

const invoice = (over: Partial<MoneyInvoiceItem> = {}): MoneyInvoiceItem => ({
  id: 'i',
  workspace_id: 'w',
  project_id: 'p',
  payer_organization_id: null,
  payer_fiscal_identity_id: null,
  doc_type: 'factura',
  number: 'F-26-031',
  status: 'issued',
  issued_on: '2027-03-09',
  due_on: '2027-04-07',
  expected_on: null,
  payment_condition: null,
  subtotal: 1800,
  total: 1800,
  currency: 'EUR',
  country: 'ES',
  tax_lines: [],
  notes: null,
  paid_amount: 0,
  project: null,
  payer: null,
  lines: [{ bolo_id: 'b' }],
  payments: [],
  ...over,
});

const fn = { id: 'f', slug: 'olot', performed_at: '2027-03-07', status: 'done', venue_name: 'Teatre Principal', city: 'Olot' };

function history(b: MoneyBolo, docs: MoneyInvoiceItem[], today = TODAY, over: Partial<BoloHistoryInput> = {}) {
  const ctx = {
    invoicesByBolo: invoicesByBolo(docs),
    termsByPayer: new Map(),
    modeOf: () => 'legal' as const,
    today: noon(today),
  };
  return boloHistory({
    bolo: b,
    functions: [fn],
    docs,
    money: boloMoney(b, ctx),
    today,
    timeZone: MADRID,
    ...over,
  });
}

describe('boloHistory', () => {
  it('tells the deal in the order it happened, the line of today after the due date', () => {
    const h = history(bolo(), [invoice()]);
    expect(h.past.map((e) => `${e.day} ${e.kind}`)).toEqual([
      '2026-11-20 opened',
      '2026-11-28 agreed',
      '2026-12-01 contract_sent',
      '2026-12-12 contract_signed',
      '2027-03-07 function',
      '2027-03-09 invoice',
      '2027-04-07 due',
    ]);
    expect(h.now).toEqual({ kind: 'overdue', days: 3 });
    expect(h.future).toEqual([]);
  });

  it('says overdue in days from the due date, the same days Cuentas counts', () => {
    expect(history(bolo(), [invoice()], '2027-04-08').now).toEqual({ kind: 'overdue', days: 1 });
  });

  it('on the due day it is not late yet: «vence hoy», and the due date sits above the line', () => {
    const h = history(bolo(), [invoice()], '2027-04-07');
    expect(h.now).toEqual({ kind: 'due_today' });
    expect(h.past.at(-1)?.kind).toBe('due');
  });

  it('before the due day, the due date is what is coming and the line counts down', () => {
    const h = history(bolo(), [invoice()], '2027-03-28');
    expect(h.now).toEqual({ kind: 'due_in', days: 10 });
    expect(h.future.map((e) => e.kind)).toEqual(['due']);
  });

  it('what happened today is history: a function today is above the line', () => {
    const h = history(bolo({ status: 'confirmed' }), [], '2027-03-07', {
      functions: [{ ...fn, status: 'confirmed' }],
    });
    expect(h.past.at(-1)).toMatchObject({ kind: 'function', day: '2027-03-07' });
    expect(h.future).toEqual([]);
  });

  it('a moment falls on the reader\'s day: signed at 23:30 UTC is the next day in Madrid', () => {
    const h = history(bolo({ contract_signed_at: '2026-12-12T23:30:00Z' }), []);
    expect(h.past.find((e) => e.kind === 'contract_signed')?.day).toBe('2026-12-13');
    const ny = history(bolo({ contract_signed_at: '2026-12-12T23:30:00Z' }), [], TODAY, { timeZone: 'America/New_York' });
    expect(ny.past.find((e) => e.kind === 'contract_signed')?.day).toBe('2026-12-12');
  });

  it('opened and agreed the same day is one step: «agreed»', () => {
    const h = history(bolo({ created_at: '2026-11-28T08:00:00Z' }), []);
    expect(h.past.filter((e) => e.kind === 'opened' || e.kind === 'agreed').map((e) => e.kind)).toEqual(['agreed']);
  });

  it('agreed with no known date is not invented', () => {
    const h = history(bolo({ confirmed_at: null }), []);
    expect(h.past.some((e) => e.kind === 'agreed')).toBe(false);
    expect(h.past[0]?.kind).toBe('opened');
  });

  it('a contract not yet out is the first thing coming, without a date', () => {
    const h = history(bolo({ contract_sent_at: null, contract_signed_at: null }), [], '2027-01-10');
    expect(h.future[0]).toEqual({ kind: 'contract_unsent', day: null });
    expect(h.future.map((e) => e.kind)).toEqual(['contract_unsent', 'function']);
  });

  it('drafts and cancelled documents did not happen', () => {
    const h = history(bolo(), [invoice({ id: 'd', status: 'draft' }), invoice({ id: 'c', status: 'cancelled' })]);
    expect(h.past.some((e) => e.kind === 'invoice')).toBe(false);
    expect(h.past.some((e) => e.kind === 'due')).toBe(false);
  });

  it('collected in full: the payment is history and the line says so; nothing is due', () => {
    const paid = invoice({
      status: 'paid',
      paid_amount: 1800,
      payments: [{ id: 'pay', workspace_id: 'w', invoice_id: 'i', amount: 1800, received_on: '2027-04-02', method: 'transfer', reference: null, notes: null, created_at: '2027-04-02T10:00:00Z' }],
    });
    const h = history(bolo({ collected: 1800 }), [paid]);
    expect(h.now).toEqual({ kind: 'paid' });
    expect(h.past.map((e) => e.kind)).toContain('payment');
    expect(h.past.some((e) => e.kind === 'due')).toBe(false);
  });

  it('a payment anchored to the bolo (no invoice) is told once, in the bolo\'s currency', () => {
    const h = history(bolo({ collected: 500 }), [], TODAY, {
      boloPayments: [
        { id: 'x', amount: 500, received_on: '2027-03-08', method: 'cash' },
        { id: 'gone', amount: 99, received_on: '2027-03-08', method: 'cash', deleted_at: '2027-03-09T00:00:00Z' },
      ],
    });
    expect(h.past.filter((e) => e.kind === 'payment')).toEqual([
      { kind: 'payment', day: '2027-03-08', id: 'x', amount: 500, currency: 'EUR', method: 'cash', number: null },
    ]);
  });

  it('a cancelled deal says so on the line and asks for no contract', () => {
    const h = history(bolo({ status: 'cancelled', contract_sent_at: null, contract_signed_at: null }), []);
    expect(h.now).toEqual({ kind: 'cancelled' });
    expect(h.future.some((e) => e.kind === 'contract_unsent')).toBe(false);
  });
});
