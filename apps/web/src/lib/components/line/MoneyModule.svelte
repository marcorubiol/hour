<script lang="ts">
  /**
   * Money module (ADR-056) — fees + invoices of a line, plus the expense
   * rows UI. Content-only: the line shell owns the page-level eyebrow;
   * this module uses small mono sub-eyebrows per subsection.
   *
   * Fees read `performance_redacted` via /api/money/performances —
   * fee_amount is NULL both when masked (no read:money) and when unset,
   * indistinguishable by design → render '—' and never present 0.00 as
   * real when every fee is null.
   *
   * Invoices: headers carry no line linkage (join path is
   * invoice_line.performance_id → performance.line_id), so the module
   * fetches the project's invoices and filters client-side against this
   * line's performance ids. Read-only here — creation lives in the Money
   * lens / fee editor.
   */

  import { createMutation, createQuery, useQueryClient } from '@tanstack/svelte-query';
  import { toStore } from 'svelte/store';
  import { fetchJSON, mutateJSON } from '$lib/api';
  import Button from '$lib/components/Button.svelte';
  import Dialog from '$lib/components/Dialog.svelte';
  import Input from '$lib/components/Input.svelte';
  import Menu from '$lib/components/Menu.svelte';
  import Select from '$lib/components/Select.svelte';
  import StateBadge from '$lib/components/StateBadge.svelte';
  import { addToast } from '$lib/components/Toast.svelte';
  import { dayLabel } from '$lib/datetime';
  import { fmtFee, fmtMoney, invoiceTone } from '$lib/money';
  import { CATEGORY_LABELS, EXPENSE_CATEGORIES, categoryLabel } from '$lib/expense';
  import { performanceStatusLabel, performanceStatusTone } from '$lib/performance';

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
  }

  let { line, workspaceSlug }: Props = $props();

  type FeeItem = {
    id: string;
    slug: string | null;
    performed_at: string;
    status: string;
    venue_name: string | null;
    city: string | null;
    fee_amount: number | null;
    fee_currency: string | null;
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
    payer: { full_name: string; organization_name: string | null } | null;
    lines: { performance_id: string | null }[];
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
  };

  const queryClient = useQueryClient();

  // ── Fees ──────────────────────────────────────────────────────────────
  const feesOptions = toStore(() => ({
    queryKey: ['line-money-fees', line.id] as const,
    queryFn: ({ signal }: { signal: AbortSignal }) =>
      fetchJSON<{ items: FeeItem[] }>(
        `/api/money/performances?line_ids=${line.id}&limit=500`,
        signal,
      ),
  }));
  const feesQuery = createQuery(feesOptions);

  let fees = $derived($feesQuery.data?.items ?? []);
  // Declared BEFORE the invoices toStore below (TDZ rule).
  let feeIds = $derived(new Set(fees.map((f) => f.id)));

  /** True masked-or-unset across the board — totals would lie as 0.00. */
  let allFeesNull = $derived(fees.length > 0 && fees.every((f) => f.fee_amount === null));

  /** Same lifecycle bucketing as the Money lens. */
  let totals = $derived.by(() => {
    const buckets = { pipeline: 0, invoiced: 0, paid: 0 };
    for (const f of fees) {
      if (f.fee_amount === null) continue;
      if (f.status === 'confirmed' || f.status === 'done') buckets.pipeline += f.fee_amount;
      else if (f.status === 'invoiced') buckets.invoiced += f.fee_amount;
      else if (f.status === 'paid') buckets.paid += f.fee_amount;
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
      inv.lines.some((l) => l.performance_id !== null && feeIds.has(l.performance_id)),
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

  /** Per-currency sums — never add EUR to USD. */
  let expenseTotals = $derived.by(() => {
    const map = new Map<string, number>();
    for (const e of expenses) map.set(e.currency, (map.get(e.currency) ?? 0) + e.amount);
    return [...map.entries()];
  });

  let feesError = $derived($feesQuery.error instanceof Error ? $feesQuery.error.message : '');
  let invoicesError = $derived(
    $invoicesQuery.error instanceof Error ? $invoicesQuery.error.message : '',
  );
  let expensesError = $derived(
    $expensesQuery.error instanceof Error ? $expensesQuery.error.message : '',
  );

  // ── Add expense dialog ────────────────────────────────────────────────
  const categoryOptions = EXPENSE_CATEGORIES.map((c) => ({
    value: c,
    label: CATEGORY_LABELS[c],
  }));

  function todayISO(): string {
    const d = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }

  let expOpen = $state(false);
  let eCategory = $state('other');
  let eDescription = $state('');
  let eAmount = $state('');
  let eCurrency = $state('EUR');
  let eDate = $state('');
  let eNotes = $state('');

  function openExpense() {
    eCategory = 'other';
    eDescription = '';
    eAmount = '';
    eCurrency = 'EUR';
    eDate = todayISO();
    eNotes = '';
    expOpen = true;
  }

  type ExpensePayload = {
    line_id: string;
    category: string;
    description: string;
    amount: number;
    currency: string;
    incurred_on: string | null;
    notes: string | null;
  };

  const createExpense = createMutation({
    mutationFn: (input: ExpensePayload) =>
      mutateJSON<{ expense: unknown }>('POST', '/api/expenses', input),
    onSuccess: () => {
      expOpen = false;
      void queryClient.invalidateQueries({ queryKey: ['line-expenses', line.id] });
    },
    onError: (err) => {
      addToast({
        tone: 'danger',
        title: 'Expense not added',
        message: err instanceof Error ? err.message : 'Unexpected error',
      });
    },
  });

  function submitExpense() {
    const description = eDescription.trim();
    if (!description) {
      addToast({ tone: 'warning', message: 'Description is required.' });
      return;
    }
    // type=number binds a number (or undefined on empty) through Svelte —
    // normalize via String before deciding empty-vs-value.
    const rawAmount = String(eAmount ?? '').trim();
    const amount = Number(rawAmount);
    if (rawAmount === '' || Number.isNaN(amount) || amount <= 0) {
      addToast({ tone: 'warning', message: 'Amount must be a positive number.' });
      return;
    }
    const currency = eCurrency.trim().toUpperCase();
    if (!/^[A-Z]{3}$/.test(currency)) {
      addToast({ tone: 'warning', message: 'Currency must be a 3-letter code (e.g. EUR).' });
      return;
    }
    $createExpense.mutate({
      line_id: line.id,
      category: eCategory,
      description,
      amount: Number(amount.toFixed(2)),
      currency,
      incurred_on: eDate || null,
      notes: eNotes.trim() || null,
    });
  }

  const removeExpense = createMutation({
    mutationFn: (id: string) => mutateJSON('DELETE', `/api/expenses/${id}`),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['line-expenses', line.id] }),
    onError: (err) => {
      addToast({
        tone: 'danger',
        title: 'Expense not removed',
        message: err instanceof Error ? err.message : 'Unexpected error',
      });
    },
  });
</script>

<section class="lmm">
  <section class="lmm__section" aria-label="Fees">
    <p class="eyebrow eyebrow--sub lmm__sub">Fees</p>
    {#if feesError}
      <p class="lmm__state lmm__state--danger">{feesError}</p>
    {:else if $feesQuery.isLoading}
      <p class="lmm__state">Loading…</p>
    {:else if fees.length === 0}
      <p class="lmm__state">No performances on this line yet.</p>
    {:else}
      {#if allFeesNull}
        <p class="lmm__state">Fees hidden or unset.</p>
      {:else}
        <div class="lmm__totals">
          <span class="lmm__total">
            <span class="eyebrow eyebrow--sub lmm__total-label">pipeline</span>
            {fmtMoney(totals.pipeline)}
          </span>
          <span class="lmm__total">
            <span class="eyebrow eyebrow--sub lmm__total-label">invoiced</span>
            {fmtMoney(totals.invoiced)}
          </span>
          <span class="lmm__total">
            <span class="eyebrow eyebrow--sub lmm__total-label">paid</span>
            {fmtMoney(totals.paid)}
          </span>
        </div>
      {/if}
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Date</th>
              <th>Status</th>
              <th>Where</th>
              <th>Fee</th>
            </tr>
          </thead>
          <tbody>
            {#each fees as f (f.id)}
              <tr>
                <td class="lmm__cell-date">{dayLabel(f.performed_at)}</td>
                <td>
                  <StateBadge
                    label={performanceStatusLabel(f.status)}
                    tone={performanceStatusTone(f.status)}
                  />
                </td>
                <td class="lmm__cell-muted">
                  {#if f.slug}
                    <a class="lmm__perf-link" href={`/h/${workspaceSlug}/performance/${f.slug}`}>
                      {[f.venue_name, f.city].filter(Boolean).join(' · ') || '—'}
                    </a>
                  {:else}
                    {[f.venue_name, f.city].filter(Boolean).join(' · ') || '—'}
                  {/if}
                </td>
                <td class="lmm__cell-amount">{fmtFee(f.fee_amount, f.fee_currency)}</td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    {/if}
  </section>

  <section class="lmm__section" aria-label="Invoices">
    <p class="eyebrow eyebrow--sub lmm__sub">Invoices</p>
    {#if invoicesError}
      <p class="lmm__state lmm__state--danger">{invoicesError}</p>
    {:else if $invoicesQuery.isLoading}
      <p class="lmm__state">Loading…</p>
    {:else if lineInvoices.length === 0}
      <p class="lmm__state">No invoices on this line yet.</p>
    {:else}
      <ul class="lmm__invoices" role="list">
        {#each lineInvoices as inv (inv.id)}
          <li>
            <span class="lmm__inv-number">{inv.number ?? 'no number'}</span>
            <StateBadge label={inv.status} tone={invoiceTone(inv.status)} />
            <span class="lmm__inv-total">{fmtMoney(inv.total)} {inv.currency}</span>
            <span class="lmm__cell-date">{dayLabel(inv.issued_on)}</span>
          </li>
        {/each}
      </ul>
    {/if}
  </section>

  <section class="lmm__section" aria-label="Expenses">
    <header class="lmm__section-head">
      <p class="eyebrow eyebrow--sub lmm__sub">Expenses</p>
      <Button size="xs" variant="outline" onclick={openExpense}>Add expense</Button>
    </header>
    {#if expensesError}
      <p class="lmm__state lmm__state--danger">{expensesError}</p>
    {:else if $expensesQuery.isLoading}
      <p class="lmm__state">Loading…</p>
    {:else if expenses.length === 0}
      <p class="lmm__state">No expenses on this line yet.</p>
    {:else}
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Date</th>
              <th>Category</th>
              <th>Description</th>
              <th>Amount</th>
              <th aria-label="Actions"></th>
            </tr>
          </thead>
          <tbody>
            {#each expenses as e (e.id)}
              <tr>
                <td class="lmm__cell-date">{e.incurred_on ? dayLabel(e.incurred_on) : '—'}</td>
                <td class="lmm__cell-muted">{categoryLabel(e.category)}</td>
                <td>{e.description}</td>
                <td class="lmm__cell-amount">{fmtMoney(e.amount)} {e.currency}</td>
                <td class="lmm__cell-actions">
                  <Menu
                    label="Expense actions"
                    align="end"
                    triggerClass="btn--outline btn--xs"
                    items={[
                      {
                        label: 'Remove',
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
        Total: {expenseTotals.map(([c, sum]) => `${fmtMoney(sum)} ${c}`).join(' · ')}
      </p>
    {/if}
  </section>
</section>

<Dialog bind:open={expOpen} title="Add expense" size="m">
  <div class="lmm__form-grid">
    <Select label="Category" bind:value={eCategory} options={categoryOptions} />
    <Input label="Description" bind:value={eDescription} required />
    <div class="field">
      <label for="lmm-exp-amount">Amount<span aria-hidden="true"> *</span></label>
      <input
        id="lmm-exp-amount"
        type="number"
        step="0.01"
        min="0.01"
        bind:value={eAmount}
        required
      />
    </div>
    <Input label="Currency" bind:value={eCurrency} placeholder="EUR" />
    <Input label="Date" type="date" bind:value={eDate} />
    <Input label="Notes" bind:value={eNotes} placeholder="Optional" />
  </div>
  {#snippet actions()}
    <Button variant="outline" onclick={() => (expOpen = false)}>Cancel</Button>
    <Button onclick={submitExpense} loading={$createExpense.isPending}>Add</Button>
  {/snippet}
</Dialog>

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

    .lmm__section-head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: var(--space-s);
    }

    /* Sub-eyebrow typography via base.css .eyebrow--sub. */

    .lmm__state {
      font-size: var(--text-s);
      color: var(--text-faint);
    }
    .lmm__state--danger {
      color: var(--danger);
    }

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

    .lmm__perf-link {
      color: var(--text-color);
      font-weight: 500;
      text-decoration: none;
    }
    .lmm__perf-link:hover {
      text-decoration: underline;
    }

    .lmm__invoices li {
      display: flex;
      gap: var(--space-m);
      align-items: baseline;
      padding-block: var(--space-xs);
      border-block-end: 1px solid var(--border-color-light);
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

    .lmm__form-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(9rem, 1fr));
      gap: var(--space-s) var(--space-m);
      margin-block: var(--space-s);
    }
  }
</style>
