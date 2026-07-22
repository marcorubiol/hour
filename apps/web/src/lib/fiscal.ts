/**
 * Fiscal identity — the editable record behind money v3's Factura / Proforma
 * (ADR-086 · design Part B). The tax details of one legal party, owned softly
 * by an account (issuer) or a workspace (receiver). The *printed* subset is
 * `FiscalParty` in $lib/invoice; this is the full record the forms edit.
 *
 * Presentational contract only — no schema. money v3's `fiscal_identity`
 * table, `invoicing_mode` and the issuer wiring are the BUILD phase; this
 * module is the design made real so the build can feed it unchanged.
 */

export type InvoicingMode = 'off' | 'interno' | 'legal';
export type FiscalIdentityKind = 'issuer' | 'receiver';
/** account = the account's default identity issues; override = this workspace's. */
export type IssuerWiring = 'account' | 'override';

export interface FiscalIdentity {
	id: string;
	kind: FiscalIdentityKind;
	/** Distinguishes "MüK SL" from "María freelance". */
	label: string;
	legal_name: string;
	tax_id: string;
	address_line_1: string;
	address_line_2?: string | null;
	postal_code: string;
	city: string;
	region?: string | null;
	country: string;
	/** Issuer-only — a receiver is asymmetric (no banking, no defaults). */
	iban?: string | null;
	swift_bic?: string | null;
	default_vat_pct?: number | null;
	default_irpf_pct?: number | null;
	/** Receiver-only — a bare name with no fiscal data (interno / off modes). */
	bare?: boolean;
	archived?: boolean;
}

export interface InvoicingModeInfo {
	id: InvoicingMode;
	title: string;
	consequence: string;
}

/** The three modes, same shape as `booking_mode` (ADR-086 D1). */
export const INVOICING_MODES: InvoicingModeInfo[] = [
	{
		id: 'off',
		title: 'Desactivat',
		consequence:
			'No s’emet cap document. Money registra només diners — cachés, pagaments i despeses.',
	},
	{
		id: 'interno',
		title: 'Intern · Proforma',
		consequence:
			'Hour emet Proformes amb numeració pròpia. La factura legal s’emet fora. No cal la fiscalitat del receptor.',
	},
	{
		id: 'legal',
		title: 'Legal · Factura',
		consequence:
			'Hour és el sistema de facturació: emet Factures amb validesa fiscal. Cal la fiscalitat de l’emissor i del receptor.',
	},
];

// Loose format checks — the authoritative validation lives server-side in the
// build. Empty passes here; required-ness is enforced on save.
const TAX_ID = /^[A-Za-z]{0,2}[-\s]?[0-9A-Za-z]{7,10}$/;

export function isValidTaxId(value: string): boolean {
	const v = value.trim();
	return v === '' || TAX_ID.test(v);
}

export function isValidIban(value: string): boolean {
	const v = value.replace(/\s/g, '');
	if (v === '') return true;
	return /^[A-Za-z]{2}[0-9]{2}[0-9A-Za-z]{11,30}$/.test(v);
}
