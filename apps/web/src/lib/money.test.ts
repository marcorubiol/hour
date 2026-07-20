import { describe, expect, it } from 'vitest';
import { agingState, observedPayerTermsDays, type TermsPayment } from './money';

describe('observedPayerTermsDays', () => {
	it('returns the median only after two fully paid samples', () => {
		const invoices = [
			{ id: 'i-30', payer_person_id: 'payer-a', issued_on: '2026-01-01', total: 100 },
			{ id: 'i-60', payer_person_id: 'payer-a', issued_on: '2026-02-01', total: 200 },
			{ id: 'i-one', payer_person_id: 'payer-b', issued_on: '2026-01-01', total: 100 },
			{ id: 'i-partial', payer_person_id: 'payer-a', issued_on: '2026-03-01', total: 500 },
		];
		const payments: TermsPayment[] = [
			{ invoice_id: 'i-30', amount: 100, received_on: '2026-01-31' },
			{ invoice_id: 'i-60', amount: 50, received_on: '2026-03-01' },
			{ invoice_id: 'i-60', amount: 150, received_on: '2026-04-02' },
			{ invoice_id: 'i-one', amount: 100, received_on: '2026-01-21' },
			{ invoice_id: 'i-partial', amount: 250, received_on: '2026-03-20' },
		];

		const result = observedPayerTermsDays(invoices, payments);

		expect(result.get('payer-a')).toEqual({ days: 45, samples: 2 });
		expect(result.has('payer-b')).toBe(false);
	});

	it('ignores soft-deleted payments', () => {
		const result = observedPayerTermsDays(
			[
				{ id: 'one', payer_person_id: 'payer', issued_on: '2026-01-01', total: 10 },
				{ id: 'two', payer_person_id: 'payer', issued_on: '2026-02-01', total: 10 },
			],
			[
				{ invoice_id: 'one', amount: 10, received_on: '2026-01-10', deleted_at: null },
				{ invoice_id: 'two', amount: 10, received_on: '2026-02-10', deleted_at: '2026-02-11' },
			],
		);

		expect(result.size).toBe(0);
	});
});

describe('agingState', () => {
	const base = {
		id: 'invoice',
		payer_person_id: 'payer',
		issued_on: '2026-01-01',
		due_on: '2026-02-15',
		expected_on: null,
		observed_terms_days: null,
		status: 'issued',
		total: 100,
	};

	it('uses explicit expectation before observed terms and due date', () => {
		const state = agingState(
			{ ...base, expected_on: '2026-03-02', observed_terms_days: 90 },
			[],
			new Date('2026-02-16T12:00:00Z'),
		);

		expect(state).toMatchObject({
			expectedOn: '2026-03-02',
			expectedDays: 60,
			daysRunning: 46,
			state: 'approaching',
			source: 'explicit',
		});
	});

	it('falls back to observed payer terms, then marks past expectation', () => {
		const state = agingState(
			{ ...base, observed_terms_days: 30 },
			[],
			new Date('2026-02-10T12:00:00Z'),
		);

		expect(state).toMatchObject({
			expectedOn: '2026-01-31',
			expectedDays: 30,
			state: 'past-expected',
			source: 'observed',
		});
	});

	it('falls back to due date when no better expectation exists', () => {
		const state = agingState(base, [], new Date('2026-01-10T12:00:00Z'));
		expect(state).toMatchObject({
			expectedOn: '2026-02-15',
			state: 'within',
			source: 'due',
		});
	});

	it('derives paid from active payment coverage', () => {
		const state = agingState(
			base,
			[
				{ invoice_id: 'invoice', amount: 40, received_on: '2026-01-10' },
				{ invoice_id: 'invoice', amount: 60, received_on: '2026-01-20' },
			],
			new Date('2026-02-20T12:00:00Z'),
		);

		expect(state.state).toBe('paid');
		expect(state.paidAmount).toBe(100);
	});
});
