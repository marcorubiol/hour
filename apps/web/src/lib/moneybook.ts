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
type MoneyAnchor = 'gig' | 'line' | 'project';

/** A gig's fee — the anchor of money v3. */
interface FeeRow {
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

type FeeStatus = 'unpaid' | 'partial' | 'full';

const CURRENCY: Record<string, { symbol: string; name: string }> = {
	EUR: { symbol: '€', name: 'Euro' },
	GBP: { symbol: '£', name: 'Lliura esterlina' },
	USD: { symbol: '$', name: 'Dòlar' },
};

