/**
 * The printable proforma (ADR-162): what the page of one proforma reads and
 * the pure rules that turn it into a document. The server
 * (`/api/invoices/:id/proforma`) gathers it under the caller's RLS; the page
 * (`/proforma/:id`) draws it and the browser prints or saves the PDF.
 *
 * Only proformas. A factura that has been issued sits next to Verifactu
 * (ADR-087): printing one is a fiscal act with its own rules, not a page.
 *
 * Nothing here invents a party. A field that is not on record comes back as
 * missing, and the page says so in a discreet gap that never prints.
 */

/** The printed subset of a fiscal identity: `fiscal_identity_snapshot`'s shape. */
export interface FiscalPrint {
  legal_name: string | null;
  tax_id: string | null;
  address_line_1: string | null;
  address_line_2: string | null;
  postal_code: string | null;
  city: string | null;
  region: string | null;
  country: string | null;
  iban: string | null;
  swift_bic: string | null;
}

export const FISCAL_PRINT_FIELDS = [
  'legal_name',
  'tax_id',
  'address_line_1',
  'address_line_2',
  'postal_code',
  'city',
  'region',
  'country',
  'iban',
  'swift_bic',
] as const;

/**
 * Where a party stands: on record, not set up anywhere, or set up but not
 * readable by this person (an account's issuer is read by its admins only).
 */
export type PartyState = 'ok' | 'none' | 'hidden';

export interface ProformaParty {
  state: PartyState;
  /** The name to print when there is no fiscal record (the space, the organization). */
  name: string | null;
  fiscal: FiscalPrint | null;
}

export interface ProformaLine {
  description: string;
  quantity: number;
  unit_amount: number;
  line_total: number;
}

export interface ProformaTaxLine {
  id: string;
  label: string;
  kind: 'add' | 'withhold' | 'exempt';
  rate_pct: number;
  base_amount: number;
  amount: number;
  exempt_reason: string | null;
  ordinal: number;
}

export interface ProformaDocument {
  id: string;
  number: string | null;
  status: string;
  issued_on: string;
  due_on: string | null;
  payment_condition: string | null;
  notes: string | null;
  currency: string;
  subtotal: number;
  total: number;
  project: { name: string } | null;
  /** The space that bills: where its issuer data is completed (ADR-168). */
  workspace_slug: string | null;
  issuer: ProformaParty;
  payer: ProformaParty;
  lines: ProformaLine[];
  tax_lines: ProformaTaxLine[];
}

/** The fields a party needs for the document to be complete. */
export const REQUIRED_FISCAL: readonly (keyof FiscalPrint)[] = [
  'legal_name',
  'tax_id',
  'address_line_1',
  'postal_code',
  'city',
];

function filled(value: string | null | undefined): value is string {
  return typeof value === 'string' && value.trim() !== '';
}

/** The required fields this party lacks; all of them when there is no record. */
export function missingFields(party: Pick<ProformaParty, 'fiscal'>): (keyof FiscalPrint)[] {
  return REQUIRED_FISCAL.filter((field) => !filled(party.fiscal?.[field]));
}

/**
 * A party as the lines a document prints, in the order an address is read:
 * name, tax id, street, postcode and city, region and country. Blank fields
 * leave no line and no stray separator.
 */
export function partyLines(party: Pick<ProformaParty, 'name' | 'fiscal'>): string[] {
  const f = party.fiscal;
  const name = filled(f?.legal_name) ? f.legal_name : party.name;
  const join = (parts: (string | null | undefined)[], sep: string) => parts.filter(filled).join(sep);
  return [
    name,
    f?.tax_id,
    f?.address_line_1,
    f?.address_line_2,
    f ? join([f.postal_code, f.city], ' ') : null,
    f ? join([f.region, f.country], ', ') : null,
  ].filter(filled);
}

/**
 * Where to complete the issuer, when the issuer is what has the gap: the
 * space's Ajustes › Espacio, the fiscal block (ADR-168). Null when nothing is
 * missing, when the data exists but this reader cannot see it, or when the
 * proforma is issued (its snapshot is frozen: completing the space would not
 * change it).
 */
export function issuerFixHref(doc: Pick<ProformaDocument, 'issuer' | 'workspace_slug' | 'status'>): string | null {
  if (!doc.workspace_slug || doc.status !== 'draft') return null;
  if (doc.issuer.state === 'hidden') return null;
  if (doc.issuer.state === 'ok' && missingFields(doc.issuer).length === 0) return null;
  return `/h/${encodeURIComponent(doc.workspace_slug)}/settings?section=space#fiscal`;
}

/** Taxes in the order the document keeps them. */
export function orderedTaxes(lines: readonly ProformaTaxLine[]): ProformaTaxLine[] {
  return [...lines].sort((a, b) => a.ordinal - b.ordinal);
}

/** Pick the printed subset off any row (a snapshot, a fiscal_identity row). */
export function toFiscalPrint(row: unknown): FiscalPrint | null {
  if (!row || typeof row !== 'object') return null;
  const source = row as Record<string, unknown>;
  const out = {} as FiscalPrint;
  for (const field of FISCAL_PRINT_FIELDS) {
    const value = source[field];
    out[field] = typeof value === 'string' ? value : null;
  }
  return out;
}

/**
 * One party from what the server found. A frozen snapshot wins (an issued
 * proforma prints what it was issued with); then the live record; then,
 * with a pointer but no row, the record exists and this reader cannot see it.
 */
export function resolveParty(input: {
  snapshot: unknown;
  pointer: string | null | undefined;
  row: unknown;
  name: string | null | undefined;
}): ProformaParty {
  const name = input.name ?? null;
  const snapshot = toFiscalPrint(input.snapshot);
  if (snapshot) return { state: 'ok', name, fiscal: snapshot };
  const row = toFiscalPrint(input.row);
  if (row) return { state: 'ok', name, fiscal: row };
  return { state: input.pointer ? 'hidden' : 'none', name, fiscal: null };
}
