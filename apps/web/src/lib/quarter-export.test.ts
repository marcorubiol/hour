import { describe, expect, it } from 'vitest';
import {
  QUARTER_COLUMNS,
  collectionState,
  csvAmount,
  csvDate,
  csvField,
  defaultQuarter,
  parseQuarterKey,
  quarterCsv,
  quarterRange,
  recentQuarters,
  type QuarterCsvLabels,
  type QuarterInvoice,
} from './quarter-export';

const labels: QuarterCsvLabels = {
  headers: QUARTER_COLUMNS,
  invoice: 'Factura',
  payment: 'Cobro',
  exempt: 'exenta',
  state: { paid: 'Cobrada', partial: 'Parcial', pending: 'Pendiente', cancelled: 'Anulada' },
};

const inv = (over: Partial<QuarterInvoice> = {}): QuarterInvoice => ({
  id: 'i1',
  number: 'F-2026-007',
  status: 'issued',
  issued_on: '2026-07-14',
  subtotal: 2000,
  total: 2120,
  currency: 'EUR',
  client: 'Teatre Lliure; Fundació',
  tax_id: 'G08888888',
  tax_lines: [
    { kind: 'add', rate_pct: 21, base_amount: 2000, amount: 420 },
    { kind: 'withhold', rate_pct: 15, base_amount: 2000, amount: -300 },
  ],
  payments: [],
  ...over,
});

describe('quarters', () => {
  it('spans the calendar quarter', () => {
    expect(quarterRange({ year: 2026, q: 1 })).toEqual({ from: '2026-01-01', to: '2026-03-31' });
    expect(quarterRange({ year: 2024, q: 1 }).to).toBe('2024-03-31');
    expect(quarterRange({ year: 2026, q: 3 })).toEqual({ from: '2026-07-01', to: '2026-09-30' });
    expect(quarterRange({ year: 2026, q: 4 })).toEqual({ from: '2026-10-01', to: '2026-12-31' });
  });

  it('opens on the quarter just closed during the first month of the next', () => {
    expect(defaultQuarter('2026-11-01')).toEqual({ year: 2026, q: 4 });
    expect(defaultQuarter('2026-10-15')).toEqual({ year: 2026, q: 3 });
    expect(defaultQuarter('2026-01-10')).toEqual({ year: 2025, q: 4 });
    expect(defaultQuarter('2026-08-20')).toEqual({ year: 2026, q: 3 });
  });

  it('offers the running quarter and the ones before it', () => {
    expect(recentQuarters('2026-02-01', 3)).toEqual([
      { year: 2026, q: 1 },
      { year: 2025, q: 4 },
      { year: 2025, q: 3 },
    ]);
    expect(parseQuarterKey('2026-3')).toEqual({ year: 2026, q: 3 });
    expect(parseQuarterKey('2026-5')).toBeNull();
  });
});

describe('the file', () => {
  it('writes amounts, dates and fields the Spanish spreadsheet way', () => {
    expect(csvAmount(1234.5)).toBe('1234,50');
    expect(csvDate('2026-07-14')).toBe('14/07/2026');
    expect(csvField('a;b')).toBe('"a;b"');
    expect(csvField('dice "hola"')).toBe('"dice ""hola"""');
    expect(csvField('Sala')).toBe('Sala');
    expect(csvField(null)).toBe('');
  });

  it('knows how far a factura is collected', () => {
    expect(collectionState(inv())).toBe('pending');
    expect(collectionState(inv({ payments: [{ amount: 1000, received_on: '2026-08-01' }] }))).toBe('partial');
    expect(collectionState(inv({ payments: [{ amount: 2120, received_on: '2026-08-01' }] }))).toBe('paid');
    expect(collectionState(inv({ status: 'cancelled' }))).toBe('cancelled');
  });

  it('puts one row per factura, then one per payment, with a BOM and CRLF', () => {
    const csv = quarterCsv(
      {
        invoices: [inv({ payments: [{ amount: 2120, received_on: '2026-08-03' }] })],
        payments: [
          {
            id: 'p1',
            received_on: '2026-08-03',
            amount: 2120,
            currency: 'EUR',
            invoice_number: 'F-2026-007',
            client: 'Teatre Lliure; Fundació',
            tax_id: 'G08888888',
          },
        ],
      },
      labels,
    );
    expect(csv.startsWith('﻿')).toBe(true);
    const rows = csv.slice(1).trimEnd().split('\r\n');
    expect(rows).toHaveLength(3);
    expect(rows[0]).toBe(QUARTER_COLUMNS.join(';'));
    expect(rows[1]).toBe(
      'Factura;14/07/2026;F-2026-007;"Teatre Lliure; Fundació";G08888888;2000,00;21;420,00;15;300,00;2120,00;EUR;2120,00;Cobrada;03/08/2026',
    );
    expect(rows[2]).toBe('Cobro;03/08/2026;F-2026-007;"Teatre Lliure; Fundació";G08888888;;;;;;;EUR;2120,00;;');
  });

  it('marks an exempt factura and leaves IRPF blank when there is none', () => {
    const csv = quarterCsv(
      {
        invoices: [
          inv({ client: 'Sala', tax_lines: [{ kind: 'exempt', rate_pct: 0, base_amount: 2000, amount: 0 }], total: 2000 }),
        ],
        payments: [],
      },
      labels,
    );
    const row = csv.slice(1).trimEnd().split('\r\n')[1]!.split(';');
    expect(row[QUARTER_COLUMNS.indexOf('vat_rate')]).toBe('exenta');
    expect(row[QUARTER_COLUMNS.indexOf('irpf_rate')]).toBe('');
    expect(row[QUARTER_COLUMNS.indexOf('irpf')]).toBe('');
  });
});
