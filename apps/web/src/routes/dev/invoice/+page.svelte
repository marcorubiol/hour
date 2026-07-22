<script lang="ts">
	/**
	 * Invoice document preview (dev only) — the design harness for
	 * InvoiceDocument (ADR-086, money v3 · design Part A). Reproduces the
	 * mockup's toolbar (mode · state · lines) so every combination and both
	 * themes can be reviewed. Sample data only: no schema, no fetch — the doc
	 * is built locally through the typed contract in $lib/invoice.
	 */

	import { dev } from '$app/environment';
	import { goto } from '$app/navigation';
	import { onMount } from 'svelte';
	import InvoiceDocument from '$lib/components/InvoiceDocument.svelte';
	import type {
		FiscalParty,
		InvoiceDoc,
		InvoiceLine,
		InvoiceMode,
		InvoiceStatus,
	} from '$lib/invoice';

	onMount(() => {
		if (!dev) goto('/', { replaceState: true });
	});

	let mode = $state<InvoiceMode>('legal');
	let status = $state<InvoiceStatus>('issued');
	let lineset = $state<'single' | 'multi'>('single');

	const MODES: { v: InvoiceMode; l: string }[] = [
		{ v: 'legal', l: 'Factura' },
		{ v: 'interno', l: 'Proforma' },
	];
	const STATES: { v: InvoiceStatus; l: string }[] = [
		{ v: 'draft', l: 'Esborrany' },
		{ v: 'issued', l: 'Emesa' },
		{ v: 'paid', l: 'Pagada' },
	];
	const LINESETS: { v: 'single' | 'multi'; l: string }[] = [
		{ v: 'single', l: 'Una funció' },
		{ v: 'multi', l: 'Gira' },
	];

	const ISSUER: FiscalParty = {
		legal_name: 'MüK Cia SL',
		tax_id: 'ES B12345678',
		address_line_1: 'Carrer Example 12',
		address_line_2: '2n 1a',
		postal_code: '08001',
		city: 'Barcelona',
		region: 'Catalunya',
		country: 'Espanya',
		iban: 'ES91 2100 0418 4502 0005 1332',
		swift_bic: 'CAIXESBBXXX',
	};
	const RECEIVER: FiscalParty = {
		legal_name: 'Teatre Municipal de Girona',
		tax_id: 'P1708500A',
		address_line_1: 'Plaça del Vi 1',
		postal_code: '17004',
		city: 'Girona',
		region: 'Catalunya',
		country: 'Espanya',
	};
	const SINGLE: InvoiceLine[] = [
		{ project: 'Fetitxes', venue: 'Teatre Municipal', city: 'Girona', date: '14 mar 2026', qty: 1, unit: 2900 },
	];
	const MULTI: InvoiceLine[] = [
		{ project: 'Fetitxes', venue: 'Teatre Municipal', city: 'Girona', date: '14 mar 2026', qty: 1, unit: 2900 },
		{ project: 'Fetitxes', venue: 'Teatre Auditori', city: 'Salt', date: '21 mar 2026', qty: 1, unit: 2600 },
		{ project: 'Fetitxes', venue: 'La Planeta', city: 'Girona', date: '28 mar 2026', qty: 1, unit: 1800 },
	];

	const doc = $derived<InvoiceDoc>({
		mode,
		status,
		number: status === 'draft' ? null : mode === 'legal' ? 'FAC 2026-0042' : 'PRO 2026-0031',
		issue_date: '20 mar 2026',
		due_date: '20 abr 2026',
		expected_period: 'abr 2026',
		paid_date: '12 abr 2026',
		issuer: ISSUER,
		receiver_name: 'Teatre Municipal de Girona',
		receiver: mode === 'legal' ? RECEIVER : null,
		lines: lineset === 'single' ? SINGLE : MULTI,
		vat_pct: 21,
		irpf_pct: 15,
		currency: 'EUR',
		payment_terms:
			"Transferència a 30 dies des de la data d'emissió. Import net un cop aplicada la retenció d'IRPF.",
		legal_note:
			'Operació subjecta a IVA segons la Llei 37/1992. Document emès per MüK Cia SL · NIF ES B12345678.',
		issuer_accent: 'var(--accent-1)',
		issuer_initials: 'MK',
	});

	function toggleTheme() {
		const root = document.documentElement;
		const next = root.getAttribute('data-mode') === 'dark' ? 'light' : 'dark';
		root.setAttribute('data-mode', next);
	}
</script>

<svelte:head>
	<title>Invoice preview — Hour</title>
	<meta name="robots" content="noindex" />
</svelte:head>

{#if dev}
	<div class="harness">
		<div class="bar">
			<div class="bar__grp">
				<span class="bar__lab">Mode</span>
				<div class="seg" role="group" aria-label="Mode">
					{#each MODES as m (m.v)}
						<button class:on={mode === m.v} onclick={() => (mode = m.v)}>{m.l}</button>
					{/each}
				</div>
			</div>
			<div class="bar__grp">
				<span class="bar__lab">Estat</span>
				<div class="seg" role="group" aria-label="Estat">
					{#each STATES as s (s.v)}
						<button class:on={status === s.v} onclick={() => (status = s.v)}>{s.l}</button>
					{/each}
				</div>
			</div>
			<div class="bar__grp">
				<span class="bar__lab">Línies</span>
				<div class="seg" role="group" aria-label="Línies">
					{#each LINESETS as l (l.v)}
						<button class:on={lineset === l.v} onclick={() => (lineset = l.v)}>{l.l}</button>
					{/each}
				</div>
			</div>
			<div class="bar__sp"></div>
			<button class="bar__theme" onclick={toggleTheme}>Tema clar / fosc</button>
		</div>

		<div class="desk">
			<div class="frame">
				<InvoiceDocument {doc} />
			</div>
		</div>
	</div>
{/if}

<style>
	@layer components {
		.bar {
			position: sticky;
			inset-block-start: 0;
			z-index: 10;
			display: flex;
			flex-wrap: wrap;
			align-items: center;
			gap: var(--space-l);
			padding: var(--space-s) var(--space-l);
			background: var(--bg);
			border-block-end: 1px solid var(--border-color-light);
		}
		.bar__grp {
			display: flex;
			align-items: center;
			gap: var(--space-s);
		}
		.bar__lab {
			font-family: var(--font-mono);
			font-size: var(--text-xs);
			letter-spacing: 0.13em;
			text-transform: uppercase;
			color: var(--text-faint);
		}
		.seg {
			display: inline-flex;
			overflow: hidden;
			background: var(--bg-ultra-light);
			border: 1px solid var(--border-color-dark);
			border-radius: var(--radius-circle);
		}
		.seg button {
			padding: 6px 14px;
			border: 0;
			background: none;
			font-family: var(--font-sans);
			font-size: var(--text-s);
			color: var(--text-muted);
			cursor: pointer;
			white-space: nowrap;
		}
		.seg button:hover {
			color: var(--text-color);
		}
		.seg button.on {
			background: var(--text-color);
			color: var(--bg-ultra-light);
		}
		.bar__sp {
			flex: 1;
		}
		.bar__theme {
			padding: 7px 14px;
			border: 1px solid var(--border-color-dark);
			border-radius: var(--radius-m);
			background: var(--bg-ultra-light);
			font-family: var(--font-mono);
			font-size: var(--text-xs);
			color: var(--text-muted);
			cursor: pointer;
		}
		.bar__theme:hover {
			color: var(--text-color);
		}

		.desk {
			display: flex;
			justify-content: center;
			min-block-size: 100vh;
			padding: var(--space-xl) var(--space-l) var(--space-2xl);
			background: var(--bg-light);
		}
		.frame {
			inline-size: 760px;
			max-inline-size: 100%;
			block-size: fit-content;
		}

		@media print {
			.bar {
				display: none;
			}
			.desk {
				min-block-size: 0;
				padding: 0;
				background: none;
			}
		}
	}
</style>
