/**
 * Invoice document — the printable Factura/Proforma projection (ADR-086,
 * money v3 · design Part A). Presentational contract only.
 *
 * A real invoice freezes its issuer + receiver as a snapshot (ADR-050), so
 * the document is drawn from already-frozen display values, never a live
 * join. Nothing here touches the schema: money v3's tables (`fiscal_identity`,
 * the proforma type, the numbering series) are the BUILD phase. This module
 * is the design made real as a typed view, so the build can feed it unchanged.
 */

/** Snapshot of one legal party as printed on the document. */
export interface FiscalParty {
	legal_name: string;
	tax_id: string;
	address_line_1: string;
	address_line_2?: string | null;
	postal_code: string;
	city: string;
	region?: string | null;
	country: string;
	/** Issuer-only; a receiver identity is asymmetric — no banking (ADR-086 D6). */
	iban?: string | null;
	swift_bic?: string | null;
}

export interface InvoiceLine {
	/** Auto description parts → "Project — Venue, City — date" (ADR-050). */
	project: string;
	venue: string;
	city: string;
	/** Display-ready date string; the snapshot froze it. */
	date: string;
	qty: number;
	unit: number;
}

/** legal = Factura (full legal doc); interno = Proforma (own numbering). */
export type InvoiceMode = 'legal' | 'interno';
export type InvoiceStatus = 'draft' | 'issued' | 'paid';

export interface InvoiceDoc {
	mode: InvoiceMode;
	status: InvoiceStatus;
	/** Correlative number, assigned at issue; null while draft. */
	number: string | null;
	/** Display-ready date strings, frozen on the snapshot. */
	issue_date: string;
	due_date: string;
	expected_period: string;
	paid_date?: string | null;
	issuer: FiscalParty;
	/** Always a name; structured details only when legal — bare in proforma. */
	receiver_name: string;
	receiver: FiscalParty | null;
	lines: InvoiceLine[];
	vat_pct: number | null;
	irpf_pct: number | null;
	currency: string;
	payment_terms: string;
	legal_note: string;
	/** Bank-transfer concept line; falls back to the number. */
	payment_reference?: string | null;
	/** Issuer identity mark — accent as a CSS value + monogram. */
	issuer_accent: string;
	issuer_initials: string;
}

export interface InvoiceTotals {
	subtotal: number;
	vat: number;
	irpf: number;
	total: number;
}

/** Spanish fiscal form: total = subtotal + VAT − IRPF (ADR-050). */
export function invoiceTotals(doc: InvoiceDoc): InvoiceTotals {
	const subtotal = doc.lines.reduce((sum, line) => sum + line.qty * line.unit, 0);
	const vat = doc.vat_pct ? (subtotal * doc.vat_pct) / 100 : 0;
	const irpf = doc.irpf_pct ? (subtotal * doc.irpf_pct) / 100 : 0;
	return { subtotal, vat, irpf, total: subtotal + vat - irpf };
}

/** Structured address → the two printed lines (street, locality). */
export function addressLines(party: FiscalParty): [string, string] {
	const street = party.address_line_2
		? `${party.address_line_1}, ${party.address_line_2}`
		: party.address_line_1;
	const locality = [party.postal_code, party.city, party.region, party.country]
		.filter(Boolean)
		.join(' · ');
	return [street, locality];
}
