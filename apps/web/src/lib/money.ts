/**
 * Money formatting + invoice tones — the single source for every money
 * surface (Money lens, line Money module, line header stats). Formerly
 * three drifting local copies: the lens omitted maximumFractionDigits
 * (allowed 3 decimals) and the line header showed 0 decimals while the
 * module showed 2 for the same figure.
 */

import * as v from 'valibot';
import { Constants, type Enums } from './db-types';

export type PaymentMethod = Enums<'payment_method'>;
export const PAYMENT_METHODS = Constants.public.Enums.payment_method;

/**
 * Money v3 (ADR-086 + ADR-087): a payment attaches to an invoice OR a scope
 * anchor (bolo / line / project) and carries an optional counterparty +
 * category. invoice_id is nullable now — the v2 path still passes it, the anchor
 * path omits it. The RPC enforces "an invoice or exactly one anchor".
 */
export const PaymentCreateSchema = v.object({
	invoice_id: v.optional(v.nullable(v.pipe(v.string(), v.uuid()))),
	amount: v.pipe(v.number(), v.minValue(0.01)),
	received_on: v.pipe(v.string(), v.isoDate()),
	method: v.picklist(PAYMENT_METHODS),
	reference: v.optional(v.nullable(v.pipe(v.string(), v.trim(), v.maxLength(200)))),
	notes: v.optional(v.nullable(v.pipe(v.string(), v.trim(), v.maxLength(2000)))),
	bolo_id: v.optional(v.nullable(v.pipe(v.string(), v.uuid()))),
	line_id: v.optional(v.nullable(v.pipe(v.string(), v.uuid()))),
	project_id: v.optional(v.nullable(v.pipe(v.string(), v.uuid()))),
	counterparty: v.optional(v.nullable(v.pipe(v.string(), v.trim(), v.maxLength(200)))),
	category: v.optional(v.nullable(v.pipe(v.string(), v.trim(), v.maxLength(60)))),
});

export type PaymentCreate = v.InferOutput<typeof PaymentCreateSchema>;

export interface PaymentItem {
	id: string;
	workspace_id: string;
	invoice_id: string;
	amount: number;
	received_on: string;
	method: PaymentMethod;
	reference: string | null;
	notes: string | null;
	created_at: string;
	deleted_at?: string | null;
}

export interface MoneyPayer {
	id: string;
	workspace_id: string;
	slug: string;
	full_name: string;
	organization_name: string | null;
}

/**
 * A document's tax breakdown is a list of generic, country-agnostic lines
 * (money v3 · grill 2026-07-23). Each is a signed rate: `add` (+IVA/TVA),
 * `withhold` (−IRPF), or `exempt` (0 + a legal reason). Spain is just a preset
 * (esTaxLines); France (TVA) plugs in as another preset with no model change.
 */
export type TaxLineKind = 'add' | 'withhold' | 'exempt';

export interface TaxLineInput {
	label: string;
	kind: TaxLineKind;
	rate_pct: number;
	exempt_reason?: string | null;
}

export interface InvoiceTaxLine extends TaxLineInput {
	id: string;
	base_amount: number;
	amount: number;
	ordinal: number;
}

/**
 * Signed contribution of one rate line over a base. Mirrors the SQL
 * round(base * rate / 100, 2) exactly: it works in integer base cents, because
 * a plain float base*rate undershoots a half-cent (e.g. 4.1*15 = 61.4999…) and
 * would round a cent low on the withhold path, drifting from the stored invoice.
 */
function taxLineAmount(base: number, line: TaxLineInput): number {
	if (line.kind === 'exempt') return 0;
	const baseCents = Math.round(base * 100);
	const magnitude = Math.round((baseCents * line.rate_pct) / 100) / 100;
	return line.kind === 'withhold' ? -magnitude : magnitude;
}

/** total = subtotal + Σ(signed line), snapped to cents; the pre-issue preview. */
export function applyTaxLines(subtotal: number, lines: TaxLineInput[]): number {
	const total = lines.reduce((sum, line) => sum + taxLineAmount(subtotal, line), subtotal);
	return Math.round(total * 100) / 100;
}

/**
 * Spain preset: turn the familiar IVA% / IRPF% inputs into generic tax lines.
 * The model never stores "IVA"/"IRPF" as columns — only these signed lines, so
 * France (TVA) or an exempt cross-border line are the same shape. A null/blank
 * percentage drops that line.
 */
export function esTaxLines(vatPct: number | null, irpfPct: number | null): TaxLineInput[] {
	const lines: TaxLineInput[] = [];
	if (vatPct != null) lines.push({ label: 'IVA', kind: 'add', rate_pct: vatPct });
	if (irpfPct != null) lines.push({ label: 'IRPF', kind: 'withhold', rate_pct: irpfPct });
	return lines;
}

export interface MoneyInvoiceItem {
	id: string;
	workspace_id: string;
	project_id: string | null;
	payer_person_id: string | null;
	number: string | null;
	status: string;
	issued_on: string;
	due_on: string | null;
	expected_on: string | null;
	payment_condition: string | null;
	subtotal: number;
	total: number;
	currency: string;
	country: string | null;
	tax_lines: InvoiceTaxLine[];
	notes: string | null;
	paid_amount: number;
	project: { id: string; slug: string; name: string; workspace_id: string } | null;
	payer: {
		id: string;
		slug: string;
		full_name: string;
		organization_name: string | null;
	} | null;
	lines: { bolo_id: string | null }[];
	payments: PaymentItem[];
}

export interface TermsInvoice {
	id: string;
	payer_person_id: string | null;
	issued_on: string;
	total: number;
}

export interface TermsPayment {
	invoice_id: string;
	amount: number;
	received_on: string;
	deleted_at?: string | null;
}

export interface ObservedPayerTerms {
	days: number;
	samples: number;
}

const DAY_MS = 86_400_000;

function dayMs(day: string): number {
	return Date.parse(`${day.slice(0, 10)}T00:00:00Z`);
}

function daysBetween(from: string, to: string): number {
	return Math.round((dayMs(to) - dayMs(from)) / DAY_MS);
}

function addDays(day: string, count: number): string {
	const result = new Date(dayMs(day));
	result.setUTCDate(result.getUTCDate() + count);
	return result.toISOString().slice(0, 10);
}

/**
 * Observed collection terms per payer. Only fully covered invoices count,
 * and at least two samples are required before Hour claims a pattern.
 */
export function observedPayerTermsDays(
	invoices: TermsInvoice[],
	payments: TermsPayment[],
): Map<string, ObservedPayerTerms> {
	const activeByInvoice = new Map<string, TermsPayment[]>();
	for (const payment of payments) {
		if (payment.deleted_at) continue;
		const bucket = activeByInvoice.get(payment.invoice_id) ?? [];
		bucket.push(payment);
		activeByInvoice.set(payment.invoice_id, bucket);
	}

	const samplesByPayer = new Map<string, number[]>();
	for (const invoice of invoices) {
		if (!invoice.payer_person_id) continue;
		const invoicePayments = activeByInvoice.get(invoice.id) ?? [];
		const paid = invoicePayments.reduce((sum, payment) => sum + Number(payment.amount), 0);
		if (paid < Number(invoice.total) || invoicePayments.length === 0) continue;
		const finalReceivedOn = invoicePayments
			.map((payment) => payment.received_on.slice(0, 10))
			.sort()
			.at(-1);
		if (!finalReceivedOn) continue;
		const days = Math.max(0, daysBetween(invoice.issued_on, finalReceivedOn));
		const bucket = samplesByPayer.get(invoice.payer_person_id) ?? [];
		bucket.push(days);
		samplesByPayer.set(invoice.payer_person_id, bucket);
	}

	const result = new Map<string, ObservedPayerTerms>();
	for (const [payerId, samples] of samplesByPayer) {
		if (samples.length < 2) continue;
		const sorted = [...samples].sort((a, b) => a - b);
		const middle = Math.floor(sorted.length / 2);
		const median =
			sorted.length % 2 === 1
				? sorted[middle]!
				: (sorted[middle - 1]! + sorted[middle]!) / 2;
		result.set(payerId, { days: median, samples: sorted.length });
	}
	return result;
}

export type AgingStateName = 'within' | 'approaching' | 'past-expected' | 'paid';
export type AgingSource = 'explicit' | 'observed' | 'due' | 'none';

export interface AgingInvoice extends TermsInvoice {
	status: string;
	due_on: string | null;
	expected_on: string | null;
	observed_terms_days?: number | null;
}

export interface InvoiceAgingState {
	expectedOn: string | null;
	expectedDays: number | null;
	daysRunning: number;
	paidAmount: number;
	state: AgingStateName;
	source: AgingSource;
}

/** Realistic invoice aging with an injected clock; no hidden wall-clock reads. */
export function agingState(
	invoice: AgingInvoice,
	payments: TermsPayment[],
	today: Date,
): InvoiceAgingState {
	const activePayments = payments.filter(
		(payment) => payment.invoice_id === invoice.id && !payment.deleted_at,
	);
	const paidAmount = activePayments.reduce(
		(sum, payment) => sum + Number(payment.amount),
		0,
	);
	const observedDays = invoice.observed_terms_days;
	const expectedOn = invoice.expected_on
		? invoice.expected_on.slice(0, 10)
		: observedDays != null
			? addDays(invoice.issued_on, Math.round(observedDays))
			: invoice.due_on?.slice(0, 10) ?? null;
	const source: AgingSource = invoice.expected_on
		? 'explicit'
		: observedDays != null
			? 'observed'
			: invoice.due_on
				? 'due'
				: 'none';
	const todayDay = today.toISOString().slice(0, 10);
	const daysRunning = Math.max(0, daysBetween(invoice.issued_on, todayDay));
	const expectedDays = expectedOn
		? Math.max(0, daysBetween(invoice.issued_on, expectedOn))
		: null;

	if (invoice.status === 'paid' || paidAmount >= Number(invoice.total)) {
		return { expectedOn, expectedDays, daysRunning, paidAmount, state: 'paid', source };
	}
	if (!expectedOn || expectedDays === null) {
		return { expectedOn, expectedDays, daysRunning, paidAmount, state: 'within', source };
	}
	if (todayDay > expectedOn) {
		return {
			expectedOn,
			expectedDays,
			daysRunning,
			paidAmount,
			state: 'past-expected',
			source,
		};
	}
	const daysLeft = daysBetween(todayDay, expectedOn);
	const approaching = daysLeft <= 14 || daysRunning >= expectedDays * 0.8;
	return {
		expectedOn,
		expectedDays,
		daysRunning,
		paidAmount,
		state: approaching ? 'approaching' : 'within',
		source,
	};
}

/**
 * Per-currency sums — never add EUR to USD. Sorted by currency code so
 * mixed-currency totals list in the same order on every surface.
 */
export function totalsByCurrency<T>(
	rows: readonly T[],
	currency: (row: T) => string,
	amount: (row: T) => number,
): [string, number][] {
	const map = new Map<string, number>();
	for (const row of rows) {
		const code = currency(row);
		map.set(code, (map.get(code) ?? 0) + amount(row));
	}
	return [...map.entries()].sort(([a], [b]) => a.localeCompare(b));
}

const money = new Intl.NumberFormat('en-GB', {
	minimumFractionDigits: 2,
	maximumFractionDigits: 2,
});

const moneyCompact = new Intl.NumberFormat('en-GB', {
	minimumFractionDigits: 0,
	maximumFractionDigits: 0,
});

/** "22,900.00" — bare full-form number (caller renders the currency). */
export function fmtMoney(amount: number): string {
	return money.format(amount);
}

/** "3,200.00 EUR" — full form for tables and totals. */
export function fmtFee(amount: number | null, currency: string | null): string {
	if (amount === null) return '—';
	return `${money.format(amount)} ${currency ?? 'EUR'}`;
}

/** "22,900" — whole-number form for header stats where decimals are noise. */
export function fmtMoneyCompact(amount: number): string {
	return moneyCompact.format(amount);
}

/** Invoice lifecycle → StateBadge tone. */
export function invoiceTone(status: string): 'neutral' | 'warning' | 'faint' | 'danger' {
	if (status === 'issued') return 'warning';
	if (status === 'paid') return 'faint';
	if (status === 'cancelled') return 'danger';
	return 'neutral';
}
