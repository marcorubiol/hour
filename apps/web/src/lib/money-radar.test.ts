import { describe, expect, it } from 'vitest';
import {
	attentionItems,
	boloMoney,
	boloSeason,
	expectedInflow,
	invoicesByBolo,
	matchesLedgerFilter,
	moneyPosition,
	seasonLabel,
	seasonOf,
	seasonRange,
	seasonsOf,
	type MoneyBolo,
	type MoneyContext,
	type MoneyInvoiceItem,
	type ObservedPayerTerms,
} from './money';

const TODAY = new Date('2026-10-15T10:00:00Z');

function bolo(over: Partial<MoneyBolo> & { id: string }): MoneyBolo {
	return {
		project_id: 'p',
		line_id: null,
		conversation_id: null,
		venue_name: `Sala ${over.id}`,
		city: null,
		country: 'ES',
		fee_amount: 1000,
		fee_currency: 'EUR',
		status: 'done',
		collected: 0,
		function_count: 1,
		next_performed_at: '2026-09-20T18:00:00Z',
		project: { id: 'p', slug: 'obra', name: 'Obra', accent: null, workspace_id: 'w' },
		...over,
	};
}

function invoice(over: Partial<MoneyInvoiceItem> & { id: string; bolo: string }): MoneyInvoiceItem {
	const { bolo: boloId, ...rest } = over;
	return {
		workspace_id: 'w',
		project_id: 'p',
		payer_organization_id: null,
		payer_fiscal_identity_id: 'fi',
		doc_type: 'factura',
		number: `F-${over.id}`,
		status: 'issued',
		issued_on: '2026-09-01',
		due_on: null,
		expected_on: null,
		payment_condition: null,
		subtotal: 1000,
		total: 1000,
		currency: 'EUR',
		country: 'ES',
		tax_lines: [],
		notes: null,
		paid_amount: 0,
		project: null,
		payer: null,
		lines: [{ bolo_id: boloId }],
		payments: [],
		...rest,
	};
}

function ctx(
	invoices: MoneyInvoiceItem[] = [],
	over: Partial<MoneyContext> = {},
	terms: Map<string, ObservedPayerTerms> = new Map(),
): MoneyContext {
	return {
		invoicesByBolo: invoicesByBolo(invoices),
		termsByPayer: terms,
		modeOf: () => 'legal',
		today: TODAY,
		...over,
	};
}

describe('season (September to August, by function date)', () => {
	it('starts in September', () => {
		expect(seasonOf('2026-09-01')).toBe(2026);
		expect(seasonOf('2026-08-31')).toBe(2025);
		expect(seasonOf('2027-08-31T22:00:00Z')).toBe(2026);
		expect(seasonRange(2026)).toEqual({ from: '2026-09-01', to: '2027-08-31' });
		expect(seasonLabel(2026)).toBe('26/27');
		expect(seasonLabel(2099)).toBe('99/00');
	});

	it('puts a bolo without functions in the season of today', () => {
		expect(boloSeason({ next_performed_at: null }, TODAY)).toBe(2026);
		expect(boloSeason({ next_performed_at: '2026-07-10' }, TODAY)).toBe(2025);
	});

	it('lists seasons newest first, today always there', () => {
		expect(seasonsOf([{ next_performed_at: '2025-03-01' }], TODAY)).toEqual([2026, 2024]);
	});
});

describe('invoicesByBolo', () => {
	it('puts the live document first, a fresh draft after the issued one', () => {
		const map = invoicesByBolo([
			invoice({ id: 'd', bolo: 'b', status: 'draft', issued_on: '2026-10-10' }),
			invoice({ id: 'c', bolo: 'b', status: 'cancelled' }),
			invoice({ id: 'i', bolo: 'b', status: 'issued', issued_on: '2026-09-01' }),
		]);
		expect(map.get('b')!.map((i) => i.id)).toEqual(['i', 'd', 'c']);
	});
});

describe('boloMoney', () => {
	it('owes only what was invoiced: a contracted bolo without document owes nothing', () => {
		const m = boloMoney(bolo({ id: 'b', next_performed_at: '2026-11-20' }), ctx());
		expect(m.owed).toBe(0);
		expect(m.toInvoice).toBe(false);
	});

	it('owes the issued total less what the bolo collected', () => {
		const m = boloMoney(
			bolo({ id: 'b', collected: 400 }),
			ctx([invoice({ id: 'i', bolo: 'b', total: 1060 })]),
		);
		expect(m.owed).toBe(660);
		expect(m.collect).toBe('partial');
	});

	it('is overdue against the EXPECTED date, not due_on', () => {
		// due_on passed, but the payer observably pays at 60 days: not late yet.
		const inv = invoice({
			id: 'i',
			bolo: 'b',
			issued_on: '2026-09-01',
			due_on: '2026-10-01',
			payer_organization_id: 'payer',
		});
		const calm = boloMoney(bolo({ id: 'b' }), ctx([inv], {}, new Map([['payer', { days: 60, samples: 3 }]])));
		expect(calm.overdue).toBe(false);
		const late = boloMoney(bolo({ id: 'b' }), ctx([inv]));
		expect(late.overdue).toBe(true);
		expect(late.daysLate).toBe(14);
	});

	it('asks to invoice a past function with no live document, only when invoicing is on', () => {
		const b = bolo({ id: 'b', next_performed_at: '2026-10-03T19:00:00Z' });
		expect(boloMoney(b, ctx()).toInvoice).toBe(true);
		expect(boloMoney(b, ctx([], { modeOf: () => 'off' })).toInvoice).toBe(false);
		expect(boloMoney(b, ctx([invoice({ id: 'd', bolo: 'b', status: 'draft' })])).toInvoice).toBe(false);
		// a cancelled document is no document
		expect(boloMoney(b, ctx([invoice({ id: 'c', bolo: 'b', status: 'cancelled' })])).toInvoice).toBe(true);
		expect(boloMoney({ ...b, fee_amount: null }, ctx()).toInvoice).toBe(false);
		expect(boloMoney({ ...b, status: 'hold_1' }, ctx()).toInvoice).toBe(false);
		// tonight's function is not past yet
		expect(boloMoney({ ...b, next_performed_at: '2026-10-15T20:00:00Z' }, ctx()).toInvoice).toBe(false);
	});
});

describe('moneyPosition', () => {
	const bolos = [
		// last season, invoiced, unpaid, late: still owed this season
		bolo({ id: 'old', next_performed_at: '2026-07-10', fee_amount: 500 }),
		// this season, invoiced, expected in 10 days
		bolo({ id: 'soon', next_performed_at: '2026-09-25', fee_amount: 1200 }),
		// this season, done, no document → por facturar
		bolo({ id: 'todo', next_performed_at: '2026-10-03', fee_amount: 2200 }),
		// this season, collected in full
		bolo({ id: 'paid', next_performed_at: '2026-09-12', fee_amount: 2400, collected: 2400 }),
		// this season, future, confirmed
		bolo({ id: 'future', next_performed_at: '2027-02-14', status: 'confirmed', fee_amount: 3000 }),
		// a hold
		bolo({ id: 'hold', next_performed_at: '2027-03-07', status: 'hold_1', fee_amount: 3200 }),
		// another currency
		bolo({ id: 'chf', next_performed_at: '2026-11-01', status: 'confirmed', fee_amount: 900, fee_currency: 'CHF' }),
	];
	const invoices = [
		invoice({ id: 'i-old', bolo: 'old', total: 500, issued_on: '2026-07-15', expected_on: '2026-08-15' }),
		invoice({ id: 'i-soon', bolo: 'soon', total: 1200, issued_on: '2026-09-26', expected_on: '2026-10-25' }),
		invoice({ id: 'i-paid', bolo: 'paid', total: 2400, status: 'paid' }),
	];

	it('keeps currencies apart', () => {
		const pos = moneyPosition(bolos, ctx(invoices), 2026);
		expect(pos.map((p) => p.currency)).toEqual(['CHF', 'EUR']);
		expect(pos[0]).toMatchObject({ sold: 900, owed: 0, toInvoice: 0 });
	});

	it('does not clip debts and invoicing to the season; the season figure is clipped', () => {
		const eur = moneyPosition(bolos, ctx(invoices), 2026).find((p) => p.currency === 'EUR')!;
		expect(eur).toMatchObject({
			owed: 1700,
			owedCount: 2,
			overdue: 500,
			overdueCount: 1,
			inflow30: 1200,
			inflow30Count: 1,
			toInvoice: 2200,
			toInvoiceCount: 1,
			// season 26/27: soon + todo + paid + future (old is 25/26)
			sold: 1200 + 2200 + 2400 + 3000,
			collected: 2400,
			invoicedOpen: 1200,
			uninvoiced: 2200 + 3000,
			holds: 3200,
			holdsCount: 1,
			seasonCount: 5,
		});
	});

	it('keeps the season bar honest: collected + invoiced open + uninvoiced = sold', () => {
		for (const p of moneyPosition(bolos, ctx(invoices), 2026)) {
			expect(p.collected + p.invoicedOpen + p.uninvoiced).toBeCloseTo(p.sold);
		}
	});

	it('a past season shows only its own bolos in the season figure', () => {
		const eur = moneyPosition(bolos, ctx(invoices), 2025).find((p) => p.currency === 'EUR')!;
		expect(eur.sold).toBe(500);
		expect(eur.owed).toBe(1700);
	});
});

describe('attentionItems', () => {
	it('orders by gravity, each problem once, overdue by days late', () => {
		const bolos = [
			bolo({ id: 'noFee', status: 'confirmed', fee_amount: null, next_performed_at: '2027-02-14' }),
			bolo({ id: 'todo', next_performed_at: '2026-10-03' }),
			bolo({ id: 'late23', next_performed_at: '2026-09-20' }),
			bolo({ id: 'late68', next_performed_at: '2026-07-24' }),
			bolo({ id: 'draft', status: 'confirmed', next_performed_at: '2026-10-25' }),
			bolo({ id: 'fine', collected: 1000 }),
		];
		const invoices = [
			invoice({ id: 'a', bolo: 'late23', expected_on: '2026-09-22' }),
			invoice({ id: 'b', bolo: 'late68', expected_on: '2026-08-08' }),
			invoice({
				id: 'c',
				bolo: 'draft',
				status: 'draft',
				payer_fiscal_identity_id: null,
				payer: { id: 'o', slug: 'o', name: 'Teatro', fiscal_identity_id: null },
			}),
			invoice({ id: 'd', bolo: 'fine', status: 'paid' }),
		];
		const items = attentionItems(bolos, ctx(invoices));
		expect(items.map((i) => [i.kind, i.bolo.id])).toEqual([
			['overdue', 'late68'],
			['overdue', 'late23'],
			['to_invoice', 'todo'],
			['fiscal', 'draft'],
			['no_fee', 'noFee'],
		]);
		expect(items[0]).toMatchObject({ daysLate: 68, amount: 1000 });
	});

	it('a proforma draft is never blocked by fiscal data', () => {
		const items = attentionItems(
			[bolo({ id: 'b', status: 'confirmed', next_performed_at: '2026-11-01' })],
			ctx([invoice({ id: 'p', bolo: 'b', status: 'draft', doc_type: 'proforma', payer_fiscal_identity_id: null })]),
		);
		expect(items).toEqual([]);
	});
});

describe('expectedInflow', () => {
	it('places expected collections and uninvoiced future functions by month', () => {
		const bolos = [
			bolo({ id: 'a', next_performed_at: '2026-09-20' }),
			bolo({ id: 'b', next_performed_at: '2026-11-08', status: 'confirmed', fee_amount: 2100 }),
			bolo({ id: 'late', next_performed_at: '2026-09-01' }),
			bolo({ id: 'nodate', next_performed_at: '2026-09-02' }),
			bolo({ id: 'past', next_performed_at: '2026-10-03', fee_amount: 2200 }),
			bolo({ id: 'far', next_performed_at: '2027-05-01', status: 'confirmed' }),
		];
		const invoices = [
			invoice({ id: 'ia', bolo: 'a', total: 1590, expected_on: '2026-11-15' }),
			invoice({ id: 'il', bolo: 'late', expected_on: '2026-10-01' }),
			invoice({ id: 'in', bolo: 'nodate' }),
		];
		const [eur] = expectedInflow(bolos, ctx(invoices));
		expect(eur!.months).toEqual([
			{ month: '2026-10', expected: 0, contracted: 0 },
			{ month: '2026-11', expected: 1590, contracted: 2100 },
			{ month: '2026-12', expected: 0, contracted: 0 },
			{ month: '2027-01', expected: 0, contracted: 0 },
		]);
		expect(eur!.undated).toBe(1);
	});

	it('crosses the year end', () => {
		const [f] = expectedInflow(
			[bolo({ id: 'x', status: 'confirmed', next_performed_at: '2027-01-10' })],
			ctx([], { today: new Date('2026-12-20T09:00:00Z') }),
		);
		expect(f!.months.map((m) => m.month)).toEqual(['2026-12', '2027-01', '2027-02', '2027-03']);
		expect(f!.months[1]!.contracted).toBe(1000);
	});
});

describe('matchesLedgerFilter', () => {
	it('the filters are the figures', () => {
		const c = ctx([invoice({ id: 'i', bolo: 'b', expected_on: '2026-10-01' })]);
		const m = boloMoney(bolo({ id: 'b' }), c);
		expect(matchesLedgerFilter(m, 'all')).toBe(true);
		expect(matchesLedgerFilter(m, 'owed')).toBe(true);
		expect(matchesLedgerFilter(m, 'overdue')).toBe(true);
		expect(matchesLedgerFilter(m, 'to_invoice')).toBe(false);
		expect(matchesLedgerFilter(boloMoney(bolo({ id: 'h', status: 'hold' }), c), 'in_progress')).toBe(true);
	});
});
