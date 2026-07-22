<script lang="ts">
	/**
	 * Fiscal identity editor (ADR-086, money v3 · design Part B). The
	 * create/edit dialog for one fiscal identity — a sibling of
	 * EditWorkspaceDialog. Two shapes over one field set:
	 *   - issuer   → Identity · Address · Banking · Tax defaults (full).
	 *   - receiver → Identity · Address, with a "just a name" toggle that
	 *                drops the fiscal data (asymmetric, ADR-086 D6).
	 *
	 * Presentational: it validates format loosely and hands a record back via
	 * `onsave`; persistence is the BUILD phase. Labels stay in Catalan.
	 */

	import Button from '$lib/components/Button.svelte';
	import Checkbox from '$lib/components/Checkbox.svelte';
	import Dialog from '$lib/components/Dialog.svelte';
	import IdentityMark from '$lib/components/IdentityMark.svelte';
	import Input from '$lib/components/Input.svelte';
	import { addToast } from '$lib/components/Toast.svelte';
	import { accentVar } from '$lib/utils/accent';
	import {
		isValidIban,
		isValidTaxId,
		type FiscalIdentity,
		type FiscalIdentityKind,
	} from '$lib/fiscal';

	interface Props {
		open?: boolean;
		kind: FiscalIdentityKind;
		/** The record being edited, or null to create a new one. */
		identity: FiscalIdentity | null;
		onsave: (record: FiscalIdentity) => void;
		onarchive?: (id: string) => void;
	}

	let { open = $bindable(false), kind, identity, onsave, onarchive }: Props = $props();

	let label = $state('');
	let legal = $state('');
	let tax = $state('');
	let line1 = $state('');
	let line2 = $state('');
	let postal = $state('');
	let city = $state('');
	let region = $state('');
	let country = $state('Espanya');
	let iban = $state('');
	let swift = $state('');
	let vat = $state('');
	let irpf = $state('');
	let bare = $state(false);
	let showErrors = $state(false);

	// Seed the form each time the dialog transitions to open (EditWorkspaceDialog
	// pattern: a plain latch so writing state can't re-trigger the effect).
	let wasOpen = false;
	$effect(() => {
		if (open && !wasOpen) {
			const x = identity;
			label = x?.label ?? '';
			legal = x?.legal_name ?? '';
			tax = x?.tax_id ?? '';
			line1 = x?.address_line_1 ?? '';
			line2 = x?.address_line_2 ?? '';
			postal = x?.postal_code ?? '';
			city = x?.city ?? '';
			region = x?.region ?? '';
			country = x?.country ?? 'Espanya';
			iban = x?.iban ?? '';
			swift = x?.swift_bic ?? '';
			vat = x?.default_vat_pct != null ? String(x.default_vat_pct) : kind === 'issuer' ? '21' : '';
			irpf = x?.default_irpf_pct != null ? String(x.default_irpf_pct) : kind === 'issuer' ? '15' : '';
			bare = x?.bare ?? false;
			showErrors = false;
		}
		wasOpen = open;
	});

	const editing = $derived(!!identity);
	const isReceiver = $derived(kind === 'receiver');
	/** receiver + bare drops tax + address; everything else keeps the fiscal data. */
	const showFiscal = $derived(!(isReceiver && bare));
	const accent = $derived(accentVar(identity?.id ?? (legal || 'nova')));
	const title = $derived(isReceiver ? 'Identitat receptora' : 'Identitat emissora');
	const sub = $derived(
		isReceiver
			? 'Dades de qui et paga · sense banca ni impostos'
			: 'Les teves dades fiscals per emetre documents',
	);

	const legalError = $derived(showErrors && !legal.trim() ? 'Cal com a mínim un nom.' : undefined);
	const taxError = $derived(
		showErrors && showFiscal && !isValidTaxId(tax) ? 'Format de Tax ID no vàlid.' : undefined,
	);
	const ibanError = $derived(
		showErrors && !isReceiver && !isValidIban(iban)
			? 'IBAN no vàlid — revisa el país i els dígits.'
			: undefined,
	);

	function save() {
		showErrors = true;
		if (legalError || taxError || ibanError) {
			addToast({ tone: 'warning', message: 'Revisa els camps marcats.' });
			return;
		}
		const slug = legal.trim().toLowerCase().replace(/\s+/g, '-') || 'identitat';
		const base: FiscalIdentity = {
			id: identity?.id ?? `new-${slug}`,
			kind,
			label: label.trim(),
			legal_name: legal.trim(),
			tax_id: showFiscal ? tax.trim() : '',
			address_line_1: showFiscal ? line1.trim() : '',
			address_line_2: showFiscal ? line2.trim() : '',
			postal_code: showFiscal ? postal.trim() : '',
			city: showFiscal ? city.trim() : '',
			region: showFiscal ? region.trim() : '',
			country: showFiscal ? country.trim() : '',
			archived: identity?.archived ?? false,
		};
		const record: FiscalIdentity = isReceiver
			? { ...base, bare }
			: {
					...base,
					iban: iban.trim() || null,
					swift_bic: swift.trim() || null,
					default_vat_pct: vat.trim() ? Number(vat) : null,
					default_irpf_pct: irpf.trim() ? Number(irpf) : null,
				};
		onsave(record);
		open = false;
	}

	function archive() {
		if (identity && onarchive) onarchive(identity.id);
		open = false;
	}
</script>

{#snippet addressFields()}
	<fieldset class="fid__grp">
		<legend class="eyebrow eyebrow--sub fid__eye">Adreça</legend>
		<Input label="Adreça — línia 1" bind:value={line1} placeholder="Carrer i número" />
		<Input label="Línia 2 (pis / porta)" bind:value={line2} placeholder="2n 1a" />
		<div class="fid__row3">
			<span class="fid__mono"><Input label="Codi postal" bind:value={postal} /></span>
			<Input label="Ciutat" bind:value={city} />
			<Input label="Regió" bind:value={region} />
		</div>
		<Input
			label="País"
			bind:value={country}
			helper="Autocompletar l’adreça: aviat. De moment, camps manuals."
		/>
	</fieldset>
{/snippet}

<Dialog bind:open {title} description={sub} size="m">
	<div class="fid">
		<div class="fid__preview">
			<IdentityMark {accent} name={legal || '··'} size="38px" />
			<span class="fid__preview-name">
				{legal || (isReceiver ? 'Nova receptora' : 'Nova emissora')}
			</span>
		</div>

		{#if isReceiver}
			<Checkbox
				label="Només un nom — sense dades fiscals (modes intern i desactivat)"
				bind:checked={bare}
			/>
		{/if}

		<fieldset class="fid__grp">
			<legend class="eyebrow eyebrow--sub fid__eye">Identitat</legend>
			{#if !isReceiver}
				<Input
					label="Etiqueta (per distingir-la)"
					bind:value={label}
					placeholder="p. ex. companyia, freelance"
				/>
			{/if}
			<Input
				label={bare ? 'Nom' : 'Nom legal'}
				bind:value={legal}
				required
				error={legalError}
				placeholder="Raó social o nom complet"
			/>
			{#if showFiscal}
				<span class="fid__mono">
					<Input label="Tax ID" bind:value={tax} error={taxError} placeholder="ES B12345678" />
				</span>
			{/if}
		</fieldset>

		{#if showFiscal}
			{@render addressFields()}
		{/if}

		{#if !isReceiver}
			<fieldset class="fid__grp">
				<legend class="eyebrow eyebrow--sub fid__eye">Banca</legend>
				<span class="fid__mono">
					<Input
						label="IBAN"
						bind:value={iban}
						error={ibanError}
						placeholder="ES91 2100 0418 4502 0005 1332"
					/>
				</span>
				<span class="fid__mono">
					<Input label="SWIFT / BIC (fora de SEPA)" bind:value={swift} placeholder="CAIXESBBXXX" />
				</span>
			</fieldset>

			<fieldset class="fid__grp">
				<legend class="eyebrow eyebrow--sub fid__eye">Impostos per defecte</legend>
				<div class="fid__row2">
					<Input label="IVA per defecte" bind:value={vat}>
						{#snippet suffix()}%{/snippet}
					</Input>
					<Input label="Retenció IRPF per defecte" bind:value={irpf}>
						{#snippet suffix()}%{/snippet}
					</Input>
				</div>
			</fieldset>
		{/if}
	</div>

	{#snippet actions()}
		{#if editing && onarchive}
			<Button variant="danger" size="s" onclick={archive}>
				{identity?.archived ? 'Restaura' : 'Arxiva'}
			</Button>
		{/if}
		<span class="fid__grow"></span>
		<Button variant="outline" onclick={() => (open = false)}>Cancel·la</Button>
		<Button onclick={save}>Desa</Button>
	{/snippet}
</Dialog>

<style>
	@layer components {
		.fid {
			display: flex;
			flex-direction: column;
			gap: var(--space-m);
		}

		.fid__preview {
			display: flex;
			align-items: center;
			gap: var(--space-s);
			padding-block-end: var(--space-s);
			border-block-end: 1px solid var(--border-color-light);
		}
		.fid__preview-name {
			font-family: var(--font-display);
			font-size: var(--text-l);
			font-weight: 500;
		}

		.fid__grp {
			display: flex;
			flex-direction: column;
			gap: var(--space-s);
			margin: 0;
			padding: 0;
			border: 0;
		}
		.fid__eye {
			margin: 0 0 var(--space-2xs);
			padding-block-end: var(--space-xs);
			border-block-end: 1px solid var(--border-color-light);
		}

		.fid__row2 {
			display: grid;
			grid-template-columns: 1fr 1fr;
			gap: var(--space-s);
		}
		.fid__row3 {
			display: grid;
			grid-template-columns: 1.2fr 1fr 1fr;
			gap: var(--space-s);
		}
		@media (max-width: 540px) {
			.fid__row2,
			.fid__row3 {
				grid-template-columns: 1fr;
			}
		}

		/* Mono for codes (tax id, IBAN, postal) — the fields are read as data. */
		.fid__mono :global(.field__control input) {
			font-family: var(--font-mono);
		}

		.fid__grow {
			flex: 1;
		}
	}
</style>
