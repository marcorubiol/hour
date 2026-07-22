<script lang="ts">
	/**
	 * Record payment (ADR-086, money v3 · design Part C). A payment is decoupled
	 * from the invoice: it anchors to a gig / line / project, carries a
	 * counterparty and a category, and only optionally links to a document.
	 * "Collected" is derived from payments-against-fee — so recording one here
	 * moves the fee's collected state, with or without an invoice.
	 *
	 * Presentational: hands a PaymentDraft back via `onsave`; persistence is the
	 * BUILD phase. Labels stay in Catalan.
	 */

	import Button from '$lib/components/Button.svelte';
	import Dialog from '$lib/components/Dialog.svelte';
	import Input from '$lib/components/Input.svelte';
	import Select from '$lib/components/Select.svelte';
	import { addToast } from '$lib/components/Toast.svelte';
	import {
		currencySymbol,
		type FeeRow,
		type InvoicingMode,
		type MoneyAnchor,
		type PaymentDraft,
	} from '$lib/moneybook';

	interface Props {
		open?: boolean;
		/** The anchor fee — seeds context, currency and the remaining amount. */
		fee: FeeRow | null;
		mode: InvoicingMode;
		lineLabel?: string;
		projectLabel?: string;
		/** Invoice numbers this payment could optionally link to. */
		documents?: string[];
		onsave: (draft: PaymentDraft) => void;
	}

	let {
		open = $bindable(false),
		fee,
		mode,
		lineLabel = '',
		projectLabel = '',
		documents = [],
		onsave,
	}: Props = $props();

	const CURRENCIES = [
		{ value: 'EUR', label: 'EUR' },
		{ value: 'GBP', label: 'GBP' },
	];
	const METHODS = ['Transferència', 'Efectiu', 'Bizum', 'Targeta'].map((m) => ({
		value: m,
		label: m,
	}));
	const CATEGORIES = ['Caixet', 'Bestreta', 'Bolo', 'Altres'].map((c) => ({ value: c, label: c }));

	let amount = $state('');
	let currency = $state('EUR');
	let receivedOn = $state('2026-04-12');
	let method = $state('Transferència');
	let anchor = $state<MoneyAnchor>('gig');
	let counterparty = $state('');
	let category = $state('Caixet');
	let reference = $state('');
	let linkInvoice = $state('');

	let wasOpen = false;
	$effect(() => {
		if (open && !wasOpen) {
			const remaining = fee ? Math.max(0, fee.fee - fee.collected) : 0;
			amount = remaining ? remaining.toFixed(2) : '';
			currency = fee?.currency ?? 'EUR';
			receivedOn = '2026-04-12';
			method = 'Transferència';
			anchor = 'gig';
			counterparty = '';
			category = 'Caixet';
			reference = '';
			linkInvoice = '';
		}
		wasOpen = open;
	});

	const context = $derived(fee ? `${fee.venue}, ${fee.city} — ${fee.date}` : '');
	const showLink = $derived(mode !== 'off');
	const anchorOptions = $derived([
		{ value: 'gig', label: fee ? `Aquest caché — ${fee.venue}, ${fee.city}` : 'Aquest caché' },
		{ value: 'line', label: `Línia — ${lineLabel}` },
		{ value: 'project', label: `Projecte — ${projectLabel}` },
	]);
	const docOptions = $derived([
		{ value: '', label: '— Sense document —' },
		...documents.map((d) => ({ value: d, label: d })),
	]);

	function save() {
		const amt = parseFloat(amount) || 0;
		if (amt <= 0) {
			addToast({ tone: 'warning', message: 'L’import ha de ser més gran que zero.' });
			return;
		}
		onsave({
			fee_id: fee?.id ?? null,
			amount: amt,
			currency,
			received_on: receivedOn,
			method,
			anchor,
			counterparty: counterparty.trim(),
			category,
			reference: reference.trim(),
			invoice_id: linkInvoice || null,
		});
		open = false;
	}
</script>

<Dialog bind:open title="Registra un pagament" description={context} size="s">
	<div class="rpd">
		<div class="rpd__row">
			<span class="rpd__mono">
				<Input label="Import" bind:value={amount}>
					{#snippet prefix()}{currencySymbol(currency)}{/snippet}
				</Input>
			</span>
			<Select label="Moneda" bind:value={currency} options={CURRENCIES} />
		</div>
		<div class="rpd__row">
			<Input label="Rebut el" type="date" bind:value={receivedOn} />
			<Select label="Mètode" bind:value={method} options={METHODS} />
		</div>
		<Select label="Àncora" bind:value={anchor} options={anchorOptions} />
		<div class="rpd__row">
			<Input label="Contrapart (qui paga)" bind:value={counterparty} placeholder="qui paga" />
			<Select label="Categoria (opcional)" bind:value={category} options={CATEGORIES} />
		</div>
		<span class="rpd__mono">
			<Input label="Referència (opcional)" bind:value={reference} placeholder="Núm. transferència, concepte…" />
		</span>
		{#if showLink}
			<Select
				label="Enllaça a document (opcional — normalment buit)"
				bind:value={linkInvoice}
				options={docOptions}
			/>
		{/if}
	</div>

	{#snippet actions()}
		<span class="rpd__note">El cobrat es deriva dels pagaments contra el caché, no del document.</span>
		<Button variant="outline" onclick={() => (open = false)}>Cancel·la</Button>
		<Button onclick={save}>Registra</Button>
	{/snippet}
</Dialog>

<style>
	@layer components {
		.rpd {
			display: flex;
			flex-direction: column;
			gap: var(--space-m);
		}
		.rpd__row {
			display: grid;
			grid-template-columns: 1fr 1fr;
			gap: var(--space-s);
		}
		@media (max-width: 460px) {
			.rpd__row {
				grid-template-columns: 1fr;
			}
		}
		.rpd__mono :global(.field__control input) {
			font-family: var(--font-mono);
		}
		.rpd__note {
			flex: 1;
			font-size: var(--text-xs);
			color: var(--text-faint);
			line-height: 1.4;
		}
	}
</style>
