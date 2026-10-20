<script lang="ts">
  /**
   * BoloRecord: a bolo to be looked at (ADR-139 p1 A, flujos § 15). The bolo
   * is the money unit (ADR-087) and the one main thing with no place of its
   * own: from a performance it sent you to Cuentas, the whole dashboard, with
   * its row unfolded at the bottom. Now it opens here, over wherever you
   * are, and «Abrir en Cuentas» (the vistazo's own link) takes you to that row
   * when you want to record a payment or make the invoice.
   *
   * The shape of every record: RecordHead (address, name, facts), «Falta»,
   * then its blocks: the functions, the documents, what came in, what went
   * out. Read only: money is written in Cuentas (ADR-043), so each «Falta»
   * verb goes there, to the row, with its dialog open (`act=`).
   *
   * Reads what Cuentas reads, narrowed to the one project (the money feed
   * takes no id): its bolos, its invoices, the bolo's expenses, and the
   * project's functions in the bolo's window with the link of each to its
   * bolo. «Falta» is Cuentas' «Pide atención» for this bolo (`boloMissing`),
   * so the two can never disagree.
   */
  import { createQuery } from '@tanstack/svelte-query';
  import { toStore } from 'svelte/store';
  import { ApiError, fetchJSON } from '$lib/api';
  import { retryLoad } from '$lib/load-fail';
  import { booksHref } from '$lib/bolo-pick';
  import { projectBolosQueryOptions } from '$lib/bolo-queries';
  import { dayLabel, localDayISO } from '$lib/datetime';
  import { appLocale, t } from '$lib/i18n';
  import { lensOn } from '$lib/lenses.svelte';
  import {
    boloMoney,
    boloStatusLabel,
    fmtFee,
    invoiceStatusLabel,
    invoicesByBolo,
    observedPayerTermsDays,
    paymentMethodLabel,
    type AttentionItem,
    type InvoicingMode,
    type MoneyBolo,
    type MoneyInvoiceItem,
  } from '$lib/money';
  import { categoryLabel, type ExpenseItem } from '$lib/expense';
  import { performanceStatusFamily, performanceStatusLabel } from '$lib/performance';
  import { workspacesQueryOptions } from '$lib/nav-queries';
  import { boloMissing } from '$lib/record-missing';
  import { spaceCrumb, type Crumb } from '$lib/record-crumbs';
  import RecordHead from '$lib/components/RecordHead.svelte';
  import RecordState from '$lib/components/RecordState.svelte';
  import MissingBand, { type MissingItem } from '$lib/components/MissingBand.svelte';
  import BlockHead from '$lib/components/BlockHead.svelte';
  import EmptyLine from '$lib/components/EmptyLine.svelte';

  interface Props {
    projectId: string;
    id: string;
  }

  let { projectId, id }: Props = $props();

  const locale = appLocale();

  const bolosQuery = createQuery(toStore(() => ({ ...projectBolosQueryOptions(projectId), retry: retryLoad })));
  // The project feed carries the whole MoneyBolo row; `BoloLite` is its pick.
  let bolo = $derived((($bolosQuery.data?.items ?? []) as unknown as MoneyBolo[]).find((b) => b.id === id) ?? null);

  const wsQuery = createQuery(workspacesQueryOptions());
  type SpaceLite = { id: string; slug: string; name: string; invoicing_mode?: InvoicingMode | null };
  let space = $derived(
    (($wsQuery.data?.items ?? []) as unknown as SpaceLite[]).find((w) => w.id === bolo?.project?.workspace_id) ?? null,
  );
  let workspaceSlug = $derived(space?.slug ?? '');

  const invoicesQuery = createQuery(
    toStore(() => ({
      queryKey: ['invoices', 'project', projectId] as const,
      enabled: Boolean(bolo),
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        fetchJSON<{ items: MoneyInvoiceItem[] }>(`/api/invoices?project_ids=${encodeURIComponent(projectId)}&limit=200`, signal),
    })),
  );
  const expensesQuery = createQuery(
    toStore(() => ({
      queryKey: ['expenses', 'bolo', id] as const,
      enabled: Boolean(bolo),
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        fetchJSON<{ items: ExpenseItem[] }>(`/api/expenses?bolo_ids=${encodeURIComponent(id)}`, signal),
    })),
  );

  // The functions: the project's, in the bolo's window, kept when they hang
  // from this bolo (the link is money, read through its own gate).
  type PerfLite = { id: string; slug: string | null; performed_at: string; status: string; venue_name: string | null; city: string | null };
  const functionsQuery = createQuery(
    toStore(() => {
      const from = bolo?.first_performed_at?.slice(0, 10) ?? null;
      const to = bolo?.last_performed_at?.slice(0, 10) ?? from;
      return {
        queryKey: ['money-bolos', 'functions', id, from, to] as const,
        enabled: Boolean(bolo && from),
        retry: false,
        queryFn: async ({ signal }: { signal: AbortSignal }) => {
          const perfs = await fetchJSON<{ items: PerfLite[] }>(
            `/api/performances?project_ids=${encodeURIComponent(projectId)}&status=any&from=${from}&to=${to}&limit=200`,
            signal,
          );
          if (perfs.items.length === 0) return [] as PerfLite[];
          const links = await fetchJSON<{ items: Array<{ performance_id: string; bolo_id: string | null }> }>(
            `/api/money/performance-bolos?performance_ids=${perfs.items.map((p) => p.id).join(',')}`,
            signal,
          );
          const mine = new Set(links.items.filter((l) => l.bolo_id === id).map((l) => l.performance_id));
          return perfs.items.filter((p) => mine.has(p.id));
        },
      };
    }),
  );
  let functions = $derived($functionsQuery.data ?? []);

  let invoices = $derived($invoicesQuery.data?.items ?? []);
  let docs = $derived(bolo ? (invoicesByBolo(invoices).get(bolo.id) ?? []) : []);
  let payments = $derived(
    docs
      .flatMap((d) => d.payments.map((p) => ({ ...p, doc: d })))
      .filter((p) => !p.deleted_at)
      .sort((a, b) => b.received_on.localeCompare(a.received_on)),
  );
  let expenses = $derived($expensesQuery.data?.items ?? []);

  let ctx = $derived({
    invoicesByBolo: invoicesByBolo(invoices),
    termsByPayer: observedPayerTermsDays(invoices, invoices.flatMap((i) => i.payments)),
    modeOf: () => (space?.invoicing_mode ?? 'legal') as InvoicingMode,
    today: new Date(),
  });
  let money = $derived(bolo ? boloMoney(bolo, ctx) : null);

  let title = $derived(bolo ? bolo.venue_name || bolo.city || bolo.project?.name || t('peek.crumb_bolo', locale) : '');
  let crumbs = $derived.by<Crumb[]>(() => {
    const out: Crumb[] = [];
    if (workspaceSlug) out.push(spaceCrumb(space?.name, workspaceSlug));
    if (bolo?.project && workspaceSlug) {
      out.push({ label: bolo.project.name, href: `/h/${workspaceSlug}/project/${bolo.project.slug}/` });
    }
    out.push({ label: t('peek.crumb_bolo', locale) });
    return out;
  });

  let rowHref = $derived(booksHref(projectId, { boloId: id }));
  let conversationHref = $derived(
    bolo?.conversation_id && workspaceSlug ? `/h/${workspaceSlug}/conversation/${bolo.conversation_id}` : null,
  );

  // ── Falta: Cuentas' «Pide atención», each verb to the row in Cuentas ───
  // Only once the documents are in: without them every bolo looks unbilled.
  let missing = $derived<AttentionItem[]>(bolo && $invoicesQuery.isSuccess ? boloMissing(bolo, ctx) : []);
  const ATTENTION_TEXT: Record<AttentionItem['kind'], string> = {
    overdue: 'record.missing_bolo_overdue',
    to_invoice: 'record.missing_bolo_to_invoice',
    draft: 'record.missing_bolo_draft',
    fiscal: 'record.missing_bolo_fiscal',
    no_fee: 'record.missing_bolo_no_fee',
  };
  const ATTENTION_VERB: Record<AttentionItem['kind'], string> = {
    overdue: 'books.att_act_chase',
    to_invoice: 'books.att_act_invoice',
    draft: 'books.att_act_issue',
    fiscal: 'books.att_act_fiscal',
    no_fee: 'books.att_act_fee',
  };
  function missingItem(a: AttentionItem): MissingItem {
    // Late money is chased in its conversation; everything else is done in Cuentas.
    const chase = a.kind === 'overdue' && conversationHref;
    return {
      id: a.kind,
      text: t(ATTENTION_TEXT[a.kind], locale),
      meta:
        a.kind === 'overdue'
          ? t(a.daysLate === 1 ? 'books.att_late_one' : 'books.att_late_many', locale, { n: a.daysLate })
          : undefined,
      verbs: [
        chase
          ? { label: t(ATTENTION_VERB[a.kind], locale).toLowerCase(), href: conversationHref! }
          : {
              label: t(a.kind === 'overdue' ? 'books.record_payment' : ATTENTION_VERB[a.kind], locale).toLowerCase(),
              // The row, with the dialog that settles it already open.
              href: booksHref(projectId, { boloId: id, act: a.kind }),
            },
      ],
    };
  }
  let missingItems = $derived(lensOn('books') ? missing.map(missingItem) : missing.map((a) => ({ ...missingItem(a), verbs: [] })));

  const today = localDayISO();
  function fmt(amount: number | string | null, currency: string | null): string {
    return fmtFee(amount === null ? null : Number(amount), currency, locale);
  }
</script>

<article class="record bolo-record" aria-busy={$bolosQuery.isLoading} data-testid="bolo-record">
  {#if $bolosQuery.isLoading || !bolo || !money}
    <RecordState
      loading={$bolosQuery.isLoading}
      error={$bolosQuery.error ?? new ApiError(404, 'Not found')}
      missingText={t('peek.bolo_not_found', locale)}
      failedText={t('peek.bolo_load_error', locale)}
      onretry={() => void $bolosQuery.refetch()}
      {locale}
    />
  {:else}
    <RecordHead {crumbs} {title}>
      {#snippet facts()}
        <span class="fact-word" data-family={performanceStatusFamily(bolo!.status)}>{boloStatusLabel(bolo!.status, locale)}</span>
        {#if bolo!.city && bolo!.city !== title}<span>{bolo!.city}</span>{/if}
        <span class="bolo-record__num">{fmt(money!.fee, money!.currency)}</span>
        {#if money!.fee !== null || money!.collected > 0}
          <span class="bolo-record__num"
            >{t('books.collected_of', locale, { collected: fmt(money!.collected, money!.currency), fee: fmt(money!.fee, money!.currency) })}</span
          >
        {/if}
      {/snippet}
      {#snippet band()}
        <MissingBand items={missingItems} {locale} />
      {/snippet}
    </RecordHead>

    <section class="bolo-record__section" aria-label={t('books.sheet_functions', locale)}>
      <BlockHead title={t('books.sheet_functions', locale)} count={bolo.function_count} />
      {#if functions.length > 0}
        <ul class="bolo-record__rows" role="list">
          {#each functions as p (p.id)}
            <li class="bolo-record__row">
              <span class="bolo-record__when">{dayLabel(p.performed_at)}</span>
              {#if p.slug && workspaceSlug}
                <a href={`/h/${workspaceSlug}/performance/${p.slug}`}>{p.venue_name || p.city || title}</a>
              {:else}
                <span>{p.venue_name || p.city || title}</span>
              {/if}
              <span class="fact-word" data-family={performanceStatusFamily(p.status)}>{performanceStatusLabel(p.status, locale)}</span>
            </li>
          {/each}
        </ul>
      {:else if $functionsQuery.isLoading}
        <EmptyLine text={t('desk.loading', locale)} busy />
      {:else if bolo.first_performed_at}
        <EmptyLine text={dayLabel(bolo.first_performed_at)} />
      {:else}
        <EmptyLine text={t('books.no_date', locale)} />
      {/if}
      {#if conversationHref}
        <p class="bolo-record__more"><a class="link-arrow" href={conversationHref}>{t('books.sheet_conversation', locale)}</a></p>
      {/if}
    </section>

    {#if space?.invoicing_mode !== 'off'}
      <section class="bolo-record__section" aria-label={t('books.documents', locale)}>
        {#if docs.length === 0}
          <EmptyLine label={t('books.documents', locale)} text={t('books.sheet_no_doc', locale)} busy={$invoicesQuery.isLoading} />
        {:else}
          <BlockHead title={t('books.documents', locale)} count={docs.length} />
          <ul class="bolo-record__rows" role="list">
            {#each docs as d (d.id)}
              <li class="bolo-record__row">
                <span class="bolo-record__when">{dayLabel(d.issued_on)}</span>
                <span>{d.number ?? invoiceStatusLabel(d.status, locale)}{#if d.payer}<span class="bolo-record__faint">{` · ${d.payer.name}`}</span>{/if}</span>
                <span class="bolo-record__num">{fmt(d.total, d.currency)}</span>
                <span class="bolo-record__faint">{invoiceStatusLabel(d.status, locale)}{#if d.status === 'issued' && d.expected_on && d.expected_on >= today}{` · ${t('books.sheet_expected', locale, { date: dayLabel(d.expected_on) })}`}{/if}</span>
              </li>
            {/each}
          </ul>
        {/if}
      </section>
    {/if}

    <section class="bolo-record__section" aria-label={t('peek.bolo_payments', locale)}>
      {#if payments.length === 0}
        <EmptyLine label={t('peek.bolo_payments', locale)} text={t('peek.bolo_no_payments', locale)} busy={$invoicesQuery.isLoading} />
      {:else}
        <BlockHead title={t('peek.bolo_payments', locale)} count={payments.length} />
        <ul class="bolo-record__rows" role="list">
          {#each payments as p (p.id)}
            <li class="bolo-record__row">
              <span class="bolo-record__when">{dayLabel(p.received_on)}</span>
              <span>{paymentMethodLabel(p.method, locale)}{#if p.doc.number}<span class="bolo-record__faint">{` · ${p.doc.number}`}</span>{/if}</span>
              <span class="bolo-record__num">{fmt(p.amount, p.doc.currency)}</span>
            </li>
          {/each}
        </ul>
      {/if}
    </section>

    <section class="bolo-record__section" aria-label={t('books.expenses', locale)}>
      {#if expenses.length === 0}
        <EmptyLine label={t('books.expenses', locale)} text={t('peek.bolo_no_expenses', locale)} busy={$expensesQuery.isLoading} />
      {:else}
        <BlockHead title={t('books.expenses', locale)} count={expenses.length} />
        <ul class="bolo-record__rows" role="list">
          {#each expenses as e (e.id)}
            <li class="bolo-record__row">
              <span class="bolo-record__when">{dayLabel(e.incurred_on)}</span>
              <span>{e.description}<span class="bolo-record__faint">{` · ${categoryLabel(e.category, locale)}`}</span></span>
              <span class="bolo-record__num">{fmt(e.amount, e.currency)}</span>
            </li>
          {/each}
        </ul>
      {/if}
    </section>
  {/if}
</article>

<style>
  @layer components {
    .bolo-record__section {
      display: flex;
      flex-direction: column;
      gap: var(--space-s);
    }
    .bolo-record__rows {
      display: flex;
      flex-direction: column;
      gap: var(--space-2xs);
      margin: 0;
      padding: 0;
      list-style: none;
    }
    /* The record's row: the mono label column (the day), then what it is,
       its figure at the end. */
    .bolo-record__row {
      display: flex;
      flex-wrap: wrap;
      align-items: baseline;
      gap: var(--space-2xs) var(--space-s);
      font-size: var(--text-s);
    }
    .bolo-record__when {
      flex: none;
      min-inline-size: var(--record-label-inline);
      font-family: var(--font-mono);
      font-size: var(--text-xs);
      letter-spacing: var(--mono-letter-spacing);
      color: var(--text-faint);
    }
    .bolo-record__num {
      font-variant-numeric: tabular-nums;
    }
    .bolo-record__row .bolo-record__num {
      margin-inline-start: auto;
    }
    .bolo-record__faint {
      color: var(--text-faint);
    }
    /* A function is a row of the record, not a call to action: ink, and
       the underline only under the pointer. */
    .bolo-record__row a {
      color: var(--text-color);
      text-decoration: none;
    }
    .bolo-record__row a:hover {
      text-decoration: underline;
    }
    .bolo-record__more {
      margin: 0;
    }
  }
</style>
