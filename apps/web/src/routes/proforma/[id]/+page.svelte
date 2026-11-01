<script lang="ts">
  /**
   * A proforma as a document (ADR-162): emisor, pagador, líneas, impuestos,
   * total, vencimiento y número, on one page that prints. No library and no
   * file: «Imprimir · guardar PDF» is the browser's print, where saving the
   * PDF is one of the destinations. Outside the shell, like the public road
   * sheet, so the paper carries only the document.
   *
   * Nothing is invented: a field that is not on record leaves a discreet gap
   * on screen that never prints.
   */

  import { docTitle } from '$lib/doc-title';
  import { page } from '$app/state';
  import { createQuery } from '@tanstack/svelte-query';
  import { toStore } from 'svelte/store';
  import { ApiError, fetchJSON } from '$lib/api';
  import { retryLoad } from '$lib/load-fail';
  import RecordState from '$lib/components/RecordState.svelte';
  import Button from '$lib/components/Button.svelte';
  import { dayMonthYear } from '$lib/datetime';
  import { fmtMoney, invoiceStatusLabel } from '$lib/money';
  import { appLocale, LOCALE_TAG, t } from '$lib/i18n';
  import {
    issuerFixHref,
    missingFields,
    orderedTaxes,
    partyLines,
    type ProformaDocument,
    type ProformaParty,
  } from '$lib/proforma';

  const locale = appLocale();
  const tag = LOCALE_TAG[locale];

  let id = $derived(page.params.id ?? '');

  const queryOptions = toStore(() => {
    const k = id;
    return {
      queryKey: ['proforma', k] as const,
      retry: retryLoad,
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        fetchJSON<{ document: ProformaDocument }>(`/api/invoices/${encodeURIComponent(k)}/proforma`, signal),
    };
  });
  const query = createQuery(queryOptions);

  let doc = $derived($query.data?.document ?? null);
  let notProforma = $derived($query.error instanceof ApiError && $query.error.status === 409);

  function money(n: number): string {
    return `${fmtMoney(n, locale)} ${doc?.currency ?? ''}`.trim();
  }

  /** «Faltan: NIF, dirección», or what stops the party from being read at all. */
  function gap(party: ProformaParty, role: 'issuer' | 'payer'): string | null {
    if (party.state === 'hidden') return t('proforma.party_hidden', locale);
    if (party.state === 'none') return t(`proforma.party_none_${role}`, locale);
    const missing = missingFields(party);
    if (missing.length === 0) return null;
    return t('proforma.missing', locale, {
      fields: missing.map((f) => t(`proforma.field_${f}`, locale)).join(', '),
    });
  }
</script>

<svelte:head>
  <title>{docTitle(doc?.number, t('proforma.title', locale))}</title>
  <meta name="robots" content="noindex" />
</svelte:head>

<main class="pf">
  {#if notProforma}
    <p class="pf__state">{t('proforma.not_proforma', locale)}</p>
  {:else if !doc}
    <RecordState
      loading={$query.isPending}
      error={$query.error}
      missingText={t('proforma.gone', locale)}
      failedText={t('proforma.load_error', locale)}
      onretry={() => void $query.refetch()}
      {locale}
    />
  {:else}
    <div class="pf__bar">
      <Button size="s" onclick={() => window.print()}>{t('proforma.print', locale)}</Button>
    </div>

    <article class="pf__doc">
      <header class="pf__head">
        <div>
          <h1 class="pf__title">{t('proforma.title', locale)}</h1>
          <p class="pf__faint">{t('proforma.not_invoice', locale)}</p>
        </div>
        <dl class="pf__meta">
          <div>
            <dt>{t('proforma.number', locale)}</dt>
            <dd>{doc.number ?? `${t('books.no_number', locale)} · ${invoiceStatusLabel(doc.status, locale)}`}</dd>
          </div>
          <div><dt>{t('proforma.date', locale)}</dt><dd>{dayMonthYear(doc.issued_on, tag)}</dd></div>
          <div>
            <dt>{t('proforma.due', locale)}</dt>
            <dd>
              {#if doc.due_on}{dayMonthYear(doc.due_on, tag)}{:else}<span class="pf__gap">{t('books.not_set', locale)}</span>{/if}
            </dd>
          </div>
        </dl>
      </header>

      <section class="pf__parties">
        {#each [['issuer', doc.issuer], ['payer', doc.payer]] as const as [role, party] (role)}
          {@const lines = partyLines(party)}
          {@const hole = gap(party, role)}
          {@const fix = role === 'issuer' ? issuerFixHref(doc) : null}
          <div class="pf__party">
            <h2 class="pf__label">{t(`proforma.${role}`, locale)}</h2>
            {#each lines as line, i (i)}
              <p class:pf__name={i === 0}>{line}</p>
            {/each}
            {#if hole}
              <p class="pf__gap">
                {hole}{#if fix}{' '}<a href={fix}>{t('proforma.fix_in_settings', locale)}</a>{/if}
              </p>
            {/if}
          </div>
        {/each}
      </section>

      {#if doc.project}<p class="pf__faint">{doc.project.name}</p>{/if}

      <table class="pf__lines">
        <thead>
          <tr>
            <th scope="col">{t('proforma.concept', locale)}</th>
            <th scope="col" class="pf__num">{t('proforma.quantity', locale)}</th>
            <th scope="col" class="pf__num">{t('proforma.unit_price', locale)}</th>
            <th scope="col" class="pf__num">{t('proforma.amount', locale)}</th>
          </tr>
        </thead>
        <tbody>
          {#each doc.lines as line, i (i)}
            <tr>
              <td>{line.description}</td>
              <td class="pf__num">{line.quantity}</td>
              <td class="pf__num">{money(line.unit_amount)}</td>
              <td class="pf__num">{money(line.line_total)}</td>
            </tr>
          {/each}
        </tbody>
      </table>

      <dl class="pf__totals">
        <div><dt>{t('books.subtotal', locale)}</dt><dd>{money(doc.subtotal)}</dd></div>
        {#each orderedTaxes(doc.tax_lines) as tax (tax.id)}
          <div>
            <dt>{tax.label}{#if tax.kind !== 'exempt'} {tax.rate_pct}%{/if}</dt>
            <dd>
              {#if tax.kind === 'exempt'}
                {t('books.exempt', locale)}{#if tax.exempt_reason} · {tax.exempt_reason}{/if}
              {:else}
                {tax.kind === 'withhold' ? '−' : '+'} {money(Math.abs(tax.amount))}
              {/if}
            </dd>
          </div>
        {/each}
        <div class="pf__total"><dt>{t('books.total', locale)}</dt><dd>{money(doc.total)}</dd></div>
      </dl>

      {#if doc.payment_condition || doc.issuer.fiscal?.iban}
        <section class="pf__foot">
          <h2 class="pf__label">{t('proforma.payment', locale)}</h2>
          {#if doc.payment_condition}<p>{doc.payment_condition}</p>{/if}
          {#if doc.issuer.fiscal?.iban}
            <p>IBAN {doc.issuer.fiscal.iban}{#if doc.issuer.fiscal.swift_bic} · BIC {doc.issuer.fiscal.swift_bic}{/if}</p>
          {/if}
        </section>
      {/if}

      {#if doc.notes}
        <section class="pf__foot">
          <h2 class="pf__label">{t('proforma.notes', locale)}</h2>
          <p>{doc.notes}</p>
        </section>
      {/if}
    </article>
  {/if}
</main>

<style>
  @layer components {
    .pf {
      max-inline-size: 48rem;
      margin-inline: auto;
      padding: var(--space-l) var(--space-m) var(--space-xxl);
    }

    .pf__state {
      padding-block: var(--space-xxl);
      text-align: center;
      color: var(--text-muted);
    }

    .pf__bar {
      display: flex;
      justify-content: flex-end;
      margin-block-end: var(--space-l);
    }

    .pf__doc {
      display: flex;
      flex-direction: column;
      gap: var(--space-l);
    }

    .pf__head {
      display: flex;
      justify-content: space-between;
      align-items: start;
      gap: var(--space-l);
      flex-wrap: wrap;
    }

    .pf__title {
      font-family: var(--font-display);
      font-size: var(--text-xxl);
      font-weight: 400;
    }

    .pf__faint {
      font-size: var(--text-xs);
      color: var(--text-faint);
    }

    .pf__meta,
    .pf__totals {
      display: flex;
      flex-direction: column;
      gap: var(--space-2xs);
      margin: 0;
      font-size: var(--text-s);
    }

    .pf__meta div,
    .pf__totals div {
      display: flex;
      justify-content: space-between;
      gap: var(--space-m);
    }

    .pf__meta dt,
    .pf__totals dt {
      color: var(--text-faint);
    }

    .pf__meta dd,
    .pf__totals dd {
      margin: 0;
      font-variant-numeric: tabular-nums;
    }

    .pf__parties {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(14rem, 1fr));
      gap: var(--space-l);
    }

    .pf__party {
      display: flex;
      flex-direction: column;
      gap: var(--space-2xs);
      font-size: var(--text-s);
    }

    .pf__name {
      font-weight: 500;
    }

    .pf__label {
      margin-block-end: var(--space-xs);
      font-family: var(--font-mono);
      font-size: var(--text-xs);
      font-weight: 400;
      letter-spacing: var(--tracking-m);
      text-transform: uppercase;
      color: var(--text-faint);
    }

    /* The hole where a field would go: on screen, faint; never on paper. */
    .pf__gap {
      font-size: var(--text-xs);
      font-style: italic;
      color: var(--text-faint);
    }

    .pf__lines {
      inline-size: 100%;
      border-collapse: collapse;
      font-size: var(--text-s);
    }

    .pf__lines th {
      text-align: start;
      font-weight: 400;
      font-size: var(--text-xs);
      color: var(--text-faint);
      padding-block: var(--space-xs);
      border-block-end: var(--line-hairline) solid var(--border-color-light);
    }

    .pf__lines td {
      padding-block: var(--space-xs);
      border-block-end: var(--line-hairline) solid var(--border-color-light);
      vertical-align: top;
    }

    .pf__lines .pf__num {
      text-align: end;
      font-variant-numeric: tabular-nums;
      white-space: nowrap;
      padding-inline-start: var(--space-m);
    }

    .pf__totals {
      align-self: flex-end;
      min-inline-size: 16rem;
    }

    .pf__total {
      padding-block-start: var(--space-xs);
      border-block-start: var(--line-hairline) solid var(--border-color-light);
      font-weight: 500;
    }

    .pf__total dt {
      color: var(--text-color);
    }

    .pf__foot {
      font-size: var(--text-s);
    }

    @media print {
      .pf {
        max-inline-size: none;
        padding: 0;
      }

      .pf__bar,
      .pf__gap {
        display: none;
      }
    }
  }
</style>
