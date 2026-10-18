/**
 * Money formatting + invoice tones — the single source for every money
 * surface (Money lens, line Money module, line header stats). Formerly
 * three drifting local copies: the lens omitted maximumFractionDigits
 * (allowed 3 decimals) and the line header showed 0 decimals while the
 * module showed 2 for the same figure.
 */

import * as v from 'valibot';
import { Constants, type Enums } from './db-types';
import { t, type Locale } from './i18n';

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
	// Client-generated, stable per intended payment — create_payment dedups on
	// it so a double-submit / two-tab race records one payment, not two.
	idempotency_key: v.optional(v.nullable(v.pipe(v.string(), v.uuid()))),
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

/**
 * Who an invoice can go to: an organization of a conversation the caller sees
 * (ADR-102 decision 5, `list_money_payer_organizations`). `has_fiscal_identity`
 * says whether a factura can be issued to it.
 */
export interface MoneyPayer {
	id: string;
	workspace_id: string;
	slug: string;
	name: string;
	has_fiscal_identity: boolean;
}

/** An invoice's payer as the invoice feed embeds it: the organization. */
export interface InvoicePayer {
	id: string;
	slug: string;
	name: string;
	fiscal_identity_id: string | null;
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
	payer_organization_id: string | null;
	payer_fiscal_identity_id: string | null;
	doc_type: 'factura' | 'proforma';
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
	payer: InvoicePayer | null;
	lines: { bolo_id: string | null }[];
	payments: PaymentItem[];
}

export interface TermsInvoice {
	id: string;
	payer_organization_id: string | null;
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
		if (!invoice.payer_organization_id) continue;
		const invoicePayments = activeByInvoice.get(invoice.id) ?? [];
		const paid = invoicePayments.reduce((sum, payment) => sum + Number(payment.amount), 0);
		if (paid < Number(invoice.total) || invoicePayments.length === 0) continue;
		const finalReceivedOn = invoicePayments
			.map((payment) => payment.received_on.slice(0, 10))
			.sort()
			.at(-1);
		if (!finalReceivedOn) continue;
		const days = Math.max(0, daysBetween(invoice.issued_on, finalReceivedOn));
		const bucket = samplesByPayer.get(invoice.payer_organization_id) ?? [];
		bucket.push(days);
		samplesByPayer.set(invoice.payer_organization_id, bucket);
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

/**
 * Whether a draft carries its payer's fiscal data into `issue_invoice`, which
 * freezes `payer_fiscal_identity_id` and nothing else:
 *  - `ready`: the draft has a receiver identity;
 *  - `stale`: the organization has one the draft does not (added after the
 *    draft was made): setting the payer again picks it up;
 *  - `missing`: the organization has none yet;
 *  - `no_payer`: the draft has no payer organization.
 */
export type PayerFiscalState = 'ready' | 'stale' | 'missing' | 'no_payer';

export function payerFiscalState(
	invoice: Pick<MoneyInvoiceItem, 'payer_fiscal_identity_id' | 'payer'>,
): PayerFiscalState {
	if (invoice.payer_fiscal_identity_id) return 'ready';
	if (!invoice.payer) return 'no_payer';
	return invoice.payer.fiscal_identity_id ? 'stale' : 'missing';
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

/** A dictionary word for `books.<prefix><value>`, or the raw value if none. */
function wordOr(key: string, locale: Locale, fallback: string): string {
	const out = t(key, locale);
	return out === key ? fallback : out;
}

/** A bolo's status in the session's language ("hold 1", "confirmed"…). */
export function boloStatusLabel(status: string, locale: Locale): string {
	return wordOr(`books.status_${status}`, locale, status.replace(/_/g, ' '));
}

/** An invoice's lifecycle word (draft · issued · paid · cancelled). */
export function invoiceStatusLabel(status: string, locale: Locale): string {
	return wordOr(`books.inv_status_${status}`, locale, status);
}

/** How a payment came in (Transfer · Card · Cash · Other). */
export function paymentMethodLabel(method: string, locale: Locale): string {
	return wordOr(`books.method_${method}`, locale, method);
}

/** Invoice lifecycle → StateBadge tone. */
export function invoiceTone(status: string): 'neutral' | 'warning' | 'faint' | 'danger' {
	if (status === 'issued') return 'warning';
	if (status === 'paid') return 'faint';
	if (status === 'cancelled') return 'danger';
	return 'neutral';
}

/**
 * EL EMBUDO DE UN TRATO (ADR-087) — dónde puede nacer y adónde puede moverse.
 *
 * `bolo.status` comparte enum con `performance`, y ahí dentro hay dos palabras
 * que NO son suyas: `invoiced` y `paid`. Money v3 deriva lo cobrado de los
 * pagos contra el caché, no de esta columna, así que dejar que alguien las
 * escriba a mano crearía un segundo sitio donde vive la verdad del dinero.
 *
 * Y `cancelled`/`done` no son estados de nacimiento: un trato no se abre
 * muerto ni acabado.
 *
 * Estas dos listas son el ESPEJO de `bolo_status_can_open` /
 * `bolo_status_can_move` en la base (`20260829140000`). La base es la
 * autoridad —la API no es la única puerta— y esto está aquí para dar un 400
 * honesto antes de cruzar la red, y para que el desplegable de una pantalla no
 * tenga que inventarse la lista.
 */
export const BOLO_OPEN_STATUSES = [
  'proposed',
  'hold',
  'hold_1',
  'hold_2',
  'hold_3',
  'confirmed',
] as const;

export const BOLO_MOVE_STATUSES = [...BOLO_OPEN_STATUSES, 'cancelled', 'done'] as const;

export type BoloOpenStatus = (typeof BOLO_OPEN_STATUSES)[number];
export type BoloMoveStatus = (typeof BOLO_MOVE_STATUSES)[number];

// ── El radar de cobro de Cuentas (ADR-117) ──────────────────────────────────
//
// Todo lo que la lente cuenta sale de aquí, puro y con el reloj inyectado: la
// posición por moneda (las cuatro cifras), la cola de lo que pide atención, la
// previsión de entradas por mes y el estado de cada bolo que filtra el libro.
// Un bolo se mira una vez (`boloMoney`) y las cifras son sumas de esa mirada,
// para que una cifra y su filtro no puedan contar cosas distintas.

/** A bolo as `list_money_bolos` returns it (ADR-087). */
export interface MoneyBolo {
	id: string;
	project_id: string;
	line_id: string | null;
	conversation_id: string | null;
	venue_name: string | null;
	city: string | null;
	country: string | null;
	fee_amount: number | null;
	fee_currency: string | null;
	status: string;
	collected: number;
	function_count: number;
	/** OJO: la PRIMERA función (`min(performed_at)`), no la próxima. */
	next_performed_at: string | null;
	project: {
		id: string;
		slug: string;
		name: string;
		accent: string | null;
		workspace_id: string;
	} | null;
}

export type InvoicingMode = 'off' | 'interno' | 'legal';

/** Statuses that count as sold (ADR-087); holds and proposed are pipeline. */
export const CONTRACTED_STATUSES = ['confirmed', 'done', 'invoiced', 'paid'] as const;

export function isContracted(status: string): boolean {
	return (CONTRACTED_STATUSES as readonly string[]).includes(status);
}

/** Pipeline: not yet a deal (proposed, any hold). */
export function isInProgress(status: string): boolean {
	return status === 'proposed' || status.startsWith('hold');
}

// ── Temporada: septiembre a agosto por fecha de función (ADR-117 § 3) ──

/** The season a day belongs to, as its starting year: 2026-10-03 → 2026, 2027-08-31 → 2026. */
export function seasonOf(day: string): number {
	const year = Number(day.slice(0, 4));
	const month = Number(day.slice(5, 7));
	return month >= 9 ? year : year - 1;
}

/** `{ from: '2026-09-01', to: '2027-08-31' }`, inclusive days. */
export function seasonRange(start: number): { from: string; to: string } {
	return { from: `${start}-09-01`, to: `${start + 1}-08-31` };
}

/** "26/27". */
export function seasonLabel(start: number): string {
	const two = (y: number) => String(y % 100).padStart(2, '0');
	return `${two(start)}/${two(start + 1)}`;
}

/**
 * Which season a bolo lives in: the season of its first function. A bolo with
 * no function yet is a live deal, so it lives in the season of today.
 */
export function boloSeason(bolo: Pick<MoneyBolo, 'next_performed_at'>, today: Date): number {
	return seasonOf(bolo.next_performed_at ?? today.toISOString());
}

/** The seasons there is anything to show for, newest first; today's always included. */
export function seasonsOf(bolos: readonly Pick<MoneyBolo, 'next_performed_at'>[], today: Date): number[] {
	const set = new Set<number>([seasonOf(today.toISOString())]);
	for (const b of bolos) set.add(boloSeason(b, today));
	return [...set].sort((a, b) => b - a);
}

// ── Documentos por bolo ──

const DOC_RANK: Record<string, number> = { issued: 0, paid: 1, draft: 2 };

/**
 * Each bolo's documents, the LIVE one first (issued > paid > draft > cancelled),
 * newest first within a status: a bolo's chip and its owed figure read
 * `docs[0]`, never raw API order (which floats a fresh draft first).
 */
export function invoicesByBolo(invoices: readonly MoneyInvoiceItem[]): Map<string, MoneyInvoiceItem[]> {
	const map = new Map<string, MoneyInvoiceItem[]>();
	for (const inv of invoices) {
		for (const id of new Set(inv.lines.map((l) => l.bolo_id).filter((x): x is string => !!x))) {
			const bucket = map.get(id) ?? [];
			bucket.push(inv);
			map.set(id, bucket);
		}
	}
	for (const bucket of map.values()) {
		bucket.sort(
			(a, b) =>
				(DOC_RANK[a.status] ?? 3) - (DOC_RANK[b.status] ?? 3) ||
				(b.issued_on ?? '').localeCompare(a.issued_on ?? ''),
		);
	}
	return map;
}

/**
 * `agingState` with the payer's observed terms filled in: the one way every
 * money surface decides whether an invoice is late. **Desk must use this**
 * (`.state === 'past-expected'`) instead of `due_on`, so «vencido» means the
 * same thing everywhere (ADR-117 § 4).
 */
export function invoiceAging(
	invoice: MoneyInvoiceItem,
	termsByPayer: ReadonlyMap<string, ObservedPayerTerms>,
	today: Date,
): InvoiceAgingState {
	return agingState(
		{
			...invoice,
			observed_terms_days: invoice.payer_organization_id
				? termsByPayer.get(invoice.payer_organization_id)?.days ?? null
				: null,
		},
		invoice.payments,
		today,
	);
}

// ── Un bolo, mirado una vez ──

export type CollectState = 'full' | 'partial' | 'unpaid' | 'none';

export interface BoloMoney {
	currency: string;
	fee: number | null;
	collected: number;
	contracted: boolean;
	inProgress: boolean;
	/** The live document: issued, else paid, else draft. Cancelled never. */
	doc: MoneyInvoiceItem | null;
	/** What the issued document still lacks: its total less what the bolo collected. */
	docOpen: number;
	/** Por cobrar: `docOpen`, once the deal is contracted (ADR-117 § 6, ADR-123). */
	owed: number;
	/** The issued document's aging, when there is one. */
	aging: InvoiceAgingState | null;
	overdue: boolean;
	/** Days past the expected date (0 when not overdue). */
	daysLate: number;
	/**
	 * Contracted, with a fee, invoicing on, first function already past, and
	 * nothing issued: no document, or only a draft (a draft nobody issues is
	 * the easiest way never to bill a function).
	 */
	toInvoice: boolean;
	/** Contracted and no fee yet. */
	noFee: boolean;
	collect: CollectState;
}

export interface MoneyContext {
	invoicesByBolo: ReadonlyMap<string, readonly MoneyInvoiceItem[]>;
	termsByPayer: ReadonlyMap<string, ObservedPayerTerms>;
	modeOf: (bolo: MoneyBolo) => InvoicingMode;
	today: Date;
}

function todayDay(today: Date): string {
	return today.toISOString().slice(0, 10);
}

export function boloMoney(b: MoneyBolo, ctx: MoneyContext): BoloMoney {
	const currency = b.fee_currency ?? 'EUR';
	const fee = b.fee_amount === null ? null : Number(b.fee_amount);
	const collected = Number(b.collected ?? 0);
	const contracted = isContracted(b.status);
	const docs = ctx.invoicesByBolo.get(b.id) ?? [];
	const doc = docs.find((d) => d.status !== 'cancelled') ?? null;
	const issued = doc?.status === 'issued' ? doc : null;
	const docOpen = issued ? Math.max(0, Number(issued.total) - collected) : 0;
	// A document of a deal not yet confirmed is a quote, not a debt (ADR-123).
	const owed = contracted ? docOpen : 0;
	const aging = issued ? invoiceAging(issued, ctx.termsByPayer, ctx.today) : null;
	const overdue = owed > 0 && aging?.state === 'past-expected';
	const daysLate =
		overdue && aging?.expectedOn ? Math.max(0, daysBetween(aging.expectedOn, todayDay(ctx.today))) : 0;
	const performed = b.next_performed_at ? b.next_performed_at.slice(0, 10) < todayDay(ctx.today) : false;
	const toInvoice =
		(b.status === 'confirmed' || b.status === 'done') &&
		fee !== null &&
		fee > 0 &&
		ctx.modeOf(b) !== 'off' &&
		(doc === null || doc.status === 'draft') &&
		performed;
	const target = issued ? Number(issued.total) : fee ?? 0;
	const collect: CollectState =
		fee === null && !issued
			? 'none'
			: collected <= 0
				? 'unpaid'
				: collected >= target
					? 'full'
					: 'partial';
	return {
		currency,
		fee,
		collected,
		contracted,
		inProgress: isInProgress(b.status),
		doc,
		docOpen,
		owed,
		aging,
		overdue,
		daysLate,
		toInvoice,
		noFee: contracted && fee === null,
		collect,
	};
}

// ── Registrar un cobro (ADR-123) ──

export interface PaymentProposal {
	/** The issued document the payment goes against; null = anchored to the bolo. */
	invoiceId: string | null;
	/** What is still owed: the document's open amount WITH taxes, else the fee less collected. */
	amount: number;
	/** Who pays: the document's payer, else the venue. */
	counterparty: string;
}

/**
 * A payment recorded from Cuentas goes against the bolo's issued document
 * when there is one (that is the path that marks the invoice paid, feeds the
 * payer's observed terms and keeps Documentos and Desk in step); without a
 * document it anchors to the bolo, against the fee.
 */
export function paymentProposal(b: MoneyBolo, m: BoloMoney): PaymentProposal {
	if (m.doc?.status === 'issued') {
		return {
			invoiceId: m.doc.id,
			amount: m.docOpen,
			counterparty: m.doc.payer?.name ?? b.venue_name ?? '',
		};
	}
	return {
		invoiceId: null,
		amount: Math.max(0, (m.fee ?? 0) - m.collected),
		counterparty: b.venue_name ?? '',
	};
}

// ── Las cuatro cifras, por moneda ──

export interface MoneyPosition {
	currency: string;
	/** Por cobrar (all seasons: a debt does not expire with the season). */
	owed: number;
	overdue: number;
	owedCount: number;
	overdueCount: number;
	/** Por facturar (all seasons). */
	toInvoice: number;
	toInvoiceCount: number;
	/** Expected in the next 30 days (issued, unpaid, expected date in [today, today+30]). */
	inflow30: number;
	inflow30Count: number;
	/** Season figures: only bolos of the chosen season. */
	sold: number;
	collected: number;
	/** Invoiced and not yet collected, inside the season. */
	invoicedOpen: number;
	/** Contracted and not yet invoiced nor collected, inside the season. */
	uninvoiced: number;
	holds: number;
	holdsCount: number;
	seasonCount: number;
}

function emptyPosition(currency: string): MoneyPosition {
	return {
		currency,
		owed: 0,
		overdue: 0,
		owedCount: 0,
		overdueCount: 0,
		toInvoice: 0,
		toInvoiceCount: 0,
		inflow30: 0,
		inflow30Count: 0,
		sold: 0,
		collected: 0,
		invoicedOpen: 0,
		uninvoiced: 0,
		holds: 0,
		holdsCount: 0,
		seasonCount: 0,
	};
}

/**
 * The four figures per currency — never EUR plus USD. Por cobrar, por facturar
 * and the 30-day inflow ignore the season (a July invoice of last season is
 * still owed); only the season figure is clipped to `season`.
 */
export function moneyPosition(
	bolos: readonly MoneyBolo[],
	ctx: MoneyContext,
	season: number,
): MoneyPosition[] {
	const map = new Map<string, MoneyPosition>();
	const ensure = (currency: string) => {
		const found = map.get(currency);
		if (found) return found;
		const created = emptyPosition(currency);
		map.set(currency, created);
		return created;
	};
	const today = todayDay(ctx.today);
	const horizon = addDays(today, 30);
	for (const b of bolos) {
		const m = boloMoney(b, ctx);
		const pos = ensure(m.currency);
		if (m.owed > 0) {
			pos.owed += m.owed;
			pos.owedCount += 1;
			if (m.overdue) {
				pos.overdue += m.owed;
				pos.overdueCount += 1;
			} else if (m.aging?.expectedOn && m.aging.expectedOn >= today && m.aging.expectedOn <= horizon) {
				pos.inflow30 += m.owed;
				pos.inflow30Count += 1;
			}
		}
		if (m.toInvoice) {
			pos.toInvoice += m.fee ?? 0;
			pos.toInvoiceCount += 1;
		}
		if (boloSeason(b, ctx.today) !== season) continue;
		pos.seasonCount += 1;
		if (m.fee === null) continue;
		if (m.contracted) {
			const collected = Math.min(m.collected, Math.max(m.fee, m.doc ? Number(m.doc.total) : 0));
			pos.sold += m.fee;
			pos.collected += collected;
			pos.invoicedOpen += m.owed;
			pos.uninvoiced += Math.max(0, m.fee - collected - m.owed);
		} else if (m.inProgress) {
			pos.holds += m.fee;
			pos.holdsCount += 1;
		}
	}
	return [...map.values()].sort((a, b) => a.currency.localeCompare(b.currency));
}

// ── Pide atención ──

export type AttentionKind = 'overdue' | 'to_invoice' | 'draft' | 'fiscal' | 'no_fee';

export interface AttentionItem {
	kind: AttentionKind;
	bolo: MoneyBolo;
	/** The document the item is about (overdue, draft, fiscal). */
	doc: MoneyInvoiceItem | null;
	amount: number | null;
	currency: string;
	/** Overdue: days past the expected date. */
	daysLate: number;
	/** Overdue: the expected date, where it came from and the payer's observed terms. */
	aging: InvoiceAgingState | null;
	observedDays: number | null;
}

const KIND_ORDER: Record<AttentionKind, number> = { overdue: 0, to_invoice: 1, draft: 2, fiscal: 3, no_fee: 4 };

/**
 * What asks for a hand, worst first: overdue (most days late first), functions
 * done without a document (oldest first), done with a draft nobody issued,
 * factura drafts the payer's missing fiscal data blocks, contracted deals with
 * no fee. One row per problem, each
 * with ONE action (the screen maps kind → action).
 */
export function attentionItems(bolos: readonly MoneyBolo[], ctx: MoneyContext): AttentionItem[] {
	const out: AttentionItem[] = [];
	for (const b of bolos) {
		const m = boloMoney(b, ctx);
		const base = { bolo: b, currency: m.currency, daysLate: 0, aging: null, observedDays: null };
		if (m.overdue && m.doc) {
			out.push({
				...base,
				kind: 'overdue',
				doc: m.doc,
				amount: m.owed,
				daysLate: m.daysLate,
				aging: m.aging,
				observedDays: m.doc.payer_organization_id
					? ctx.termsByPayer.get(m.doc.payer_organization_id)?.days ?? null
					: null,
			});
		} else if (m.toInvoice && !m.doc) {
			out.push({ ...base, kind: 'to_invoice', doc: null, amount: m.fee });
		} else if (
			m.doc?.status === 'draft' &&
			m.doc.doc_type === 'factura' &&
			payerFiscalState(m.doc) !== 'ready'
		) {
			out.push({ ...base, kind: 'fiscal', doc: m.doc, amount: Number(m.doc.total) });
		} else if (m.toInvoice && m.doc) {
			out.push({ ...base, kind: 'draft', doc: m.doc, amount: Number(m.doc.total) });
		} else if (m.noFee && (b.status === 'confirmed' || b.status === 'done')) {
			// A function done without a fee is one nobody will ever invoice.
			out.push({ ...base, kind: 'no_fee', doc: null, amount: null });
		}
	}
	const doneFirst = (i: AttentionItem) => (i.kind === 'no_fee' && i.bolo.status === 'done' ? 0 : 1);
	return out.sort(
		(a, b) =>
			KIND_ORDER[a.kind] - KIND_ORDER[b.kind] ||
			doneFirst(a) - doneFirst(b) ||
			b.daysLate - a.daysLate ||
			(a.bolo.next_performed_at ?? '9999').localeCompare(b.bolo.next_performed_at ?? '9999'),
	);
}

// ── Lo que entra ──

export interface InflowMonth {
	/** "2026-10". */
	month: string;
	/** Issued, unpaid, expected that month (from today on). */
	expected: number;
	/** Contracted without a document, first function that month (from today on). */
	contracted: number;
}

export interface InflowForecast {
	currency: string;
	months: InflowMonth[];
	/** Issued and unpaid with no expected date, no due date and no observed terms. */
	undated: number;
}

function monthKey(day: string): string {
	return day.slice(0, 7);
}

function nextMonths(today: string, count: number): string[] {
	const year = Number(today.slice(0, 4));
	const month = Number(today.slice(5, 7)) - 1;
	return Array.from({ length: count }, (_, i) => {
		const d = new Date(Date.UTC(year, month + i, 1));
		return d.toISOString().slice(0, 7);
	});
}

/**
 * The next `count` months of incoming money per currency, starting this month.
 * Overdue money is not forecast (it already sits in «vencido»); a function
 * already past without a document is «por facturar», not future.
 */
export function expectedInflow(
	bolos: readonly MoneyBolo[],
	ctx: MoneyContext,
	count = 4,
): InflowForecast[] {
	const today = todayDay(ctx.today);
	const keys = nextMonths(today, count);
	const map = new Map<string, InflowForecast>();
	const ensure = (currency: string) => {
		const found = map.get(currency);
		if (found) return found;
		const created: InflowForecast = {
			currency,
			months: keys.map((month) => ({ month, expected: 0, contracted: 0 })),
			undated: 0,
		};
		map.set(currency, created);
		return created;
	};
	for (const b of bolos) {
		const m = boloMoney(b, ctx);
		if (m.owed > 0 && !m.overdue) {
			const f = ensure(m.currency);
			const on = m.aging?.expectedOn;
			if (!on) f.undated += 1;
			else if (on >= today) {
				const slot = f.months.find((x) => x.month === monthKey(on));
				if (slot) slot.expected += m.owed;
			}
		}
		if (m.contracted && m.doc === null && m.fee && b.next_performed_at) {
			const day = b.next_performed_at.slice(0, 10);
			if (day < today) continue;
			const slot = ensure(m.currency).months.find((x) => x.month === monthKey(day));
			if (slot) slot.contracted += Math.max(0, m.fee - m.collected);
		}
	}
	return [...map.values()].sort((a, b) => a.currency.localeCompare(b.currency));
}

// ── El libro: los filtros son las cifras ──

export const LEDGER_FILTERS = ['all', 'owed', 'overdue', 'to_invoice', 'in_progress'] as const;
export type LedgerFilter = (typeof LEDGER_FILTERS)[number];

export function matchesLedgerFilter(m: BoloMoney, filter: LedgerFilter): boolean {
	switch (filter) {
		case 'owed':
			return m.owed > 0;
		case 'overdue':
			return m.overdue;
		case 'to_invoice':
			return m.toInvoice;
		case 'in_progress':
			return m.inProgress;
		default:
			return true;
	}
}
