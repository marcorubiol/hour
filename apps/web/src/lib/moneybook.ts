/**
 * Money book (size A) — the presentational view types behind money v3's Money
 * lens (ADR-086 · design Part C). The fee is the anchor; "collected" is derived
 * from payments-against-fee, never from an invoice. Invoicing is optional and
 * mode-driven; expenses are money out. Currencies are never summed together.
 *
 * Presentational only — no schema. The wired money v2 types live in $lib/money;
 * this is the v3 view the BUILD will feed real data into. Formatting reuses
 * fmtMoney / fmtFee (money.ts) as the single money formatter.
 */

import type { InvoicingMode } from './fiscal';
export type { InvoicingMode };

/** Where a payment or expense is anchored. */
export type MoneyAnchor = 'gig' | 'line' | 'project';

/** A gig's fee — the anchor of money v3. */
export interface FeeRow {
	id: string;
	date: string; // display-ready
	venue: string;
	city: string;
	currency: string;
	fee: number;
	/** Derived from payments-against-fee, independent of any invoice. */
	collected: number;
	/** Invoice number when a document references this fee; null otherwise. */
	doc: string | null;
}

export interface ExpenseRow {
	id: string;
	date: string;
	description: string;
	category: string;
	counterparty: string | null;
	currency: string;
	amount: number;
}

export interface InvoiceDocRow {
	id: string;
	number: string;
	for_text: string;
	currency: string;
	subtotal: number;
	vat_pct: number;
	irpf_pct: number;
	issue_date: string;
	due_date: string;
	payer_name: string;
	payer_tax_id: string;
}

export type FeeStatus = 'unpaid' | 'partial' | 'full';

export function feeStatus(fee: FeeRow): FeeStatus {
	if (fee.collected <= 0) return 'unpaid';
	if (fee.collected >= fee.fee) return 'full';
	return 'partial';
}

/** What the Record-payment dialog hands back (ADR-086 D3). */
export interface PaymentDraft {
	fee_id: string | null;
	amount: number;
	currency: string;
	received_on: string;
	method: string;
	anchor: MoneyAnchor;
	counterparty: string;
	category: string;
	reference: string;
	/** Nullable — a payment usually links to no document. */
	invoice_id: string | null;
}

/** What the Add-expense dialog hands back. */
export interface ExpenseDraft {
	amount: number;
	currency: string;
	description: string;
	date: string;
	category: string;
	anchor: MoneyAnchor;
	counterparty: string | null;
}

const CURRENCY: Record<string, { symbol: string; name: string }> = {
	EUR: { symbol: '€', name: 'Euro' },
	GBP: { symbol: '£', name: 'Lliura esterlina' },
	USD: { symbol: '$', name: 'Dòlar' },
};

export function currencySymbol(code: string): string {
	return CURRENCY[code]?.symbol ?? code;
}
export function currencyName(code: string): string {
	return CURRENCY[code]?.name ?? code;
}
