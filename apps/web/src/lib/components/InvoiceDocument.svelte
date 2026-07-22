<script lang="ts">
	/**
	 * Invoice document — the printable Factura / Proforma (ADR-086, money v3 ·
	 * design Part A). The render body, mirroring RoadsheetView: pure presentation
	 * over an already-frozen projection. The same house style as the public road
	 * sheet — narrow measure, Newsreader masthead, mono metadata, hairline
	 * dividers — carried onto a fiscal document. Print-first (A4), but reads on
	 * screen as the preview before issuing.
	 *
	 * Reuses IdentityMark for the issuer monogram and fmtMoney as the single
	 * money formatter (money.ts). State (draft / issued / paid) drives the corner
	 * tag, watermark and paid stamp; mode (legal / interno) drives the type
	 * label, the receiver block and the proforma note. Labels stay in Catalan —
	 * the issuer's fiscal language, to be parameterised by issuer locale later.
	 */

	import IdentityMark from '$lib/components/IdentityMark.svelte';
	import { fmtMoney } from '$lib/money';
	import { addressLines, invoiceTotals, type InvoiceDoc } from '$lib/invoice';

	let { doc }: { doc: InvoiceDoc } = $props();

	const t = $derived(invoiceTotals(doc));
	const legal = $derived(doc.mode === 'legal');
	const issued = $derived(doc.status === 'issued' || doc.status === 'paid');
	const paid = $derived(doc.status === 'paid');
	const typeLabel = $derived(legal ? 'FACTURA' : 'PROFORMA');
	const numberLabel = $derived(issued ? (doc.number ?? '—') : 'ESBORRANY');
	const payRef = $derived(
		doc.payment_reference ?? (issued ? (doc.number ?? '') : `${typeLabel} · esborrany`),
	);
	const issuerAddr = $derived(addressLines(doc.issuer));
	const receiverAddr = $derived(doc.receiver ? addressLines(doc.receiver) : null);
</script>

<article
	class="inv"
	class:inv--issued={issued}
	class:inv--paid={paid}
	aria-label={`${typeLabel} ${issued ? (doc.number ?? '') : 'esborrany'}`}
>
	{#if !issued}
		<div class="inv__draft-tag" aria-hidden="true">Esborrany</div>
		<div class="inv__watermark" aria-hidden="true"><span>Esborrany</span></div>
	{/if}
	{#if paid}
		<div class="inv__paid" aria-hidden="true">
			<span class="inv__paid-label">Pagada</span>
			{#if doc.paid_date}<span class="inv__paid-date">{doc.paid_date}</span>{/if}
		</div>
	{/if}

	<div class="inv__pad">
		<header class="inv__mh">
			<div class="inv__mh-id">
				<IdentityMark
					accent={doc.issuer_accent}
					initials={doc.issuer_initials}
					name={doc.issuer.legal_name}
					size="44px"
				/>
				<span class="inv__issuer">
					{doc.issuer.legal_name}
					<span class="inv__issuer-tax">{doc.issuer.tax_id}</span>
				</span>
			</div>
			<div class="inv__mh-doc">
				<div class="inv__type">{typeLabel}</div>
				<div class="inv__no" class:inv__no--draft={!issued}>{numberLabel}</div>
			</div>
		</header>

		<dl class="inv__dates">
			<div><dt>Data d'emissió</dt><dd>{doc.issue_date}</dd></div>
			<div><dt>Venciment</dt><dd>{doc.due_date}</dd></div>
			<div><dt>Cobrament previst</dt><dd>{doc.expected_period}</dd></div>
		</dl>

		<section class="inv__parties">
			<div class="inv__party">
				<h2 class="eyebrow eyebrow--sub inv__eye">Emissor</h2>
				<p class="inv__party-name">{doc.issuer.legal_name}</p>
				<div class="inv__rows">
					<span class="inv__mono"><span class="inv__kk">NIF</span>{doc.issuer.tax_id}</span>
					<span class="inv__row">{issuerAddr[0]}</span>
					<span class="inv__row">{issuerAddr[1]}</span>
					{#if doc.issuer.iban}
						<span class="inv__mono inv__mono--gap"><span class="inv__kk">IBAN</span>{doc.issuer.iban}</span>
					{/if}
					{#if doc.issuer.swift_bic}
						<span class="inv__mono"><span class="inv__kk">SWIFT</span>{doc.issuer.swift_bic}</span>
					{/if}
				</div>
			</div>

			<div class="inv__party">
				<h2 class="eyebrow eyebrow--sub inv__eye">Facturar a</h2>
				<p class="inv__party-name">{doc.receiver_name}</p>
				{#if doc.receiver && receiverAddr}
					<div class="inv__rows">
						<span class="inv__mono"><span class="inv__kk">NIF</span>{doc.receiver.tax_id}</span>
						<span class="inv__row">{receiverAddr[0]}</span>
						<span class="inv__row">{receiverAddr[1]}</span>
					</div>
				{:else}
					<p class="inv__party-miss">
						Sense dades fiscals — receptor només per nom (no requerit en proforma).
					</p>
				{/if}
			</div>
		</section>

		<section class="inv__items">
			<h2 class="eyebrow eyebrow--sub inv__eye inv__eye--plain">Conceptes</h2>
			<table class="inv__lines">
				<thead>
					<tr>
						<th>Descripció</th>
						<th class="inv__num">Qt</th>
						<th class="inv__num">Preu unitari</th>
						<th class="inv__num">Import</th>
					</tr>
				</thead>
				<tbody>
					{#each doc.lines as line, i (i)}
						<tr>
							<td class="inv__desc">
								<b>{line.project}</b>
								<span class="inv__desc-meta">{line.venue}, {line.city} — {line.date}</span>
							</td>
							<td class="inv__qty">{line.qty}</td>
							<td class="inv__num">{fmtMoney(line.unit)}</td>
							<td class="inv__num">{fmtMoney(line.qty * line.unit)}</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</section>

		<div class="inv__totwrap">
			<dl class="inv__totals">
				<div class="inv__tr inv__tr--sub"><dt>Subtotal</dt><dd>{fmtMoney(t.subtotal)}</dd></div>
				{#if doc.vat_pct}
					<div class="inv__tr inv__tr--add">
						<dt>IVA <span class="inv__pct">{doc.vat_pct}%</span></dt>
						<dd>+ {fmtMoney(t.vat)}</dd>
					</div>
				{/if}
				{#if doc.irpf_pct}
					<div class="inv__tr inv__tr--neg">
						<dt>Retenció IRPF <span class="inv__pct">{doc.irpf_pct}%</span></dt>
						<dd>− {fmtMoney(t.irpf)}</dd>
					</div>
				{/if}
				<div class="inv__tr inv__tr--total">
					<dt>Total</dt>
					<dd>{fmtMoney(t.total)}<span class="inv__cur">{doc.currency}</span></dd>
				</div>
			</dl>
		</div>

		<footer class="inv__foot">
			<div>
				<h2 class="eyebrow eyebrow--sub inv__foot-eye">Pagament</h2>
				{#if doc.issuer.iban}
					<p class="inv__mono"><span class="inv__kk">IBAN</span>{doc.issuer.iban}</p>
				{/if}
				{#if doc.issuer.swift_bic}
					<p class="inv__mono"><span class="inv__kk">SWIFT</span>{doc.issuer.swift_bic}</p>
				{/if}
				<p class="inv__mono inv__mono--gap"><span class="inv__kk">Concepte</span>{payRef}</p>
			</div>
			<div>
				<h2 class="eyebrow eyebrow--sub inv__foot-eye">Condicions</h2>
				<p class="inv__terms">{doc.payment_terms}</p>
				{#if legal}
					<p class="inv__legal">{doc.legal_note}</p>
				{/if}
			</div>
		</footer>

		{#if !legal}
			<div class="inv__pfnote">
				<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
					<circle cx="12" cy="12" r="10" /><path d="M12 8v5M12 16h.01" />
				</svg>
				<span>
					<b>Proforma — no és una factura fiscal vàlida.</b> Document intern amb numeració pròpia; la
					factura legal s'emet per un altre sistema.
				</span>
			</div>
		{/if}
	</div>
</article>

<style>
	@layer components {
		.inv {
			position: relative;
			overflow: hidden;
			inline-size: 100%;
			background: var(--bg-ultra-light);
			color: var(--text-color);
			border: 1px solid var(--border-color-light);
			border-radius: var(--radius-s);
			box-shadow: var(--box-shadow-3);
		}

		.inv__pad {
			position: relative;
			z-index: 1;
			padding: clamp(2.2rem, 5vw, 3.5rem) clamp(1.8rem, 5vw, 3.75rem);
		}

		/* ── draft tag · watermark · paid stamp ── */
		.inv__draft-tag {
			position: absolute;
			inset-block-start: 20px;
			inset-inline-end: -46px;
			transform: rotate(45deg);
			z-index: 2;
			padding: 6px 60px;
			background: var(--warning);
			color: var(--bg-ultra-light);
			font-family: var(--font-mono);
			font-size: var(--text-xs);
			letter-spacing: 0.22em;
			text-transform: uppercase;
			box-shadow: var(--box-shadow-2);
		}

		.inv__watermark {
			position: absolute;
			inset: 0;
			display: grid;
			place-items: center;
			pointer-events: none;
			z-index: 0;
		}
		.inv__watermark span {
			font-family: var(--font-display);
			font-style: italic;
			font-size: 150px;
			line-height: 1;
			white-space: nowrap;
			transform: rotate(-22deg);
			color: color-mix(in oklch, var(--warning) 8%, transparent);
		}

		.inv__paid {
			position: absolute;
			inset-block-start: 132px;
			inset-inline-end: 52px;
			z-index: 2;
			transform: rotate(-9deg);
			padding: 8px 16px 7px;
			text-align: center;
			border: 2px solid var(--success);
			border-radius: var(--radius-l);
			color: var(--success);
			background: color-mix(in oklch, var(--success) 8%, var(--bg-ultra-light));
			box-shadow: inset 0 0 0 1px color-mix(in oklch, var(--success) 40%, transparent);
		}
		.inv__paid-label {
			display: block;
			font-family: var(--font-mono);
			font-size: var(--text-l);
			font-weight: 600;
			letter-spacing: 0.24em;
			text-transform: uppercase;
			line-height: 1;
		}
		.inv__paid-date {
			display: block;
			margin-block-start: 4px;
			font-family: var(--font-mono);
			font-size: var(--text-xs);
			letter-spacing: 0.1em;
			text-transform: uppercase;
			color: color-mix(in oklch, var(--success) 70%, var(--text-muted));
		}

		/* ── masthead ── */
		.inv__mh {
			display: flex;
			align-items: flex-start;
			justify-content: space-between;
			gap: var(--space-l);
		}
		.inv__mh-id {
			display: flex;
			align-items: center;
			gap: var(--space-s);
		}
		.inv__issuer {
			font-family: var(--font-display);
			font-size: var(--text-xl);
			font-weight: 500;
			letter-spacing: -0.01em;
			line-height: 1.1;
		}
		.inv__issuer-tax {
			display: block;
			margin-block-start: 3px;
			font-family: var(--font-mono);
			font-size: var(--text-xs);
			font-weight: 400;
			letter-spacing: 0.04em;
			color: var(--text-muted);
		}
		.inv__mh-doc {
			flex: none;
			text-align: end;
		}
		.inv__type {
			font-family: var(--font-mono);
			font-size: var(--text-s);
			font-weight: 600;
			letter-spacing: 0.24em;
			text-transform: uppercase;
		}
		.inv__no {
			margin-block-start: 6px;
			font-family: var(--font-mono);
			font-size: var(--text-l);
			font-variant-numeric: tabular-nums;
		}
		.inv__no--draft {
			font-size: var(--text-m);
			letter-spacing: 0.14em;
			color: var(--text-faint);
		}

		/* ── dates row ── */
		.inv__dates {
			display: flex;
			gap: var(--space-xl);
			margin: var(--space-l) 0 0;
			padding-block: var(--space-s) var(--space-m);
			border-block: 1px solid var(--border-color-light);
		}
		.inv__dates dt {
			font-family: var(--font-mono);
			font-size: var(--text-xs);
			letter-spacing: 0.13em;
			text-transform: uppercase;
			color: var(--text-faint);
		}
		.inv__dates dd {
			margin: 5px 0 0;
			font-family: var(--font-mono);
			font-size: var(--text-s);
			font-variant-numeric: tabular-nums;
		}

		/* ── parties ── */
		.inv__parties {
			display: grid;
			grid-template-columns: 1fr 1fr;
			gap: var(--space-xl);
			margin-block-start: var(--space-l);
		}
		.inv__eye {
			margin: 0 0 var(--space-s);
			padding-block-end: var(--space-xs);
			border-block-end: 1px solid var(--border-color-light);
		}
		.inv__eye--plain {
			border-block-end: 0;
			padding-block-end: 0;
			margin-block-end: var(--space-s);
		}
		.inv__party-name {
			font-family: var(--font-display);
			font-size: var(--text-l);
			font-weight: 500;
			line-height: 1.2;
		}
		.inv__rows {
			display: flex;
			flex-direction: column;
			gap: 2px;
			margin-block-start: var(--space-xs);
		}
		.inv__row {
			font-size: var(--text-s);
			color: var(--text-muted);
			line-height: 1.5;
		}
		.inv__mono {
			font-family: var(--font-mono);
			font-size: var(--text-xs);
			color: var(--text-muted);
		}
		.inv__mono--gap {
			margin-block-start: 6px;
		}
		.inv__kk {
			margin-inline-end: 7px;
			font-family: var(--font-mono);
			font-size: var(--text-xs);
			letter-spacing: 0.1em;
			text-transform: uppercase;
			color: var(--text-faint);
		}
		.inv__party-miss {
			margin-block-start: var(--space-xs);
			font-family: var(--font-display);
			font-style: italic;
			font-size: var(--text-s);
			color: var(--text-faint);
		}

		/* ── line items ── */
		.inv__items {
			margin-block-start: var(--space-l);
		}
		.inv__lines {
			inline-size: 100%;
			border-collapse: collapse;
			margin-block-start: var(--space-s);
		}
		.inv__lines thead th {
			font-family: var(--font-mono);
			font-size: var(--text-xs);
			font-weight: 500;
			letter-spacing: 0.1em;
			text-transform: uppercase;
			color: var(--text-faint);
			text-align: start;
			padding: 0 0 var(--space-s);
			border-block-end: 1px solid var(--border-color-dark);
		}
		.inv__num {
			text-align: end;
			font-variant-numeric: tabular-nums;
		}
		.inv__lines tbody td {
			padding-block: var(--space-s);
			border-block-end: 1px solid var(--border-color-light);
			vertical-align: top;
			font-size: var(--text-m);
		}
		.inv__desc b {
			font-weight: 500;
		}
		.inv__desc-meta {
			display: block;
			margin-block-start: 3px;
			font-family: var(--font-mono);
			font-size: var(--text-xs);
			color: var(--text-muted);
		}
		.inv__lines td.inv__num,
		.inv__lines td.inv__qty {
			font-family: var(--font-mono);
			font-size: var(--text-s);
			white-space: nowrap;
			padding-inline-start: var(--space-m);
		}
		.inv__lines td.inv__qty {
			text-align: end;
			color: var(--text-muted);
		}

		/* ── totals ── */
		.inv__totwrap {
			display: flex;
			justify-content: flex-end;
			margin-block-start: var(--space-l);
		}
		.inv__totals {
			inline-size: 290px;
			max-inline-size: 100%;
			margin: 0;
		}
		.inv__tr {
			display: flex;
			align-items: baseline;
			justify-content: space-between;
			padding: var(--space-xs) var(--space-s);
		}
		.inv__tr dt {
			font-size: var(--text-s);
			color: var(--text-muted);
		}
		.inv__pct {
			margin-inline-start: 6px;
			font-family: var(--font-mono);
			font-size: var(--text-xs);
			color: var(--text-faint);
		}
		.inv__tr dd {
			margin: 0;
			font-family: var(--font-mono);
			font-size: var(--text-s);
			font-variant-numeric: tabular-nums;
		}
		.inv__tr--neg dd {
			color: var(--danger);
		}
		.inv__tr--sub {
			background: var(--bg-light);
			border-radius: var(--radius-m);
		}
		.inv__tr--total {
			margin-block-start: var(--space-s);
			padding-block: var(--space-m);
			border-block-start: 2px solid var(--text-color);
		}
		.inv__tr--total dt {
			font-size: var(--text-m);
			font-weight: 600;
			color: var(--text-color);
		}
		.inv__tr--total dd {
			font-family: var(--font-display);
			font-size: var(--text-xxl);
			font-weight: 500;
		}
		.inv__cur {
			margin-inline-start: 7px;
			font-family: var(--font-mono);
			font-size: var(--text-xs);
			color: var(--text-muted);
			vertical-align: 2px;
		}

		/* ── footer ── */
		.inv__foot {
			display: grid;
			grid-template-columns: 1fr 1fr;
			gap: var(--space-xl);
			margin-block-start: var(--space-xl);
			padding-block-start: var(--space-m);
			border-block-start: 1px solid var(--border-color-light);
		}
		.inv__foot-eye {
			margin: 0 0 var(--space-s);
		}
		.inv__foot p {
			line-height: 1.7;
		}
		.inv__terms {
			font-size: var(--text-s);
			color: var(--text-muted);
			line-height: 1.6;
		}
		.inv__legal {
			margin-block-start: var(--space-m);
			font-family: var(--font-mono);
			font-size: var(--text-xs);
			letter-spacing: 0.01em;
			color: var(--text-faint);
			line-height: 1.6;
		}
		.inv__pfnote {
			display: flex;
			gap: var(--space-s);
			align-items: flex-start;
			margin-block-start: var(--space-m);
			padding: var(--space-s) var(--space-m);
			border-radius: var(--radius-l);
			background: color-mix(in oklch, var(--warning) 10%, var(--bg-ultra-light));
			border: 1px solid color-mix(in oklch, var(--warning) 30%, var(--border-color-light));
		}
		.inv__pfnote svg {
			inline-size: 15px;
			block-size: 15px;
			flex: none;
			margin-block-start: 1px;
			color: var(--warning);
		}
		.inv__pfnote span {
			font-size: var(--text-s);
			color: var(--text-muted);
			line-height: 1.5;
		}

		@media (max-width: 640px) {
			.inv__parties,
			.inv__foot {
				grid-template-columns: 1fr;
				gap: var(--space-m);
			}
			.inv__paid {
				inset-block-start: auto;
				inset-block-end: 56px;
				inset-inline-end: 30px;
			}
		}

		@media print {
			.inv {
				border: 0;
				border-radius: 0;
				box-shadow: none;
			}
		}
	}
</style>
