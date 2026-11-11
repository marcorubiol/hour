<script lang="ts">
  /**
   * Money module (ADR-056 + ADR-087) — the deals (bolos) + invoices of a
   * line, plus the expense rows UI. Content-only: the line shell owns the
   * page-level eyebrow; this module uses small mono sub-eyebrows per subsection.
   *
   * Fees read the bolo fee via /api/money/bolos — fee_amount is NULL both when
   * masked (no read:money) and when unset, indistinguishable by design → render
   * '—' and never present 0.00 as real when every fee is null.
   *
   * Invoices: headers carry no line linkage (join path is
   * invoice_line.bolo_id → bolo.line_id), so the module fetches the project's
   * invoices and filters client-side against this line's bolo ids. Read-only
   * here — creation lives in the Money lens / fee editor.
   */

  import EmptyLine from '$lib/components/EmptyLine.svelte';
  import LineModule from './LineModule.svelte';
  import { createMutation, createQuery, useQueryClient } from '@tanstack/svelte-query';
  import { toStore } from 'svelte/store';
  import { fetchJSON, mutateJSON } from '$lib/api';
  import ExpenseDialog from '$lib/components/ExpenseDialog.svelte';
  import Menu from '$lib/components/Menu.svelte';
  import StateBadge from '$lib/components/StateBadge.svelte';
  import { addToast } from '$lib/components/Toast.svelte';
  import { dayLabel } from '$lib/datetime';
  import {
    boloStatusLabel,
    fmtFee,
    fmtMoney,
    invoiceStatusLabel,
    invoiceTone,
    totalsByCurrency,
  } from '$lib/money';
  import { categoryLabel } from '$lib/expense';
  import { appLocale, t } from '$lib/i18n';
  import { performanceStatusTone } from '$lib/performance';

  interface Props {
    line: {
      id: string;
      slug: string | null;
      name: string;
      kind: string;
      project_id: string;
      workspace_id: string;
    };
    workspaceSlug: string;
    title: string;
  }

  // workspaceSlug is part of the shared module contract; the deals table no
  // longer links per-function (a bolo has no route), so it is unused here.
  let { line, title }: Props = $props();

  type FeeItem = {
    id: string;
    first_performed_at: string | null;
    function_count: number;
    status: string;
    venue_name: string | null;
    city: string | null;
    fee_amount: number | null;
    fee_currency: string | null;
    collected: number;
    project_id: string;
    line_id: string | null;
  };

  type InvoiceItem = {
    id: string;
    number: string | null;
    status: string;
    issued_on: string;
    due_on: string | null;
    subtotal: number;
    total: number;
    currency: string;
    payer: { name: string } | null;
    lines: { bolo_id: string | null }[];
  };

  type ExpenseRow = {
    id: string;
    category: string;
    description: string;
    amount: number;
    currency: string;
    incurred_on: string | null;
    reimbursed: boolean;
    notes: string | null;
    paid_by_person_id: string | null;
    paid_by_name?: string | null;
  };

  const queryClient = useQueryClient();
  const locale = appLocale();

  // ── Fees ──────────────────────────────────────────────────────────────
  const feesOptions = toStore(() => ({
    queryKey: ['line-money-fees', line.id] as const,
    queryFn: ({ signal }: { signal: AbortSignal }) =>
      fetchJSON<{ items: FeeItem[] }>(
        `/api/money/bolos?line_ids=${line.id}&limit=500`,
        signal,
      ),
  }));
  const feesQuery = createQuery(feesOptions);

  let fees = $derived($feesQuery.data?.items ?? []);
  // Declared BEFORE the invoices toStore below (TDZ rule).
  let feeIds = $derived(new Set(fees.map((f) => f.id)));

  /** True masked-or-unset across the board — totals would lie as 0.00. */
  let allFeesNull = $derived(fees.length > 0 && fees.every((f) => f.fee_amount === null));

  /** Same lifecycle bucketing as the Money lens; collected is payment-derived. */
  let totals = $derived.by(() => {
    const buckets = { pipeline: 0, invoiced: 0, collected: 0 };
    for (const f of fees) {
      buckets.collected += Number(f.collected ?? 0);
      if (f.fee_amount === null) continue;
      if (f.status === 'confirmed' || f.status === 'done') buckets.pipeline += f.fee_amount;
      else if (f.status === 'invoiced') buckets.invoiced += f.fee_amount;
    }
    return buckets;
  });

  // ── Invoices (project-scoped fetch, line-filtered client-side) ────────
  const invoicesOptions = toStore(() => ({
    queryKey: ['line-money-invoices', line.project_id] as const,
    queryFn: ({ signal }: { signal: AbortSignal }) =>
      fetchJSON<{ items: InvoiceItem[] }>(
        `/api/invoices?project_ids=${line.project_id}&limit=100`,
        signal,
      ),
  }));
  const invoicesQuery = createQuery(invoicesOptions);

  let lineInvoices = $derived(
    ($invoicesQuery.data?.items ?? []).filter((inv) =>
      inv.lines.some((l) => l.bolo_id !== null && feeIds.has(l.bolo_id)),
    ),
  );

  // ── Expenses ──────────────────────────────────────────────────────────
  const expensesOptions = toStore(() => ({
    queryKey: ['line-expenses', line.id] as const,
    queryFn: ({ signal }: { signal: AbortSignal }) =>
      fetchJSON<{ items: ExpenseRow[] }>(`/api/expenses?line_ids=${line.id}`, signal),
  }));
  const expensesQuery = createQuery(expensesOptions);

  let expenses = $derived($expensesQuery.data?.items ?? []);

  let expenseTotals = $derived(totalsByCurrency(expenses, (e) => e.currency, (e) => e.amount));

  let feesError = $derived($feesQuery.error instanceof Error ? $feesQuery.error.message : '');
  let invoicesError = $derived(
    $invoicesQuery.error instanceof Error ? $invoicesQuery.error.message : '',
  );
  let expensesError = $derived(
    $expensesQuery.error instanceof Error ? $expensesQuery.error.message : '',
  );

  // ── Add expense: the shared dialog (ADR-170), on this line ───────────
  let expOpen = $state(false);
  const openExpense = () => (expOpen = true);

  // ADR-145 § 1 inside the module: bolos and invoices are only a reading, so
  // an empty group is not drawn; with nothing in any of the three, the module
  // is one line with «+ Gasto» (LineModule). One busy line while any reads.
  let reading = $derived($feesQuery.isLoading || $invoicesQuery.isLoading || $expensesQuery.isLoading);
  let nothing = $derived(
    !reading &&
      !feesError &&
      !invoicesError &&
      !expensesError &&
      fees.length === 0 &&
      lineInvoices.length === 0 &&
      expenses.length === 0,
  );

  const removeExpense = createMutation({
    mutationFn: (id: string) => mutateJSON('DELETE', `/api/expenses/${id}`),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['line-expenses', line.id] }),
    onError: (err) => {
      addToast({
        tone: 'danger',
        title: t('books.expense_not_removed', locale),
        message: err instanceof Error ? err.message : t('perf.unexpected', locale),
      });
    },
  });
</script>

{#snippet action(cls: string)}
  <button type="button" class={cls} onclick={openExpense}>{t('books.add_expense_short', locale)}</button>
{/snippet}

<LineModule {title} empty={nothing} {action}>
{#if reading}
  <EmptyLine text={t('desk.loading', locale)} busy />
{:else}
<div class="lmm">
  {#if feesError || fees.length > 0}
  <section class="lmm__section" aria-label={t('books.fees', locale)}>
    <p class="eyebrow eyebrow--sub lmm__sub">{t('books.fees', locale)}</p>
    {#if feesError}
      <p class="load-fail" role="alert">{feesError}</p>
    {:else}
      {#if allFeesNull}
        <EmptyLine text={t('books.fees_hidden', locale)} />
      {:else}
        <div class="lmm__totals">
          <span class="lmm__total">
            <span class="eyebrow eyebrow--sub lmm__total-label">{t('books.in_progress', locale)}</span>
            {fmtMoney(totals.pipeline)}
          </span>
          <span class="lmm__total">
            <span class="eyebrow eyebrow--sub lmm__total-label">{t('books.invoiced', locale)}</span>
            {fmtMoney(totals.invoiced)}
          </span>
          <span class="lmm__total">
            <span class="eyebrow eyebrow--sub lmm__total-label">{t('books.collected', locale)}</span>
            {fmtMoney(totals.collected)}
          </span>
        </div>
      {/if}
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>{t('perf.date', locale)}</th>
              <th>{t('edit.status', locale)}</th>
              <th>{t('books.where', locale)}</th>
              <th>{t('books.fee', locale)}</th>
            </tr>
          </thead>
          <tbody>
            {#each fees as f (f.id)}
              <tr>
                <td class="lmm__cell-date">
                  {f.first_performed_at ? dayLabel(f.first_performed_at) : '—'}
                  {#if f.function_count > 1}<span class="lmm__fn-count">{' · '}{t('books.fn_count', locale, { n: f.function_count })}</span>{/if}
                </td>
                <td>
                  <StateBadge
                    label={boloStatusLabel(f.status, locale)}
                    tone={performanceStatusTone(f.status)}
                  />
                </td>
                <td class="lmm__cell-muted">
                  {[f.venue_name, f.city].filter(Boolean).join(' · ') || '—'}
                </td>
                <td class="lmm__cell-amount">{fmtFee(f.fee_amount, f.fee_currency)}</td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    {/if}
  </section>

  {/if}

  {#if invoicesError || lineInvoices.length > 0}
  <section class="lmm__section" aria-label={t('books.invoices', locale)}>
    <p class="eyebrow eyebrow--sub lmm__sub">{t('books.invoices', locale)}</p>
    {#if invoicesError}
      <p class="load-fail" role="alert">{invoicesError}</p>
    {:else}
      <ul class="lmm__invoices" role="list">
        {#each lineInvoices as inv (inv.id)}
          <li>
            <span class="lmm__inv-number">{inv.number ?? t('books.no_number', locale)}</span>
            <StateBadge label={invoiceStatusLabel(inv.status, locale)} tone={invoiceTone(inv.status)} />
            <span class="lmm__inv-total">{fmtMoney(inv.total)} {inv.currency}</span>
            <span class="lmm__cell-date">{dayLabel(inv.issued_on)}</span>
          </li>
        {/each}
      </ul>
    {/if}
  </section>

  {/if}

  {#if expensesError || expenses.length > 0}
  <section class="lmm__section" aria-label={t('books.expenses', locale)}>
    <p class="eyebrow eyebrow--sub lmm__sub">{t('books.expenses', locale)}</p>
    {#if expensesError}
      <p class="load-fail" role="alert">{expensesError}</p>
    {:else}
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>{t('perf.date', locale)}</th>
              <th>{t('books.category', locale)}</th>
              <th>{t('books.description', locale)}</th>
              <th>{t('books.amount', locale)}</th>
              <th aria-label={t('books.actions', locale)}></th>
            </tr>
          </thead>
          <tbody>
            {#each expenses as e (e.id)}
              <tr>
                <td class="lmm__cell-date">{e.incurred_on ? dayLabel(e.incurred_on) : '—'}</td>
                <td class="lmm__cell-muted">{categoryLabel(e.category, locale)}</td>
                <td
                  >{e.description}{#if e.paid_by_person_id}<span class="lmm__cell-muted"
                      >{` · ${t('books.paid_by_named', locale, { name: e.paid_by_name ?? t('books.owed_someone', locale) })}`}{#if e.reimbursed}{` · ${t('books.reimbursed', locale)}`}{/if}</span
                    >{/if}</td
                >
                <td class="lmm__cell-amount">{fmtMoney(e.amount)} {e.currency}</td>
                <td class="lmm__cell-actions">
                  <Menu
                    label={t('books.expense_actions', locale)}
                    align="end"
                    triggerClass="btn--secondary btn--xs"
                    items={[
                      {
                        label: t('books.remove', locale),
                        danger: true,
                        onclick: () => $removeExpense.mutate(e.id),
                      },
                    ]}
                  />
                </td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
      <p class="lmm__exp-total">
        {t('books.total_label', locale)} {expenseTotals.map(([c, sum]) => `${fmtMoney(sum)} ${c}`).join(' · ')}
      </p>
    {/if}
  </section>
  {/if}
</div>
{/if}
</LineModule>

<ExpenseDialog
  bind:open={expOpen}
  anchors={[{ value: `line:${line.id}`, label: line.name, workspaceId: line.workspace_id }]}
  lockAnchor
/>

<style>
  @layer components {
    .lmm {
      display: flex;
      flex-direction: column;
      gap: var(--space-l);
    }

    .lmm__section {
      display: flex;
      flex-direction: column;
      gap: var(--space-s);
    }


    /* Sub-eyebrow typography via base.css .eyebrow--sub. */

    .lmm__totals {
      display: flex;
      align-items: baseline;
      gap: var(--space-l);
      flex-wrap: wrap;
    }

    .lmm__total {
      font-family: var(--font-display);
      font-size: var(--text-l);
      color: var(--text-color);
      display: flex;
      align-items: baseline;
      gap: var(--space-xs);
    }

    .lmm__cell-date {
      font-family: var(--font-mono);
      font-size: var(--text-xs);
      color: var(--text-muted);
      white-space: nowrap;
    }

    .lmm__cell-muted {
      color: var(--text-dark-muted);
      font-size: var(--text-s);
    }

    .lmm__cell-amount {
      font-variant-numeric: tabular-nums;
      font-size: var(--text-s);
      text-align: end;
      white-space: nowrap;
    }

    .lmm__cell-actions {
      text-align: end;
    }

    .lmm__fn-count {
      font-family: var(--font-mono);
      font-size: var(--text-xs);
      color: var(--text-faint);
    }

    .lmm__invoices li {
      display: flex;
      gap: var(--space-m);
      align-items: baseline;
      padding-block: var(--space-xs);
      border-block-end: var(--line-hairline) solid var(--border-color-light);
    }

    .lmm__inv-number {
      font-family: var(--font-mono);
      font-size: var(--text-xs);
      color: var(--text-faint);
      min-inline-size: 6rem;
    }

    .lmm__inv-total {
      font-variant-numeric: tabular-nums;
      font-size: var(--text-s);
      margin-inline-start: auto;
    }

    .lmm__exp-total {
      font-size: var(--text-xs);
      color: var(--text-muted);
      font-variant-numeric: tabular-nums;
    }
  }
</style>
