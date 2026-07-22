<script lang="ts">
	/**
	 * Fiscal identities / invoicing settings preview (dev only) — the design
	 * harness for money v3 · Part B (ADR-086). Renders the settings surface
	 * (invoicing mode · issuer wiring · identity lists) and hosts the reusable
	 * FiscalIdentityDialog. Sample data only: no schema, no fetch. When the
	 * build lands, this surface moves into the real workspace settings route.
	 */

	import { dev } from '$app/environment';
	import { goto } from '$app/navigation';
	import { onMount } from 'svelte';
	import Button from '$lib/components/Button.svelte';
	import FiscalIdentityDialog from '$lib/components/FiscalIdentityDialog.svelte';
	import IdentityMark from '$lib/components/IdentityMark.svelte';
	import Toast, { addToast } from '$lib/components/Toast.svelte';
	import { accentVar } from '$lib/utils/accent';
	import {
		INVOICING_MODES,
		type FiscalIdentity,
		type FiscalIdentityKind,
		type InvoicingMode,
		type IssuerWiring,
	} from '$lib/fiscal';

	onMount(() => {
		if (!dev) goto('/', { replaceState: true });
	});

	let mode = $state<InvoicingMode>('legal');
	let wiring = $state<IssuerWiring>('account');

	let issuers = $state<FiscalIdentity[]>([
		{
			id: 'muk',
			kind: 'issuer',
			label: 'companyia',
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
			default_vat_pct: 21,
			default_irpf_pct: 15,
		},
		{
			id: 'maria',
			kind: 'issuer',
			label: 'freelance',
			legal_name: 'María Freelance',
			tax_id: 'ES 44112233X',
			address_line_1: 'Carrer del Carme 8',
			address_line_2: '3r 2a',
			postal_code: '08001',
			city: 'Barcelona',
			region: 'Catalunya',
			country: 'Espanya',
			iban: 'ES76 0049 1500 0512 3456 7890',
			swift_bic: 'BSCHESMMXXX',
			default_vat_pct: 21,
			default_irpf_pct: 7,
		},
	]);

	let receivers = $state<FiscalIdentity[]>([
		{
			id: 'teatre',
			kind: 'receiver',
			label: 'sala',
			legal_name: 'Teatre Municipal de Girona',
			tax_id: 'P1708500A',
			address_line_1: 'Plaça del Vi 1',
			postal_code: '17004',
			city: 'Girona',
			region: 'Catalunya',
			country: 'Espanya',
			bare: false,
		},
		{
			id: 'salt',
			kind: 'receiver',
			label: 'sala',
			legal_name: 'Teatre Auditori de Salt',
			tax_id: '',
			address_line_1: '',
			postal_code: '',
			city: 'Salt',
			region: '',
			country: 'Espanya',
			bare: true,
		},
	]);

	const accountIdentity = $derived(issuers.find((x) => x.id === 'maria') ?? issuers[0]);
	const workspaceIdentity = $derived(issuers.find((x) => x.id === 'muk') ?? issuers[0]);
	const resolved = $derived<FiscalIdentity | undefined>(
		wiring === 'account' ? accountIdentity : workspaceIdentity,
	);

	function issuerMeta(x: FiscalIdentity): string {
		return `NIF ${x.tax_id}${x.iban ? ` · ${x.iban.slice(0, 7)}…` : ''}`;
	}
	function receiverMeta(x: FiscalIdentity): string {
		return x.bare ? 'només nom · sense dades fiscals' : `NIF ${x.tax_id} · ${x.city}`;
	}

	// ── dialog ──
	let dialogOpen = $state(false);
	let dialogKind = $state<FiscalIdentityKind>('issuer');
	let editing = $state<FiscalIdentity | null>(null);

	function openNew(kind: FiscalIdentityKind) {
		dialogKind = kind;
		editing = null;
		dialogOpen = true;
	}
	function openEdit(x: FiscalIdentity) {
		dialogKind = x.kind;
		editing = x;
		dialogOpen = true;
	}
	function handleSave(record: FiscalIdentity) {
		const wasEditing = !!editing;
		const arr = record.kind === 'issuer' ? issuers : receivers;
		const i = arr.findIndex((a) => a.id === record.id);
		if (record.kind === 'issuer') {
			issuers = i >= 0 ? issuers.map((a) => (a.id === record.id ? record : a)) : [record, ...issuers];
		} else {
			receivers =
				i >= 0 ? receivers.map((a) => (a.id === record.id ? record : a)) : [record, ...receivers];
		}
		addToast({ tone: 'success', message: wasEditing ? 'Identitat desada' : 'Identitat creada' });
	}
	function handleArchive(id: string) {
		const it = issuers.find((a) => a.id === id) ?? receivers.find((a) => a.id === id);
		if (!it) return;
		it.archived = !it.archived;
		addToast({ tone: 'info', message: it.archived ? 'Identitat arxivada' : 'Identitat restaurada' });
	}

	function toggleTheme() {
		const root = document.documentElement;
		root.setAttribute('data-mode', root.getAttribute('data-mode') === 'dark' ? 'light' : 'dark');
	}
</script>

<svelte:head>
	<title>Facturació — Hour</title>
	<meta name="robots" content="noindex" />
</svelte:head>

{#snippet idRow(x: FiscalIdentity, meta: string)}
	<button type="button" class="idrow" class:is-arch={x.archived} onclick={() => openEdit(x)}>
		<IdentityMark accent={accentVar(x.id)} name={x.legal_name} size="38px" />
		<span class="idrow__body">
			<span class="idrow__nm">
				<span class="idrow__legal">{x.legal_name}</span>
				{#if x.label}<span class="idrow__label">{x.label}</span>{/if}
			</span>
			<span class="idrow__meta">{meta}</span>
		</span>
		<span class="idrow__go" aria-hidden="true">›</span>
	</button>
{/snippet}

{#if dev}
	<div class="devbar">
		<span class="devbar__brand">hour</span>
		<span class="devbar__crumb">MüK Cia · Ajustos · <b>Facturació</b></span>
		<span class="devbar__sp"></span>
		<button class="devbar__theme" onclick={toggleTheme}>Tema clar / fosc</button>
	</div>

	<div class="board">
		<p class="eyebrow">Ajustos · Espai</p>
		<div class="mast">
			<h1>Facturació</h1>
			<p class="mast__sub">
				Com aquest espai registra i emet diners. El caché és l’àncora; el document és opcional i
				depèn del mode.
			</p>
		</div>

		<!-- B4 · invoicing mode -->
		<section class="sec">
			<p class="eyebrow sec__eye">Mode de facturació</p>
			<div class="modes">
				{#each INVOICING_MODES as m (m.id)}
					<button
						type="button"
						class="mode"
						class:is-on={mode === m.id}
						aria-pressed={mode === m.id}
						onclick={() => (mode = m.id)}
					>
						<span class="mode__radio" aria-hidden="true"></span>
						<span class="mode__body">
							<span class="mode__title">{m.title} <span class="mode__tag">{m.id}</span></span>
							<span class="mode__cons">{m.consequence}</span>
						</span>
					</button>
				{/each}
			</div>
		</section>

		<!-- B3 · issuer wiring -->
		<section class="sec" class:is-dim={mode === 'off'}>
			<p class="eyebrow sec__eye">Qui factura des d’aquest espai</p>
			<p class="sec__desc">
				Per defecte s’emet amb la identitat del compte. Un espai pot sobreescriure-la amb la seva
				pròpia identitat emissora — el cas del freelance que factura com a persona, no com a
				companyia.
			</p>
			<div class="wire">
				{#if resolved}
					<div class="wire__resolved">
						<IdentityMark accent={accentVar(resolved.id)} name={resolved.legal_name} size="44px" />
						<div>
							<p class="wire__lab">Identitat resolta</p>
							<p class="wire__name">{resolved.legal_name}</p>
						</div>
					</div>
				{/if}
				<p class="wire__lab">Origen</p>
				<div class="wire__opts">
					<button
						type="button"
						class="wire__opt"
						class:is-on={wiring === 'account'}
						onclick={() => (wiring = 'account')}
					>
						<span class="wire__radio" aria-hidden="true"></span>
						<span class="wire__txt">
							<b>Identitat del compte</b>
							<span>{accountIdentity?.legal_name} · {accountIdentity?.tax_id}</span>
						</span>
					</button>
					<button
						type="button"
						class="wire__opt"
						class:is-on={wiring === 'override'}
						onclick={() => (wiring = 'override')}
					>
						<span class="wire__radio" aria-hidden="true"></span>
						<span class="wire__txt">
							<b>Sobreescriu per aquest espai</b>
							<span>{workspaceIdentity?.legal_name} · {workspaceIdentity?.tax_id}</span>
						</span>
					</button>
				</div>
			</div>
		</section>

		<!-- B3 · identities -->
		<section class="sec">
			<div class="sec__head">
				<p class="eyebrow">Identitats fiscals</p>
				<Button variant="outline" size="s" onclick={() => openNew('issuer')}>
					{#snippet lead()}+{/snippet}
					Nova identitat
				</Button>
			</div>
			<p class="grouphead">Emissores · les teves</p>
			<div class="idlist">
				{#each issuers as x (x.id)}
					{@render idRow(x, issuerMeta(x))}
				{/each}
			</div>
			<p class="grouphead">Receptores · qui et paga</p>
			<div class="idlist">
				{#each receivers as x (x.id)}
					{@render idRow(x, receiverMeta(x))}
				{/each}
			</div>
		</section>
	</div>

	<FiscalIdentityDialog
		bind:open={dialogOpen}
		kind={dialogKind}
		identity={editing}
		onsave={handleSave}
		onarchive={handleArchive}
	/>
	<Toast />
{/if}

<style>
	@layer components {
		.devbar {
			position: sticky;
			inset-block-start: 0;
			z-index: 10;
			display: flex;
			align-items: center;
			gap: var(--space-m);
			padding: var(--space-s) var(--space-l);
			background: color-mix(in oklch, var(--bg) 88%, transparent);
			backdrop-filter: blur(8px);
			border-block-end: 1px solid var(--border-color-light);
		}
		.devbar__brand {
			font-family: var(--font-display);
			font-style: italic;
			font-size: var(--text-l);
		}
		.devbar__crumb {
			font-size: var(--text-s);
			color: var(--text-muted);
		}
		.devbar__crumb b {
			color: var(--text-color);
			font-weight: 500;
		}
		.devbar__sp {
			flex: 1;
		}
		.devbar__theme {
			padding: 7px 14px;
			border: 1px solid var(--border-color-dark);
			border-radius: var(--radius-m);
			background: var(--bg-ultra-light);
			font-family: var(--font-mono);
			font-size: var(--text-xs);
			color: var(--text-muted);
			cursor: pointer;
		}
		.devbar__theme:hover {
			color: var(--text-color);
		}

		.board {
			max-inline-size: 52rem;
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
		.mast__sub {
			margin-block-start: var(--space-s);
			max-inline-size: 60ch;
			font-size: var(--text-s);
			color: var(--text-muted);
		}

		.sec {
			margin-block-start: var(--space-xl);
		}
		.sec.is-dim {
			opacity: 0.5;
			pointer-events: none;
		}
		.sec__eye {
			padding-block-end: var(--space-xs);
			border-block-end: 1px solid var(--border-color-light);
			margin-block-end: var(--space-m);
		}
		.sec__desc {
			margin-block: calc(-1 * var(--space-xs)) var(--space-m);
			max-inline-size: 64ch;
			font-size: var(--text-s);
			color: var(--text-muted);
		}
		.sec__head {
			display: flex;
			align-items: flex-end;
			justify-content: space-between;
			gap: var(--space-s);
			padding-block-end: var(--space-xs);
			border-block-end: 1px solid var(--border-color-light);
			margin-block-end: var(--space-m);
		}

		/* mode radio cards */
		.modes {
			display: flex;
			flex-direction: column;
			gap: var(--space-s);
		}
		.mode {
			display: flex;
			align-items: flex-start;
			gap: var(--space-s);
			padding: var(--space-m);
			text-align: start;
			border: 1px solid var(--border-color-dark);
			border-radius: var(--radius-l);
			background: var(--bg-ultra-light);
			cursor: pointer;
		}
		.mode:hover {
			border-color: var(--text-faint);
		}
		.mode.is-on {
			border-color: var(--primary);
			box-shadow: 0 0 0 3px color-mix(in oklch, var(--primary) 18%, transparent);
		}
		.mode__radio {
			inline-size: 18px;
			block-size: 18px;
			flex: none;
			margin-block-start: 2px;
			border: 1.5px solid var(--border-color-dark);
			border-radius: var(--radius-circle);
			display: grid;
			place-items: center;
		}
		.mode.is-on .mode__radio {
			border-color: var(--primary);
		}
		.mode.is-on .mode__radio::after {
			content: '';
			inline-size: 9px;
			block-size: 9px;
			border-radius: var(--radius-circle);
			background: var(--primary);
		}
		.mode__title {
			display: flex;
			align-items: center;
			gap: var(--space-s);
			font-size: var(--text-m);
			font-weight: 500;
		}
		.mode__tag {
			font-family: var(--font-mono);
			font-size: var(--text-xs);
			letter-spacing: 0.06em;
			text-transform: uppercase;
			color: var(--text-muted);
			border: 1px solid var(--border-color-dark);
			border-radius: var(--radius-s);
			padding: 1px 6px;
		}
		.mode__cons {
			display: block;
			margin-block-start: var(--space-2xs);
			font-size: var(--text-s);
			color: var(--text-muted);
			line-height: 1.5;
		}

		/* issuer wiring */
		.wire {
			padding: var(--space-m);
			border: 1px solid var(--border-color-dark);
			border-radius: var(--radius-l);
			background: var(--bg-ultra-light);
		}
		.wire__resolved {
			display: flex;
			align-items: center;
			gap: var(--space-s);
			padding-block-end: var(--space-m);
			border-block-end: 1px solid var(--border-color-light);
			margin-block-end: var(--space-m);
		}
		.wire__lab {
			font-family: var(--font-mono);
			font-size: var(--text-xs);
			letter-spacing: 0.1em;
			text-transform: uppercase;
			color: var(--text-faint);
			margin-block-end: var(--space-s);
		}
		.wire__name {
			font-size: var(--text-m);
			font-weight: 500;
		}
		.wire__opts {
			display: flex;
			flex-direction: column;
			gap: var(--space-s);
		}
		.wire__opt {
			display: flex;
			align-items: center;
			gap: var(--space-s);
			padding: var(--space-s) var(--space-m);
			text-align: start;
			border: 1px solid var(--border-color-dark);
			border-radius: var(--radius-m);
			background: var(--bg-light);
			cursor: pointer;
		}
		.wire__opt:hover {
			border-color: var(--text-faint);
		}
		.wire__opt.is-on {
			border-color: var(--primary);
			background: var(--bg-ultra-light);
			box-shadow: 0 0 0 2px color-mix(in oklch, var(--primary) 16%, transparent);
		}
		.wire__radio {
			inline-size: 16px;
			block-size: 16px;
			flex: none;
			border: 1.5px solid var(--border-color-dark);
			border-radius: var(--radius-circle);
			display: grid;
			place-items: center;
		}
		.wire__opt.is-on .wire__radio {
			border-color: var(--primary);
		}
		.wire__opt.is-on .wire__radio::after {
			content: '';
			inline-size: 8px;
			block-size: 8px;
			border-radius: var(--radius-circle);
			background: var(--primary);
		}
		.wire__txt {
			font-size: var(--text-s);
		}
		.wire__txt b {
			font-weight: 500;
		}
		.wire__txt span {
			display: block;
			margin-block-start: 1px;
			font-size: var(--text-xs);
			color: var(--text-muted);
		}

		/* identity list */
		.grouphead {
			font-family: var(--font-mono);
			font-size: var(--text-xs);
			letter-spacing: 0.12em;
			text-transform: uppercase;
			color: var(--text-faint);
			margin-block: var(--space-m) var(--space-s);
		}
		.idlist {
			display: flex;
			flex-direction: column;
			gap: var(--space-s);
		}
		.idrow {
			display: flex;
			align-items: center;
			gap: var(--space-s);
			inline-size: 100%;
			padding: var(--space-s) var(--space-m);
			text-align: start;
			border: 1px solid var(--border-color-dark);
			border-radius: var(--radius-l);
			background: var(--bg-ultra-light);
			cursor: pointer;
		}
		.idrow:hover {
			border-color: var(--text-faint);
		}
		.idrow.is-arch {
			opacity: 0.55;
		}
		.idrow__body {
			flex: 1;
			min-inline-size: 0;
		}
		.idrow__nm {
			display: flex;
			align-items: center;
			gap: var(--space-s);
			font-size: var(--text-m);
			font-weight: 500;
		}
		.idrow__legal {
			font-family: var(--font-display);
		}
		.idrow__label {
			font-family: var(--font-mono);
			font-size: var(--text-xs);
			color: var(--text-muted);
			border: 1px solid var(--border-color-dark);
			border-radius: var(--radius-s);
			padding: 1px 6px;
		}
		.idrow__meta {
			display: block;
			margin-block-start: 3px;
			font-family: var(--font-mono);
			font-size: var(--text-xs);
			color: var(--text-muted);
		}
		.idrow__go {
			color: var(--text-faint);
			font-size: var(--text-l);
		}
	}
</style>
