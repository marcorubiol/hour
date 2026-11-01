/**
 * The quarter for the gestoría (ADR-168): the facturas issued and the
 * payments received in one calendar quarter, as a CSV a Spanish gestoría
 * opens in Excel or imports into its accounting.
 *
 * The server (`/api/money/quarter`) gathers the rows under the caller's RLS;
 * this module is the pure part: which quarter, and how the rows become a
 * file. The format is the Spanish spreadsheet's own: `;` between columns
 * (Excel in Spanish reads `,` as the decimal mark), decimal comma, dates
 * dd/mm/aaaa, UTF-8 with a BOM so accents survive Excel.
 *
 * One row per factura (the libro registro de facturas emitidas: fecha,
 * número, cliente, NIF, base, IVA, IRPF, total) carrying its collection
 * state, then one row per payment received in the quarter (what IVA de caja
 * and the cash view need, including fees collected without a factura).
 * Proformas never go: they are not fiscal documents (ADR-162).
 */

export interface QuarterTaxLine {
  kind: 'add' | 'withhold' | 'exempt';
  rate_pct: number;
  base_amount: number;
  amount: number;
}

export interface QuarterInvoice {
  id: string;
  number: string | null;
  status: string;
  issued_on: string;
  subtotal: number;
  total: number;
  currency: string;
  client: string | null;
  tax_id: string | null;
  tax_lines: QuarterTaxLine[];
  /** Every live payment of the invoice, of any date: its collection state. */
  payments: { amount: number; received_on: string }[];
}

export interface QuarterPayment {
  id: string;
  received_on: string;
  amount: number;
  currency: string;
  invoice_number: string | null;
  client: string | null;
  tax_id: string | null;
}

export interface QuarterData {
  invoices: QuarterInvoice[];
  payments: QuarterPayment[];
}

/** A quarter as `2026-3`: year and 1..4. */
export interface Quarter {
  year: number;
  q: 1 | 2 | 3 | 4;
}

export function quarterOf(day: string): Quarter {
  const year = Number(day.slice(0, 4));
  const month = Number(day.slice(5, 7));
  return { year, q: (Math.floor((month - 1) / 3) + 1) as Quarter['q'] };
}

export function previousQuarter({ year, q }: Quarter): Quarter {
  return q === 1 ? { year: year - 1, q: 4 } : { year, q: (q - 1) as Quarter['q'] };
}

/** First and last day, ISO. */
export function quarterRange({ year, q }: Quarter): { from: string; to: string } {
  const first = (q - 1) * 3 + 1;
  const last = first + 2;
  const lastDay = new Date(Date.UTC(year, last, 0)).getUTCDate();
  const mm = (m: number) => String(m).padStart(2, '0');
  return { from: `${year}-${mm(first)}-01`, to: `${year}-${mm(last)}-${lastDay}` };
}

/**
 * The quarter the export opens on. In the first month of a quarter the one
 * that matters is the one just closed (the declarations fall due in the first
 * twenty days); after that, the running one.
 */
export function defaultQuarter(today: string): Quarter {
  const current = quarterOf(today);
  const month = Number(today.slice(5, 7));
  return (month - 1) % 3 === 0 ? previousQuarter(current) : current;
}

/** The quarters to offer, newest first, starting at the running one. */
export function recentQuarters(today: string, count = 8): Quarter[] {
  const out: Quarter[] = [quarterOf(today)];
  while (out.length < count) out.push(previousQuarter(out[out.length - 1]!));
  return out;
}

export function quarterKey({ year, q }: Quarter): string {
  return `${year}-${q}`;
}

export function parseQuarterKey(key: string): Quarter | null {
  const m = /^(\d{4})-([1-4])$/.exec(key);
  return m ? { year: Number(m[1]), q: Number(m[2]) as Quarter['q'] } : null;
}

// ── The file ─────────────────────────────────────────────────────────────

export type CollectionState = 'paid' | 'partial' | 'pending' | 'cancelled';

export function collectionState(inv: Pick<QuarterInvoice, 'status' | 'total' | 'payments'>): CollectionState {
  if (inv.status === 'cancelled') return 'cancelled';
  const paid = inv.payments.reduce((sum, p) => sum + Number(p.amount), 0);
  if (inv.status === 'paid' || (paid > 0 && paid + 0.005 >= Number(inv.total))) return 'paid';
  return paid > 0 ? 'partial' : 'pending';
}

/** 1234.5 → «1234,50». No thousands mark: a gestoría's import reads it as text. */
export function csvAmount(n: number): string {
  return (Math.round(n * 100) / 100).toFixed(2).replace('.', ',');
}

function csvRate(n: number): string {
  return String(Math.round(n * 100) / 100).replace('.', ',');
}

/** 2026-07-14 → «14/07/2026». */
export function csvDate(day: string): string {
  return `${day.slice(8, 10)}/${day.slice(5, 7)}/${day.slice(0, 4)}`;
}

/** A field, quoted when it carries the separator, a quote or a line break. */
export function csvField(value: string | null | undefined): string {
  const s = value ?? '';
  return /[";\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** The labels the file is written with, in the person's language. */
export interface QuarterCsvLabels {
  headers: readonly string[];
  invoice: string;
  payment: string;
  exempt: string;
  state: Record<CollectionState, string>;
}

/** The column order. `headers` in the labels follows it. */
export const QUARTER_COLUMNS = [
  'type',
  'date',
  'number',
  'client',
  'tax_id',
  'base',
  'vat_rate',
  'vat',
  'irpf_rate',
  'irpf',
  'total',
  'currency',
  'collected',
  'collection',
  'last_collected_on',
] as const;

function rates(lines: QuarterTaxLine[]): string {
  return [...new Set(lines.map((l) => csvRate(Number(l.rate_pct))))].join('+');
}

function invoiceRow(inv: QuarterInvoice, labels: QuarterCsvLabels): string[] {
  const vat = inv.tax_lines.filter((l) => l.kind === 'add');
  const exempt = inv.tax_lines.some((l) => l.kind === 'exempt');
  const irpf = inv.tax_lines.filter((l) => l.kind === 'withhold');
  const collected = inv.payments.reduce((sum, p) => sum + Number(p.amount), 0);
  const last = inv.payments.map((p) => p.received_on).sort().at(-1) ?? null;
  return [
    labels.invoice,
    csvDate(inv.issued_on),
    inv.number ?? '',
    inv.client ?? '',
    inv.tax_id ?? '',
    csvAmount(Number(inv.subtotal)),
    vat.length > 0 ? rates(vat) : exempt ? labels.exempt : '',
    csvAmount(vat.reduce((sum, l) => sum + Math.abs(Number(l.amount)), 0)),
    irpf.length > 0 ? rates(irpf) : '',
    irpf.length > 0 ? csvAmount(irpf.reduce((sum, l) => sum + Math.abs(Number(l.amount)), 0)) : '',
    csvAmount(Number(inv.total)),
    inv.currency,
    csvAmount(collected),
    labels.state[collectionState(inv)],
    last ? csvDate(last) : '',
  ];
}

function paymentRow(p: QuarterPayment, labels: QuarterCsvLabels): string[] {
  return [
    labels.payment,
    csvDate(p.received_on),
    p.invoice_number ?? '',
    p.client ?? '',
    p.tax_id ?? '',
    '',
    '',
    '',
    '',
    '',
    '',
    p.currency,
    csvAmount(Number(p.amount)),
    '',
    '',
  ];
}

const BOM = '﻿';

/** The whole file: header, facturas by date and number, then payments by date. */
export function quarterCsv(data: QuarterData, labels: QuarterCsvLabels): string {
  const invoices = [...data.invoices].sort(
    (a, b) => a.issued_on.localeCompare(b.issued_on) || (a.number ?? '').localeCompare(b.number ?? ''),
  );
  const payments = [...data.payments].sort((a, b) => a.received_on.localeCompare(b.received_on));
  const rows = [
    [...labels.headers],
    ...invoices.map((inv) => invoiceRow(inv, labels)),
    ...payments.map((p) => paymentRow(p, labels)),
  ];
  return BOM + rows.map((r) => r.map(csvField).join(';')).join('\r\n') + '\r\n';
}

export function quarterFileName({ year, q }: Quarter): string {
  return `hour-${year}-T${q}.csv`;
}
