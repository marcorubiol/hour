/**
 * Money formatting + invoice tones — the single source for every money
 * surface (Money lens, line Money module, line header stats). Formerly
 * three drifting local copies: the lens omitted maximumFractionDigits
 * (allowed 3 decimals) and the line header showed 0 decimals while the
 * module showed 2 for the same figure.
 */

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
