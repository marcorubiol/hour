<script lang="ts">
	/**
	 * Add expense (ADR-086, money v3 · design Part C). Money out — anchored to a
	 * line, project or gig, with an optional counterparty (who's paid). Never
	 * generates a fiscal document.
	 *
	 * Presentational: hands an ExpenseDraft back via `onsave`; persistence is the
	 * BUILD phase. Labels stay in Catalan.
	 */

	import Button from '$lib/components/Button.svelte';
	import Dialog from '$lib/components/Dialog.svelte';
	import Input from '$lib/components/Input.svelte';
	import Select from '$lib/components/Select.svelte';
	import { addToast } from '$lib/components/Toast.svelte';
	import { currencySymbol, type ExpenseDraft, type MoneyAnchor } from '$lib/moneybook';

	interface Props {
		open?: boolean;
		lineLabel?: string;
		projectLabel?: string;
		onsave: (draft: ExpenseDraft) => void;
	}

	let { open = $bindable(false), lineLabel = '', projectLabel = '', onsave }: Props = $props();

	const CURRENCIES = [
		{ value: 'EUR', label: 'EUR' },
		{ value: 'GBP', label: 'GBP' },
	];
	const CATEGORIES = ['transport', 'dietes', 'allotjament', 'material', 'altres'].map((c) => ({
		value: c,
		label: c,
	}));
	const MONTHS = ['gen', 'feb', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'oct', 'nov', 'des'];

	let amount = $state('');
	let currency = $state('EUR');
	let description = $state('');
	let date = $state('2026-03-20');
	let category = $state('transport');
	let anchor = $state<MoneyAnchor>('line');
	let counterparty = $state('');

	let wasOpen = false;
	$effect(() => {
		if (open && !wasOpen) {
			amount = '';
			currency = 'EUR';
			description = '';
			date = '2026-03-20';
			category = 'transport';
			anchor = 'line';
			counterparty = '';
		}
		wasOpen = open;
	});

	const anchorOptions = $derived([
		{ value: 'line', label: `Línia — ${lineLabel}` },
		{ value: 'project', label: `Projecte — ${projectLabel}` },
		{ value: 'gig', label: 'Una funció…' },
	]);

	/** yyyy-mm-dd → "20 mar" (Catalan short), stable and locale-free. */
	function displayDate(iso: string): string {
		const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
		if (!m) return '—';
		return `${Number(m[3])} ${MONTHS[Number(m[2]) - 1] ?? ''}`.trim();
	}

	function save() {
		const amt = parseFloat(amount) || 0;
		if (amt <= 0) {
			addToast({ tone: 'warning', message: 'L’import ha de ser més gran que zero.' });
			return;
		}
		onsave({
			amount: amt,
			currency,
			description: description.trim() || 'Despesa',
			date: displayDate(date),
			category,
			anchor,
			counterparty: counterparty.trim() || null,
		});
		open = false;
	}
</script>

<Dialog
	bind:open
	title="Afegeix una despesa"
	description="Diners que surten · ancorats a la línia o a una funció"
	size="s"
>
	<div class="aed">
		<div class="aed__row">
			<span class="aed__mono">
				<Input label="Import" bind:value={amount}>
					{#snippet prefix()}{currencySymbol(currency)}{/snippet}
				</Input>
			</span>
			<Select label="Moneda" bind:value={currency} options={CURRENCIES} />
		</div>
		<Input label="Descripció" bind:value={description} placeholder="p. ex. Lloguer furgoneta" />
		<div class="aed__row">
			<Input label="Data" type="date" bind:value={date} />
			<Select label="Categoria" bind:value={category} options={CATEGORIES} />
		</div>
		<Select label="Àncora" bind:value={anchor} options={anchorOptions} />
		<Input
			label="Contrapart (opcional — a qui es paga)"
			bind:value={counterparty}
			placeholder="p. ex. Rent-a-Car Vic"
		/>
	</div>

	{#snippet actions()}
		<span class="aed__note">La despesa no genera cap document fiscal.</span>
		<Button variant="outline" onclick={() => (open = false)}>Cancel·la</Button>
		<Button onclick={save}>Afegeix</Button>
	{/snippet}
</Dialog>

<style>
	@layer components {
		.aed {
			display: flex;
			flex-direction: column;
			gap: var(--space-m);
		}
		.aed__row {
			display: grid;
			grid-template-columns: 1fr 1fr;
			gap: var(--space-s);
		}
		@media (max-width: 460px) {
			.aed__row {
				grid-template-columns: 1fr;
			}
		}
		.aed__mono :global(.field__control input) {
			font-family: var(--font-mono);
		}
		.aed__note {
			flex: 1;
			font-size: var(--text-xs);
			color: var(--text-faint);
			line-height: 1.4;
		}
	}
</style>
