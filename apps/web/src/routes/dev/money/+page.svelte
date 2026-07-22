<script lang="ts">
	/**
	 * Money lens v3 preview (dev only) — the design harness for money v3 · Part C
	 * (ADR-086). The fee is the anchor, payment is decoupled from the invoice,
	 * and the whole surface reshapes by invoicing_mode (legal / interno / off).
	 * Sample data only: no schema, no fetch. When the build lands, this surface
	 * moves into the real /h/money route.
	 */

	import { dev } from '$app/environment';
	import { goto } from '$app/navigation';
	import { onMount } from 'svelte';
	import Button from '$lib/components/Button.svelte';
	import RecordPaymentDialog from '$lib/components/RecordPaymentDialog.svelte';
	import AddExpenseDialog from '$lib/components/AddExpenseDialog.svelte';
	import Toast, { addToast } from '$lib/components/Toast.svelte';
	import { fmtFee, fmtMoney } from '$lib/money';
	import {
		currencyName,
		feeStatus,
		type ExpenseDraft,
		type ExpenseRow,
		type FeeRow,
		type FeeStatus,
		type InvoiceDocRow,
		type InvoicingMode,
		type PaymentDraft,
	} from '$lib/moneybook';

	onMount(() => {
		if (!dev) goto('/', { replaceState: true });
	});

	const LINE_LABEL = 'Fetitxes · Gira 26–27';
	const PROJECT_LABEL = 'Fetitxes';

	const MODES: { v: InvoicingMode; l: string }[] = [
		{ v: 'legal', l: 'Legal' },
		{ v: 'interno', l: 'Intern' },
		{ v: 'off', l: 'Desactivat' },
	];
	const EXPL: Record<InvoicingMode, { name: string; rest: string }> = {
		legal: { name: 'Legal', rest: 'Hour emet Factures amb validesa fiscal.' },
		interno: {
			name: 'Intern',
			rest: 'Hour emet Proformes amb numeració pròpia; la factura legal s’emet fora.',
		},
		off: { name: 'Desactivat', rest: 'no s’emet cap document. Money és només un llibre.' },
	};

	let mode = $state<InvoicingMode>('legal');

	let fees = $state<FeeRow[]>([
		{ id: 'f1', date: '14 mar', venue: 'Teatre Municipal', city: 'Girona', currency: 'EUR', fee: 2900, collected: 2900, doc: 'FAC 2026-0042' },
		{ id: 'f2', date: '21 mar', venue: 'Teatre Auditori', city: 'Salt', currency: 'EUR', fee: 2600, collected: 1300, doc: null },
		{ id: 'f3', date: '28 mar', venue: 'La Planeta', city: 'Girona', currency: 'EUR', fee: 1800, collected: 0, doc: null },
		{ id: 'f4', date: '12 abr', venue: 'The Place', city: 'London', currency: 'GBP', fee: 3200, collected: 0, doc: null },
	]);

	let expenses = $state<ExpenseRow[]>([
		{ id: 'e1', date: '12 mar', description: 'Lloguer furgoneta', category: 'transport', counterparty: 'Rent-a-Car Vic', currency: 'EUR', amount: 340 },
		{ id: 'e2', date: '14 mar', description: 'Combustible + peatges', category: 'transport', counterparty: null, currency: 'EUR', amount: 96 },
		{ id: 'e3', date: '21 mar', description: 'Dietes equip (4 pax)', category: 'dietes', counterparty: null, currency: 'EUR', amount: 180 },
	]);

	const invoices: InvoiceDocRow[] = [
		{
			id: 'i1',
			number: 'FAC 2026-0042',
			for_text: 'Teatre Municipal, Girona — 14 mar 2026',
			currency: 'EUR',
			subtotal: 2900,
			vat_pct: 21,
			irpf_pct: 15,
			issue_date: '20 mar 2026',
			due_date: '20 abr 2026',
			payer_name: 'Teatre Municipal de Girona',
			payer_tax_id: 'P1708500A',
		},
	];

	const currencies = $derived([...new Set(fees.map((f) => f.currency))]);
	const showInv = $derived(mode !== 'off');
	const createLabel = $derived(mode === 'legal' ? 'Crea factura' : 'Crea proforma');
	const invEyebrow = $derived(mode === 'legal' ? 'Factures' : 'Proformes');
	const docNumbers = $derived(invoices.map((i) => i.number));

	function rollup(c: string) {
		const fs = fees.filter((f) => f.currency === c);
		return {
			pipeline: fs.reduce((s, f) => s + f.fee, 0),
			collected: fs.reduce((s, f) => s + f.collected, 0),
			invoiced: invoices.filter((i) => i.currency === c).reduce((s, i) => s + i.subtotal, 0),
		};
	}
	const eur = $derived(rollup('EUR'));
	const eurPct = $derived(eur.pipeline ? Math.round((eur.collected / eur.pipeline) * 100) : 0);
	const eurExpenseTotal = $derived(
		expenses.filter((e) => e.currency === 'EUR').reduce((s, e) => s + e.amount, 0),
	);

	const PILL_LABEL: Record<FeeStatus, string> = {
		full: 'cobrat',
		partial: 'cobrament parcial',
		unpaid: 'sense cobrar',
	};
	const PILL_TONE: Record<FeeStatus, string> = { full: 'ok', partial: 'warn', unpaid: 'faint' };

	// ── dialogs ──
	let payOpen = $state(false);
	let payFee = $state<FeeRow | null>(null);
	let expOpen = $state(false);
	let openInvoice = $state<string | null>('i1');

	function openPay(f: FeeRow) {
		payFee = f;
		payOpen = true;
	}
	function handlePayment(d: PaymentDraft) {
		if (d.fee_id) {
			fees = fees.map((f) =>
				f.id === d.fee_id ? { ...f, collected: Math.min(f.fee, f.collected + d.amount) } : f,
			);
		}
		addToast({
			tone: 'success',
			message: `Pagament de ${fmtFee(d.amount, d.currency)} registrat contra el caché`,
		});
	}
	function handleExpense(d: ExpenseDraft) {
		expenses = [
			...expenses,
			{
				id: `e-${expenses.length + 1}`,
				date: d.date,
				description: d.description,
				category: d.category,
				counterparty: d.counterparty,
				currency: d.currency,
				amount: d.amount,
			},
		];
		addToast({ tone: 'success', message: `Despesa de ${fmtFee(d.amount, d.currency)} afegida` });
	}
	function goDoc() {
		goto('/dev/invoice');
	}
	function toggleInv(id: string) {
		openInvoice = openInvoice === id ? null : id;
	}

	function toggleTheme() {
		const root = document.documentElement;
		root.setAttribute('data-mode', root.getAttribute('data-mode') === 'dark' ? 'light' : 'dark');
	}
</script>

<svelte:head>
	<title>Money v3 — Hour</title>
	<meta name="robots" content="noindex" />
</svelte:head>

{#if dev}
	<header class="top">
		<span class="top__brand">hour</span>
		<div class="lensseg" role="group" aria-label="Lens">
			<button>Desk</button>
			<button>Planner</button>
			<button>Conversations</button>
			<button class="is-on">Money</button>
		</div>
		<span class="top__sp"></span>
		<span class="scopechip"><span class="scopechip__g">·</span> Fetitxes · Gira 26–27</span>
		<button class="top__theme" onclick={toggleTheme}>Tema clar / fosc</button>
	</header>

	<div class="modestrip">
		<span class="modestrip__lab">Mode de facturació</span>
		<div class="modeseg" role="group" aria-label="Mode de facturació">
			{#each MODES as m (m.v)}
				<button class:is-on={mode === m.v} onclick={() => (mode = m.v)}>{m.l}</button>
			{/each}
		</div>
		<span class="modestrip__expl"><b>{EXPL[mode].name}</b> — {EXPL[mode].rest}</span>
	</div>

	<div class="board">
		<p class="eyebrow">Money</p>
		<div class="mast">
			<h1>El <em>llibre</em> de MüK Cia</h1>
			<p class="mast__sub">
				El caché és l’àncora · cobrar i facturar són fets independents · saldos per moneda, mai
				sumats.
			</p>
		</div>

		{#if mode === 'off'}
			<div class="booknote">
				<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
					<path d="M4 5a2 2 0 0 1 2-2h12v18H6a2 2 0 0 1-2-2z" /><path d="M8 7h7M8 11h7" />
				</svg>
				<span>
					Aquest espai no emet documents. Money funciona com un <b>llibre net</b>: cachés amb estat
					de cobrament, pagaments i despeses, amb saldos per moneda.
				</span>
			</div>
		{/if}

		<!-- per-currency totals -->
		<div class="curwrap">
			{#each currencies as c (c)}
				{@const roll = rollup(c)}
				<div class="curblock">
					<div class="curblock__h">
						<span class="curblock__code">{c}</span>
						<span class="curblock__name">{currencyName(c)}</span>
					</div>
					<div class="curcards" class:n2={!showInv}>
						<div class="curcard">
							<div class="cl"><span class="dot dot--accent"></span>Pipeline</div>
							<div class="cv">{fmtMoney(roll.pipeline)}</div>
						</div>
						<div class="curcard">
							<div class="cl"><span class="dot dot--ok"></span>Cobrat</div>
							<div class="cv">{fmtMoney(roll.collected)}</div>
						</div>
						{#if showInv}
							<div class="curcard soft">
								<div class="cl"><span class="dot dot--info"></span>Facturat</div>
								<div class="cv">{fmtMoney(roll.invoiced)}</div>
							</div>
						{/if}
					</div>
				</div>
			{/each}
		</div>

		<!-- per line -->
		<section class="sec">
			<div class="sec__h"><span class="eyebrow">Per línia</span></div>
			<div class="lines">
				<button class="lrow">
					<span class="lrow__top">
						<span class="lrow__g">·</span>
						<span class="lrow__nm">Gira 26–27</span>
						<span class="lrow__proj">· Fetitxes</span>
						<span class="lrow__amt">{fmtMoney(eur.pipeline)}</span>
					</span>
					<span class="lrow__bar">
						<span class="lrow__hold" style="width:100%"></span>
						<span class="lrow__coll" style="width:{eurPct}%"></span>
					</span>
					<span class="lrow__meta">
						<span class="leg"><span class="sw sw--coll"></span>cobrat <b>{fmtMoney(eur.collected)}</b></span>
						<span class="leg"><span class="sw sw--pend"></span>pendent <b>{fmtMoney(eur.pipeline - eur.collected)}</b></span>
						<span class="leg leg--total">total línia {fmtMoney(eur.pipeline)} · {eurPct}%</span>
					</span>
				</button>
			</div>
		</section>

		<!-- fees — the anchor -->
		<section class="sec">
			<div class="sec__h">
				<span class="eyebrow">Cachés</span>
				<span class="sec__r">{fees.length} funcions · {currencies.join(' · ')}</span>
			</div>
			<div class="fees">
				{#each fees as f (f.id)}
					{@const st = feeStatus(f)}
					{@const rem = f.fee - f.collected}
					{@const cp = Math.round((f.collected / f.fee) * 100)}
					<div class="fee" data-st={st}>
						<div class="fee__top">
							<span class="fee__date">{f.date}</span>
							<span class="fee__where"><b>{f.venue}</b><span>{f.city}</span></span>
							<span class="fee__amt">
								<span class="fee__v">{fmtFee(f.fee, f.currency)}</span>
								<span class="pill" data-tone={PILL_TONE[st]}>{PILL_LABEL[st]}</span>
							</span>
						</div>
						<div class="fee__bar"><span class="fee__coll" style="width:{cp}%"></span></div>
						<div class="fee__foot">
							<span class="fee__collected">
								cobrat {fmtMoney(f.collected)} / {fmtMoney(f.fee)}{#if rem > 0}
									· <span class="fee__rem">queda {fmtMoney(rem)}</span>{/if}
							</span>
							<span class="fee__acts">
								<Button variant="outline" size="s" onclick={() => openPay(f)}>
									{#snippet lead()}+{/snippet}
									Registra pagament
								</Button>
								{#if showInv}
									{#if f.doc}
										<a class="fee__doclink" href="/dev/invoice">{f.doc}</a>
									{:else}
										<Button variant="outline" size="s" onclick={goDoc}>{createLabel}</Button>
									{/if}
								{/if}
							</span>
						</div>
					</div>
				{/each}
			</div>
		</section>

		<!-- documents -->
		{#if showInv}
			<section class="sec">
				<div class="sec__h"><span class="eyebrow">{invEyebrow}</span></div>
				{#if invoices.length === 0}
					<p class="empty">Encara cap document — crea’n un des d’un caché a dalt.</p>
				{:else}
					{#each invoices as i (i.id)}
						{@const vat = (i.subtotal * i.vat_pct) / 100}
						{@const irpf = (i.subtotal * i.irpf_pct) / 100}
						{@const total = i.subtotal + vat - irpf}
						<div class="inv">
							<button class="inv__row" class:is-open={openInvoice === i.id} onclick={() => toggleInv(i.id)}>
								<span class="inv__no">{i.number}</span>
								<span class="inv__for">{i.for_text}</span>
								<span class="inv__amt">{fmtFee(total, i.currency)}</span>
								<span class="inv__chev" aria-hidden="true">▾</span>
							</button>
							{#if openInvoice === i.id}
								<div class="inv__panel">
									<div class="inv__grid">
										<div>
											<p class="inv__k">Dates</p>
											<p class="inv__v"><span class="m">emesa {i.issue_date}</span><br /><span class="m">venciment {i.due_date}</span></p>
											<p class="inv__k inv__k--gap">Facturat a (instantània)</p>
											<p class="inv__v">{i.payer_name}<br /><span class="m">NIF {i.payer_tax_id}</span></p>
										</div>
										<div>
											<p class="inv__k">Desglossament</p>
											<dl class="brk">
												<div class="brk__r"><dt>Subtotal</dt><dd>{fmtMoney(i.subtotal)}</dd></div>
												<div class="brk__r"><dt>IVA {i.vat_pct}%</dt><dd>+ {fmtMoney(vat)}</dd></div>
												<div class="brk__r brk__r--neg"><dt>IRPF {i.irpf_pct}%</dt><dd>− {fmtMoney(irpf)}</dd></div>
												<div class="brk__r brk__r--total"><dt>Total</dt><dd>{fmtMoney(total)}</dd></div>
											</dl>
										</div>
									</div>
									<div class="inv__panelfoot">
										<a class="fee__doclink" href="/dev/invoice">Obre el document</a>
										<Button variant="outline" size="s">Anul·la</Button>
									</div>
								</div>
							{/if}
						</div>
					{/each}
				{/if}
			</section>
		{/if}

		<!-- expenses -->
		<section class="sec">
			<div class="sec__h">
				<span class="eyebrow">Despeses</span>
				<Button variant="outline" size="s" onclick={() => (expOpen = true)}>
					{#snippet lead()}+{/snippet}
					Afegeix despesa
				</Button>
			</div>
			<div class="expenses">
				{#each expenses as e (e.id)}
					<div class="exp">
						<span class="exp__date">{e.date}</span>
						<span class="exp__desc">
							<b>{e.description}</b>{#if e.counterparty}<span class="exp__meta"> · {e.counterparty}</span>{/if}
						</span>
						<span class="exp__cat">{e.category}</span>
						<span class="exp__amt">− {fmtFee(e.amount, e.currency)}</span>
					</div>
				{/each}
				<div class="exptot"><span>Total despeses · EUR</span><b>− {fmtMoney(eurExpenseTotal)}</b></div>
			</div>
		</section>
	</div>

	<RecordPaymentDialog
		bind:open={payOpen}
		fee={payFee}
		{mode}
		lineLabel={LINE_LABEL}
		projectLabel={PROJECT_LABEL}
		documents={docNumbers}
		onsave={handlePayment}
	/>
	<AddExpenseDialog
		bind:open={expOpen}
		lineLabel={LINE_LABEL}
		projectLabel={PROJECT_LABEL}
		onsave={handleExpense}
	/>
	<Toast />
{/if}

<style>
	@layer components {
		/* top chrome */
		.top {
			position: sticky;
			inset-block-start: 0;
			z-index: 10;
			display: flex;
			align-items: center;
			gap: var(--space-l);
			padding: var(--space-s) var(--space-l);
			background: color-mix(in oklch, var(--bg) 88%, transparent);
			backdrop-filter: blur(8px);
			border-block-end: 1px solid var(--border-color-light);
		}
		.top__brand {
			font-family: var(--font-display);
			font-style: italic;
			font-size: var(--text-l);
		}
		.lensseg,
		.modeseg {
			display: inline-flex;
			padding: 2px;
			background: var(--bg-ultra-light);
			border: 1px solid var(--border-color-dark);
			border-radius: var(--radius-circle);
		}
		.lensseg button,
		.modeseg button {
			border: 0;
			background: none;
			cursor: pointer;
			font-family: var(--font-sans);
			font-size: var(--text-s);
			color: var(--text-muted);
			padding: 5px 13px;
			border-radius: var(--radius-circle);
		}
		.lensseg button:hover,
		.modeseg button:hover {
			color: var(--text-color);
		}
		.lensseg button.is-on,
		.modeseg button.is-on {
			background: var(--text-color);
			color: var(--bg-ultra-light);
		}
		.top__sp {
			flex: 1;
		}
		.scopechip {
			display: inline-flex;
			align-items: center;
			gap: var(--space-xs);
			padding: 5px 13px;
			border: 1px solid var(--border-color-dark);
			border-radius: var(--radius-circle);
			background: var(--bg-ultra-light);
			font-size: var(--text-s);
			color: var(--text-muted);
		}
		.scopechip__g {
			font-family: var(--font-mono);
			color: var(--accent-1);
		}
		.top__theme {
			padding: 6px 13px;
			border: 1px solid var(--border-color-dark);
			border-radius: var(--radius-m);
			background: var(--bg-ultra-light);
			font-family: var(--font-mono);
			font-size: var(--text-xs);
			color: var(--text-muted);
			cursor: pointer;
		}

		/* mode strip */
		.modestrip {
			display: flex;
			align-items: center;
			flex-wrap: wrap;
			gap: var(--space-m);
			padding: var(--space-s) var(--space-l);
			background: var(--bg-light);
			border-block-end: 1px solid var(--border-color-light);
		}
		.modestrip__lab {
			font-family: var(--font-mono);
			font-size: var(--text-xs);
			letter-spacing: 0.13em;
			text-transform: uppercase;
			color: var(--text-faint);
		}
		.modestrip__expl {
			font-family: var(--font-display);
			font-style: italic;
			font-size: var(--text-s);
			color: var(--text-muted);
		}
		.modestrip__expl b {
			font-family: var(--font-sans);
			font-style: normal;
			font-weight: 500;
			color: var(--text-color);
		}

		/* board */
		.board {
			max-inline-size: 55rem;
			margin-inline: auto;
			padding: var(--space-xl) var(--space-l) var(--space-2xl);
		}
		.mast {
			margin-block: var(--space-s) 0;
		}
		.mast h1 {
			font-family: var(--font-display);
			font-weight: 400;
			font-size: var(--h1);
			line-height: 1.05;
			letter-spacing: -0.015em;
			margin: 0;
		}
		.mast h1 em {
			font-style: italic;
		}
		.mast__sub {
			margin-block-start: var(--space-s);
			font-size: var(--text-s);
			color: var(--text-muted);
		}

		.booknote {
			display: flex;
			gap: var(--space-s);
			align-items: flex-start;
			margin-block-start: var(--space-m);
			padding: var(--space-s) var(--space-m);
			border-radius: var(--radius-l);
			background: var(--bg-light);
			border: 1px solid var(--border-color-light);
		}
		.booknote svg {
			inline-size: 16px;
			block-size: 16px;
			flex: none;
			margin-block-start: 1px;
			color: var(--text-muted);
		}
		.booknote span {
			font-size: var(--text-s);
			color: var(--text-muted);
			line-height: 1.55;
		}

		/* per-currency cards */
		.curwrap {
			display: flex;
			flex-direction: column;
			gap: var(--space-s);
			margin-block-start: var(--space-l);
		}
		.curblock {
			overflow: hidden;
			border: 1px solid var(--border-color-dark);
			border-radius: var(--radius-l);
			background: var(--bg-ultra-light);
		}
		.curblock__h {
			display: flex;
			align-items: center;
			gap: var(--space-s);
			padding: var(--space-s) var(--space-m);
			border-block-end: 1px solid var(--border-color-light);
		}
		.curblock__code {
			font-family: var(--font-mono);
			font-size: var(--text-xs);
			font-weight: 600;
			letter-spacing: 0.06em;
			border: 1px solid var(--border-color-dark);
			border-radius: var(--radius-s);
			padding: 2px 8px;
		}
		.curblock__name {
			font-size: var(--text-s);
			color: var(--text-muted);
		}
		.curcards {
			display: grid;
			grid-template-columns: repeat(3, 1fr);
		}
		.curcards.n2 {
			grid-template-columns: repeat(2, 1fr);
		}
		.curcard {
			padding: var(--space-m);
			border-inline-end: 1px solid var(--border-color-light);
		}
		.curcard:last-child {
			border-inline-end: 0;
		}
		.cl {
			display: flex;
			align-items: center;
			gap: var(--space-xs);
			font-family: var(--font-mono);
			font-size: var(--text-xs);
			letter-spacing: 0.1em;
			text-transform: uppercase;
			color: var(--text-faint);
		}
		.dot {
			inline-size: 7px;
			block-size: 7px;
			border-radius: var(--radius-circle);
		}
		.dot--accent {
			background: var(--accent-1);
		}
		.dot--ok {
			background: var(--success);
		}
		.dot--info {
			background: var(--info);
		}
		.cv {
			margin-block-start: var(--space-s);
			font-family: var(--font-display);
			font-size: var(--text-xxl);
			line-height: 1;
			font-variant-numeric: tabular-nums;
		}
		.curcard.soft .cv {
			color: var(--text-muted);
		}

		/* section head */
		.sec {
			margin-block-start: var(--space-xl);
		}
		.sec__h {
			display: flex;
			align-items: flex-end;
			justify-content: space-between;
			gap: var(--space-s);
			padding-block-end: var(--space-xs);
			border-block-end: 1px solid var(--border-color-light);
			margin-block-end: var(--space-m);
		}
		.sec__r {
			font-family: var(--font-mono);
			font-size: var(--text-xs);
			color: var(--text-faint);
		}

		/* by-line rollup */
		.lines {
			display: flex;
			flex-direction: column;
			gap: var(--space-s);
		}
		.lrow {
			display: block;
			inline-size: 100%;
			text-align: start;
			font-family: inherit;
			padding: var(--space-m);
			border: 1px solid var(--border-color-dark);
			border-radius: var(--radius-l);
			background: var(--bg-ultra-light);
			cursor: pointer;
		}
		.lrow:hover {
			border-color: var(--text-faint);
		}
		.lrow__top {
			display: flex;
			align-items: center;
			gap: var(--space-s);
		}
		.lrow__g {
			color: var(--accent-1);
		}
		.lrow__nm {
			font-size: var(--text-m);
			font-weight: 500;
		}
		.lrow__proj {
			font-size: var(--text-xs);
			color: var(--text-faint);
		}
		.lrow__amt {
			margin-inline-start: auto;
			font-family: var(--font-mono);
			font-size: var(--text-m);
			font-variant-numeric: tabular-nums;
		}
		.lrow__bar {
			display: block;
			position: relative;
			block-size: 8px;
			border-radius: var(--radius-circle);
			background: var(--bg-light);
			margin-block: var(--space-s);
			overflow: hidden;
		}
		.lrow__hold,
		.lrow__coll {
			position: absolute;
			inset-block: 0;
			inset-inline-start: 0;
			block-size: 100%;
			border-radius: var(--radius-circle);
		}
		.lrow__hold {
			background: color-mix(in oklch, var(--accent-1) 30%, var(--bg-light));
		}
		.lrow__coll {
			background: var(--success);
		}
		.lrow__meta {
			display: flex;
			align-items: center;
			gap: var(--space-m);
			flex-wrap: wrap;
			font-size: var(--text-xs);
			color: var(--text-muted);
		}
		.leg {
			display: inline-flex;
			align-items: center;
			gap: var(--space-xs);
		}
		.leg b {
			font-family: var(--font-mono);
			font-weight: 500;
			color: var(--text-color);
			font-variant-numeric: tabular-nums;
		}
		.sw {
			inline-size: 9px;
			block-size: 9px;
			border-radius: 3px;
		}
		.sw--coll {
			background: var(--success);
		}
		.sw--pend {
			background: color-mix(in oklch, var(--accent-1) 30%, var(--bg-light));
		}
		.leg--total {
			margin-inline-start: auto;
			font-family: var(--font-mono);
			color: var(--text-faint);
		}

		/* fees */
		.fees {
			display: flex;
			flex-direction: column;
			gap: var(--space-s);
		}
		.fee {
			padding: var(--space-m);
			border: 1px solid var(--border-color-dark);
			border-inline-start-width: 3px;
			border-radius: var(--radius-l);
			background: var(--bg-ultra-light);
		}
		.fee:hover {
			border-color: var(--text-faint);
		}
		.fee[data-st='full'] {
			border-inline-start-color: var(--success);
		}
		.fee[data-st='partial'] {
			border-inline-start-color: var(--warning);
		}
		.fee[data-st='unpaid'] {
			border-inline-start-color: var(--border-color-dark);
		}
		.fee__top {
			display: grid;
			grid-template-columns: 64px 1fr auto;
			align-items: baseline;
			gap: var(--space-m);
		}
		.fee__date {
			font-family: var(--font-mono);
			font-size: var(--text-xs);
			color: var(--text-muted);
			font-variant-numeric: tabular-nums;
		}
		.fee__where b {
			font-size: var(--text-m);
			font-weight: 500;
		}
		.fee__where span {
			display: block;
			font-size: var(--text-xs);
			color: var(--text-muted);
		}
		.fee__amt {
			text-align: end;
		}
		.fee__v {
			font-family: var(--font-mono);
			font-size: var(--text-m);
			font-variant-numeric: tabular-nums;
		}
		.pill {
			display: inline-block;
			margin-block-start: 5px;
			font-family: var(--font-mono);
			font-size: var(--text-xs);
			letter-spacing: 0.04em;
			text-transform: lowercase;
			padding: 2px 8px;
			border-radius: var(--radius-circle);
			border: 1px solid var(--border-color-dark);
			color: var(--text-muted);
			white-space: nowrap;
		}
		.pill[data-tone='ok'] {
			color: var(--success);
			border-color: color-mix(in oklch, var(--success) 42%, var(--border-color-light));
		}
		.pill[data-tone='warn'] {
			color: var(--warning);
			border-color: color-mix(in oklch, var(--warning) 42%, var(--border-color-light));
		}
		.pill[data-tone='faint'] {
			color: var(--text-faint);
		}
		.fee__bar {
			block-size: 6px;
			border-radius: var(--radius-circle);
			background: var(--bg-light);
			margin-block: var(--space-m) var(--space-s);
			overflow: hidden;
		}
		.fee__coll {
			display: block;
			block-size: 100%;
			border-radius: var(--radius-circle);
			background: var(--success);
		}
		.fee__foot {
			display: flex;
			align-items: center;
			gap: var(--space-m);
			padding-block-start: var(--space-s);
			border-block-start: 1px solid var(--border-color-light);
		}
		.fee__collected {
			font-family: var(--font-mono);
			font-size: var(--text-xs);
			color: var(--text-muted);
			font-variant-numeric: tabular-nums;
		}
		.fee__rem {
			color: var(--text-faint);
		}
		.fee__acts {
			margin-inline-start: auto;
			display: flex;
			gap: var(--space-xs);
			align-items: center;
		}
		.fee__doclink {
			display: inline-flex;
			align-items: center;
			padding: 5px 10px;
			border: 1px solid var(--border-color-dark);
			border-radius: var(--radius-s);
			font-family: var(--font-mono);
			font-size: var(--text-xs);
			color: var(--text-muted);
		}
		.fee__doclink:hover {
			color: var(--text-color);
			text-decoration: none;
			border-color: var(--text-faint);
		}

		/* documents */
		.inv {
			overflow: hidden;
			border: 1px solid var(--border-color-dark);
			border-radius: var(--radius-m);
			background: var(--bg-ultra-light);
			margin-block-start: var(--space-s);
		}
		.inv__row {
			display: grid;
			grid-template-columns: auto 1fr auto auto;
			align-items: center;
			gap: var(--space-m);
			inline-size: 100%;
			text-align: start;
			padding: var(--space-s) var(--space-m);
			background: none;
			border: 0;
			cursor: pointer;
		}
		.inv__row:hover {
			background: var(--bg-light);
		}
		.inv__no {
			font-family: var(--font-mono);
			font-size: var(--text-s);
			font-variant-numeric: tabular-nums;
		}
		.inv__for {
			font-size: var(--text-s);
			color: var(--text-muted);
		}
		.inv__amt {
			font-family: var(--font-mono);
			font-size: var(--text-s);
			font-variant-numeric: tabular-nums;
		}
		.inv__chev {
			color: var(--text-faint);
			transition: transform 0.15s ease;
		}
		.inv__row.is-open .inv__chev {
			transform: rotate(180deg);
		}
		.inv__panel {
			padding: 0 var(--space-m) var(--space-m);
			border-block-start: 1px solid var(--border-color-light);
		}
		.inv__grid {
			display: grid;
			grid-template-columns: 1fr 1fr;
			gap: var(--space-l);
			padding-block: var(--space-m);
		}
		@media (max-width: 640px) {
			.inv__grid {
				grid-template-columns: 1fr;
				gap: var(--space-m);
			}
		}
		.inv__k {
			font-family: var(--font-mono);
			font-size: var(--text-xs);
			letter-spacing: 0.1em;
			text-transform: uppercase;
			color: var(--text-faint);
			margin-block-end: var(--space-xs);
		}
		.inv__k--gap {
			margin-block-start: var(--space-m);
		}
		.inv__v {
			font-size: var(--text-s);
			color: var(--text-muted);
			line-height: 1.5;
		}
		.inv__v .m {
			font-family: var(--font-mono);
			font-size: var(--text-xs);
		}
		.brk {
			margin: 0;
			overflow: hidden;
			border: 1px solid var(--border-color-light);
			border-radius: var(--radius-s);
		}
		.brk__r {
			display: flex;
			justify-content: space-between;
			padding: 7px 12px;
			font-size: var(--text-s);
			border-block-start: 1px solid var(--border-color-light);
		}
		.brk__r:first-child {
			border-block-start: 0;
		}
		.brk__r dt {
			color: var(--text-muted);
		}
		.brk__r dd {
			margin: 0;
			font-family: var(--font-mono);
			font-variant-numeric: tabular-nums;
		}
		.brk__r--neg dd {
			color: var(--danger);
		}
		.brk__r--total {
			background: var(--bg-light);
		}
		.brk__r--total dt {
			font-weight: 600;
			color: var(--text-color);
		}
		.brk__r--total dd {
			font-family: var(--font-display);
			font-size: var(--text-m);
		}
		.inv__panelfoot {
			display: flex;
			gap: var(--space-s);
			align-items: center;
			padding-block-start: var(--space-xs);
		}

		/* expenses */
		.expenses {
			overflow: hidden;
			border: 1px solid var(--border-color-dark);
			border-radius: var(--radius-l);
			background: var(--bg-ultra-light);
		}
		.exp {
			display: grid;
			grid-template-columns: 64px 1fr auto auto;
			align-items: baseline;
			gap: var(--space-m);
			padding: var(--space-s) var(--space-m);
			border-block-start: 1px solid var(--border-color-light);
		}
		.exp:first-child {
			border-block-start: 0;
		}
		.exp__date {
			font-family: var(--font-mono);
			font-size: var(--text-xs);
			color: var(--text-muted);
			font-variant-numeric: tabular-nums;
		}
		.exp__desc b {
			font-size: var(--text-s);
			font-weight: 500;
		}
		.exp__meta {
			font-size: var(--text-xs);
			color: var(--text-muted);
		}
		.exp__cat {
			font-family: var(--font-mono);
			font-size: var(--text-xs);
			color: var(--text-muted);
			border: 1px solid var(--border-color-dark);
			border-radius: var(--radius-s);
			padding: 2px 7px;
		}
		.exp__amt {
			font-family: var(--font-mono);
			font-size: var(--text-s);
			color: var(--danger);
			text-align: end;
			font-variant-numeric: tabular-nums;
		}
		.exptot {
			display: flex;
			justify-content: space-between;
			padding: var(--space-s) var(--space-m);
			font-size: var(--text-s);
			color: var(--text-muted);
			background: var(--bg-light);
			border-block-start: 1px solid var(--border-color-light);
		}
		.exptot b {
			font-family: var(--font-mono);
			font-variant-numeric: tabular-nums;
		}

		.empty {
			font-family: var(--font-display);
			font-style: italic;
			font-size: var(--text-m);
			color: var(--text-faint);
			padding-block: var(--space-xl);
			text-align: center;
		}

		@media (max-width: 640px) {
			.curcards,
			.curcards.n2 {
				grid-template-columns: 1fr;
			}
			.curcard {
				border-inline-end: 0;
				border-block-end: 1px solid var(--border-color-light);
			}
			.curcard:last-child {
				border-block-end: 0;
			}
			.fee__top {
				grid-template-columns: 1fr auto;
			}
			.fee__date {
				grid-column: 1 / -1;
			}
		}
	}
</style>
