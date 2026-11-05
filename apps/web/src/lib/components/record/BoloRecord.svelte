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
   * then its blocks. Here the main one is its HISTORY (tarea 120, ADR-177,
   * mesa § 8: «¿cuándo nos pagan?»): the deal opened and agreed, the contract,
   * the functions, the invoice, when it falls due, what came in, in the order
   * it happened, with a line of today that says where the money stands in
   * words («vencida hace 3 días»). No bubbles: an invoice is a line of what
   * happened, not a message. Then what went out (expenses). Money is written
   * in Cuentas (ADR-043), so each «Falta» verb, and «Apuntar cobro · no sale
   * de Hour» under the history, go there, to the row, with its dialog open
   * (`act=`); the one exception is the contract (ADR-163): its steps are
   * marked right here, on its line of the history.
   *
   * Reads what Cuentas reads, narrowed to the one project (the money feed
   * takes no id): its bolos, its invoices, the bolo's expenses, and the
   * project's functions in the bolo's window with the link of each to its
   * bolo. «Falta» is Cuentas' «Pide atención» for this bolo (`boloMissing`),
   * so the two can never disagree.
   *
   * «+ función» (§ 36): the second function of a bolo is as ordinary as the
   * first (residencies, doubles, runs in one room). It opens the one create
   * dialog with the project locked and this bolo picked (its room comes with
   * it), behind `edit:performance` in this project: reading the bolo is
   * `read:money`, writing a function is not. The new row shows by itself:
   * the create refreshes every `money-bolos` read, the bolo's window with it.
   */
  import { createMutation, createQuery, useQueryClient } from '@tanstack/svelte-query';
  import { toStore } from 'svelte/store';
  import { ApiError, fetchJSON, mutateJSON } from '$lib/api';
  import { addToast } from '$lib/components/Toast.svelte';
  import Button from '$lib/components/Button.svelte';
  import { retryLoad } from '$lib/load-fail';
  import { booksHref } from '$lib/bolo-pick';
  import { usePins } from '$lib/stores/pins.svelte';
  import { projectBolosQueryOptions } from '$lib/bolo-queries';
  import { dayLabel, localDayISO, viewerTimeZone } from '$lib/datetime';
  import { boloHistory, type BoloEvent, type BoloHistoryPayment } from '$lib/bolo-history';
  import { appLocale, t } from '$lib/i18n';
  import { lensOn } from '$lib/lenses.svelte';
  import { planAccessQueryOptions } from '$lib/plan-create';
  import {
    boloMoney,
    boloStatusLabel,
    contractState,
    fmtFee,
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
  import PerformanceCreateDialog from '$lib/components/PerformanceCreateDialog.svelte';
  import ExpenseDialog from '$lib/components/ExpenseDialog.svelte';

  interface Props {
    projectId: string;
    id: string;
  }

  let { projectId, id }: Props = $props();

  const locale = appLocale();
  const pins = usePins();
  /** The reader's day: the line of today, and what is past and what is coming. */
  const today = localDayISO();

  const bolosQuery = createQuery(toStore(() => ({ ...projectBolosQueryOptions(projectId), retry: retryLoad })));
  // The project feed carries the whole MoneyBolo row; `BoloLite` is its pick.
  let bolo = $derived((($bolosQuery.data?.items ?? []) as unknown as MoneyBolo[]).find((b) => b.id === id) ?? null);

  const wsQuery = createQuery(workspacesQueryOptions());
  type SpaceLite = { id: string; slug: string; name: string; invoicing_mode?: InvoicingMode | null };
  let space = $derived(
    (($wsQuery.data?.items ?? []) as unknown as SpaceLite[]).find((w) => w.id === bolo?.project?.workspace_id) ?? null,
  );
  let workspaceSlug = $derived(space?.slug ?? '');

  // Who pays is the organization of its conversation (ADR-102 § 5): its
  // record links from the facts (ADR-159). The conversation's own read, the
  // one its record uses, so a bolo opened from there costs nothing.
  const convQuery = createQuery(
    toStore(() => ({
      queryKey: ['conversation', workspaceSlug, bolo?.conversation_id ?? ''] as const,
      enabled: Boolean(workspaceSlug && bolo?.conversation_id),
      retry: retryLoad,
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        fetchJSON<{ item: { organization: { slug: string; name: string } | null } }>(
          `/api/conversations/${bolo!.conversation_id}`,
          signal,
        ),
    })),
  );
  let payer = $derived($convQuery.data?.item.organization ?? null);

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

  // Only an explicit «no» hides it (the RPC still gates the write).
  const planAccessQuery = createQuery(toStore(() => ({ ...planAccessQueryOptions(projectId), enabled: Boolean(bolo) })));
  let canAddFunction = $derived(lensOn('planner') && $planAccessQuery.data?.edit !== false);
  let addOpen = $state(false);
  // «+ Gasto» (ADR-170): the bolo is already chosen. Money is Cuentas'
  // (ADR-043), so it follows that lens; `create_expense` gates on edit:money.
  let canAddExpense = $derived(lensOn('books'));
  let expenseOpen = $state(false);

  let invoices = $derived($invoicesQuery.data?.items ?? []);
  let docs = $derived(bolo ? (invoicesByBolo(invoices).get(bolo.id) ?? []) : []);
  let expenses = $derived($expensesQuery.data?.items ?? []);

  // What came in against the bolo itself, with no invoice (Cuentas records a
  // payment there when there is no issued document): the documents bring
  // their own.
  const boloPaymentsQuery = createQuery(
    toStore(() => ({
      queryKey: ['payments', 'bolo', id] as const,
      enabled: Boolean(bolo),
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        fetchJSON<{ items: BoloHistoryPayment[] }>(`/api/payments?bolo_id=${encodeURIComponent(id)}`, signal),
    })),
  );

  let ctx = $derived({
    invoicesByBolo: invoicesByBolo(invoices),
    termsByPayer: observedPayerTermsDays(invoices, invoices.flatMap((i) => i.payments)),
    modeOf: () => (space?.invoicing_mode ?? 'legal') as InvoicingMode,
    today: new Date(),
  });
  let money = $derived(bolo ? boloMoney(bolo, ctx) : null);

  // ── The history (tarea 120) ─────────────────────────────────────────────
  const timeZone = viewerTimeZone();
  let history = $derived(
    bolo && money
      ? boloHistory({
          bolo,
          functions,
          docs,
          boloPayments: $boloPaymentsQuery.data?.items ?? [],
          money,
          today,
          timeZone,
        })
      : null,
  );
  // Until the documents are in, a history would say «nothing due» wrongly.
  let historyBusy = $derived($invoicesQuery.isLoading || $functionsQuery.isLoading || $boloPaymentsQuery.isLoading);
  let nowText = $derived.by(() => {
    const now = history?.now;
    if (!now) return '';
    switch (now.kind) {
      case 'overdue':
        return t(now.days === 1 ? 'bolo.now_overdue_one' : 'bolo.now_overdue_many', locale, { n: now.days });
      case 'due_today':
        return t('bolo.now_due_today', locale);
      case 'due_in':
        return t(now.days === 1 ? 'bolo.now_due_in_one' : 'bolo.now_due_in_many', locale, { n: now.days });
      case 'paid':
        return t('bolo.now_paid', locale);
      case 'cancelled':
        return t('bolo.now_cancelled', locale);
      default:
        return '';
    }
  });
  function eventKey(e: BoloEvent): string {
    return 'id' in e ? `${e.kind}:${e.id}` : e.kind;
  }
  // «Apuntar cobro»: money is written in Cuentas (ADR-043), and it does not
  // leave Hour (it is a note of what came in, not a message to the venue).
  let canRecordPayment = $derived(
    lensOn('books') && !!bolo && bolo.status !== 'cancelled' && !!money && money.fee !== null && money.collect !== 'full',
  );

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

  // A verb goes to Cuentas; your scope stays when it already shows the bolo.
  let here = $derived({ pins: pins.pins, workspaceSlug: workspaceSlug || null });
  let rowHref = $derived(booksHref(projectId, { boloId: id }));
  let payHref = $derived(booksHref(projectId, { boloId: id, act: 'pay', here }));
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
    contract: 'record.missing_bolo_contract',
    no_fee: 'record.missing_bolo_no_fee',
  };
  const ATTENTION_VERB: Record<AttentionItem['kind'], string> = {
    overdue: 'books.att_act_chase',
    to_invoice: 'books.att_act_invoice',
    draft: 'books.att_act_issue',
    fiscal: 'books.att_act_fiscal',
    contract: 'books.att_act_contract',
    no_fee: 'books.att_act_fee',
  };
  function missingItem(a: AttentionItem): MissingItem {
    // The contract is marked here, not in Cuentas: its verb is the next step.
    if (a.kind === 'contract') {
      return {
        id: a.kind,
        text: t(ATTENTION_TEXT[a.kind], locale),
        verbs: [{ label: t(contractVerb, locale).toLowerCase(), onclick: contractForward }],
      };
    }
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
              href: booksHref(projectId, { boloId: id, act: a.kind, here }),
            },
      ],
    };
  }
  let missingItems = $derived(
    lensOn('books')
      ? missing.map(missingItem)
      : missing.map((a) => (a.kind === 'contract' ? missingItem(a) : { ...missingItem(a), verbs: [] })),
  );

  // ── The contract (ADR-163): unsent → sent → signed, a date at each step ─
  const queryClient = useQueryClient();
  let contract = $derived(bolo ? contractState(bolo) : 'unsent');
  type ContractDates = { sent_at: string | null; signed_at: string | null };
  const saveContract = createMutation({
    mutationFn: (dates: ContractDates) => mutateJSON('PATCH', `/api/money/bolos/${id}`, { contract: dates }),
    // `money-bolos` is this record's feed and Cuentas' (bolo-queries).
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['money-bolos'] }),
    onError: (err) => {
      addToast({
        tone: 'danger',
        title: t('bolo.contract_not_saved', locale),
        message: err instanceof Error ? err.message : t('perf.unexpected', locale),
      });
    },
  });
  /** The next step, now. */
  function contractForward() {
    if (!bolo) return;
    const now = new Date().toISOString();
    if (contract === 'unsent') $saveContract.mutate({ sent_at: now, signed_at: null });
    else if (contract === 'sent') $saveContract.mutate({ sent_at: bolo.contract_sent_at ?? now, signed_at: now });
  }
  /** One step back: signed → sent, sent → unsent. */
  function contractBack() {
    if (!bolo) return;
    if (contract === 'signed') $saveContract.mutate({ sent_at: bolo.contract_sent_at ?? null, signed_at: null });
    else if (contract === 'sent') $saveContract.mutate({ sent_at: null, signed_at: null });
  }
  let contractVerb = $derived(contract === 'unsent' ? 'bolo.contract_mark_sent' : 'bolo.contract_mark_signed');

  function fmt(amount: number | string | null, currency: string | null): string {
    return fmtFee(amount === null ? null : Number(amount), currency, locale);
  }
</script>

{#snippet event(e: BoloEvent, ahead: boolean)}
  <li class="bolo-history__row" class:is-ahead={ahead} data-event={e.kind}>
    <span class="bolo-history__when">{e.day ? dayLabel(e.day) : ''}</span>
    {#if e.kind === 'opened'}
      <span>{t('bolo.ev_opened', locale)}</span>
    {:else if e.kind === 'agreed'}
      <span>{t('bolo.ev_agreed', locale)}</span>
    {:else if e.kind === 'contract_sent' || e.kind === 'contract_signed' || e.kind === 'contract_unsent'}
      <span>{t(`bolo.ev_${e.kind}`, locale)}</span>
      <!-- The contract's steps are marked on its own latest line (ADR-163):
           the next step, and one step back. -->
      {#if e.kind === 'contract_unsent' || e.kind === 'contract_signed' || !e.signed}
        <span class="bolo-record__acts" data-testid="bolo-contract">
          {#if contract !== 'signed'}
            <Button size="xs" variant="secondary" loading={$saveContract.isPending} onclick={contractForward}
              >{t(contractVerb, locale)}</Button
            >
          {/if}
          {#if contract !== 'unsent'}
            <Button size="xs" variant="quiet" disabled={$saveContract.isPending} onclick={contractBack}
              >{t('bolo.contract_undo', locale)}</Button
            >
          {/if}
        </span>
      {/if}
    {:else if e.kind === 'function'}
      <span
        >{t('bolo.ev_function', locale)}{#if e.place}{' · '}{#if e.slug && workspaceSlug}<a
              href={`/h/${workspaceSlug}/performance/${e.slug}`}>{e.place}</a
            >{:else}{e.place}{/if}{/if}</span
      >
      <span class="fact-word" data-family={performanceStatusFamily(e.status)}>{performanceStatusLabel(e.status, locale)}</span>
    {:else if e.kind === 'invoice'}
      <span
        >{t(e.docType === 'proforma' ? 'bolo.ev_proforma' : 'bolo.ev_invoice', locale)}{#if e.number}<span class="bolo-record__faint"
            >{` · ${e.number}`}</span
          >{/if}{#if e.payer}<span class="bolo-record__faint">{` · ${e.payer}`}</span>{/if}</span
      >
      <span class="bolo-record__num">{fmt(e.total, e.currency)}</span>
    {:else if e.kind === 'due'}
      <span>{t(e.source === 'due' || e.source === 'explicit' ? 'bolo.ev_due' : 'bolo.ev_due_expected', locale)}</span>
      {#if money}<span class="bolo-record__num">{fmt(money.owed, money.currency)}</span>{/if}
    {:else if e.kind === 'payment'}
      <span
        >{t('bolo.ev_payment', locale)}<span class="bolo-record__faint"
          >{` · ${paymentMethodLabel(e.method, locale)}`}{#if e.number}{` · ${e.number}`}{/if}</span
        ></span
      >
      <span class="bolo-record__num">{fmt(e.amount, e.currency)}</span>
    {/if}
  </li>
{/snippet}

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
        {#if payer}
          <span
            >{t('organization.payer', locale)}
            <a href={`/h/${workspaceSlug}/organization/${encodeURIComponent(payer.slug)}`}>{payer.name}</a></span
          >
        {/if}
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

    <section class="bolo-record__section" aria-label={t('bolo.history', locale)} data-testid="bolo-history">
      <BlockHead title={t('bolo.history', locale)}>
        {#if canAddFunction}
          <button type="button" class="block-head__act" onclick={() => (addOpen = true)}>{t('books.add_function', locale)}</button>
        {/if}
      </BlockHead>
      {#if historyBusy || !history}
        <EmptyLine text={t('desk.loading', locale)} busy />
      {:else}
        <ol class="bolo-history" role="list">
          {#each history.past as e (eventKey(e))}
            {@render event(e, false)}
          {/each}
          <li class="bolo-history__today" data-testid="bolo-today" data-now={history.now.kind}>
            <span class="bolo-history__when">{t('bolo.today', locale)}</span>
            {#if nowText}<span class="bolo-history__now">{nowText}</span>{/if}
          </li>
          {#each history.future as e (eventKey(e))}
            {@render event(e, true)}
          {/each}
        </ol>
      {/if}
      {#if canRecordPayment}
        <p class="bolo-history__write" data-testid="bolo-record-payment">
          <a class="link-arrow" href={payHref}>{t('bolo.record_payment', locale)}</a>
          <span class="bolo-record__faint">{t('bolo.record_payment_note', locale)}</span>
        </p>
      {/if}
      {#if conversationHref}
        <p class="bolo-record__more"><a class="link-arrow" href={conversationHref}>{t('books.sheet_conversation', locale)}</a></p>
      {/if}
    </section>

    <section class="bolo-record__section" aria-label={t('books.expenses', locale)}>
      {#if expenses.length === 0}
        <EmptyLine label={t('books.expenses', locale)} text={t('peek.bolo_no_expenses', locale)} busy={$expensesQuery.isLoading}>
          {#if canAddExpense}<button type="button" class="empty-line__act" onclick={() => (expenseOpen = true)}>{t('books.add_expense_short', locale)}</button>{/if}
        </EmptyLine>
      {:else}
        <BlockHead title={t('books.expenses', locale)} count={expenses.length}>
          {#if canAddExpense}
            <button type="button" class="block-head__act" onclick={() => (expenseOpen = true)}>{t('books.add_expense_short', locale)}</button>
          {/if}
        </BlockHead>
        <ul class="bolo-record__rows" role="list">
          {#each expenses as e (e.id)}
            <li class="bolo-record__row">
              <span class="bolo-record__when">{dayLabel(e.incurred_on)}</span>
              <span
                >{e.description}<span class="bolo-record__faint">{` · ${categoryLabel(e.category, locale)}`}</span
                >{#if e.paid_by_person_id}<span class="bolo-record__faint"
                    >{` · ${t('books.paid_by_named', locale, { name: e.paid_by_name ?? t('books.owed_someone', locale) })}`}{#if e.reimbursed}{` · ${t('books.reimbursed', locale)}`}{/if}</span
                  >{/if}</span
              >
              <span class="bolo-record__num">{fmt(e.amount, e.currency)}</span>
            </li>
          {/each}
        </ul>
      {/if}
    </section>
  {/if}
</article>

{#if canAddExpense && bolo}
  <ExpenseDialog
    bind:open={expenseOpen}
    anchors={[{ value: `bolo:${id}`, label: title, workspaceId: bolo.project?.workspace_id ?? '' }]}
    lockAnchor
    currency={bolo.fee_currency ?? 'EUR'}
  />
{/if}

{#if canAddFunction}
  <PerformanceCreateDialog bind:open={addOpen} presetProjectId={projectId} lockProject presetBoloId={id} />
{/if}

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
    .bolo-record__more {
      margin: 0;
    }
    /* The history (tarea 120): one line per thing that happened, the day in
       the record's mono column; what is coming reads quieter. */
    .bolo-history {
      display: flex;
      flex-direction: column;
      gap: var(--space-2xs);
      margin: 0;
      padding: 0;
      list-style: none;
    }
    .bolo-history__row {
      display: flex;
      flex-wrap: wrap;
      align-items: baseline;
      gap: var(--space-2xs) var(--space-s);
      font-size: var(--text-s);
    }
    .bolo-history__row.is-ahead {
      color: var(--text-muted);
    }
    .bolo-history__when {
      flex: none;
      min-inline-size: var(--record-label-inline);
      font-family: var(--font-mono);
      font-size: var(--text-xs);
      letter-spacing: var(--mono-letter-spacing);
      color: var(--text-faint);
    }
    /* A function is a line of the history, not a call to action: ink, and
       the underline only under the pointer. */
    .bolo-history__row a {
      color: inherit;
      text-decoration: none;
    }
    .bolo-history__row a:hover {
      text-decoration: underline;
    }
    .bolo-history__row .bolo-record__num {
      margin-inline-start: auto;
    }
    /* The line of today: ink at 40%, as the planner's «now» (never blue,
       never red); the words say where the money stands. */
    .bolo-history__today {
      display: flex;
      align-items: baseline;
      gap: var(--space-s);
      padding-block-start: var(--space-2xs);
      border-block-start: var(--line-hairline) solid color-mix(in oklch, var(--text-color) 40%, transparent);
      font-size: var(--text-s);
    }
    .bolo-history__today .bolo-history__when {
      color: var(--text-muted);
    }
    .bolo-history__now {
      color: var(--text-color);
      font-weight: 500;
    }
    .bolo-history__write {
      display: flex;
      flex-wrap: wrap;
      align-items: baseline;
      gap: var(--space-2xs) var(--space-s);
      margin: 0;
      font-size: var(--text-s);
    }
    .bolo-record__acts {
      display: inline-flex;
      gap: var(--space-2xs);
      margin-inline-start: auto;
    }
  }
</style>
