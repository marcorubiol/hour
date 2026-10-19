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
type FiscalIdentityKind = 'issuer' | 'receiver';

interface InvoicingModeInfo {
	id: InvoicingMode;
	title: string;
	consequence: string;
}

// Loose format checks — the authoritative validation lives server-side in the
// build. Empty passes here; required-ness is enforced on save.
const TAX_ID = /^[A-Za-z]{0,2}[-\s]?[0-9A-Za-z]{7,10}$/;

/**
 * A receiver's fiscal data as `set_organization_fiscal_identity` writes it
 * (ADR-102 phase 2b): what a factura prints for the payer. Every field is
 * written; a blank one clears it. `legal_name` is required.
 */
export const RECEIVER_FISCAL_FIELDS = [
	'legal_name',
	'tax_id',
	'address_line_1',
	'address_line_2',
	'postal_code',
	'city',
	'region',
	'country',
] as const;
type ReceiverFiscalField = (typeof RECEIVER_FISCAL_FIELDS)[number];
export type ReceiverFiscal = Record<ReceiverFiscalField, string | null>;

/**
 * GET /api/organizations/[id]/fiscal. `fiscal` is null when the organization
 * has none, or when the caller cannot read money (RLS on fiscal_identity).
 */
export interface OrganizationFiscalResponse {
	organization: { id: string; workspace_id: string; name: string };
	fiscal: (ReceiverFiscal & { id: string }) | null;
	can_edit: boolean;
}

/** One line for a receiver: legal name · tax id · city. */
export function receiverFiscalSummary(f: Pick<ReceiverFiscal, 'legal_name' | 'tax_id' | 'city'>): string {
	return [f.legal_name, f.tax_id, f.city].filter((x) => x && x.trim()).join(' · ');
}
