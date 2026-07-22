<script lang="ts">
  /**
   * Money lens v3 (ADR-086). The gig's fee is the anchor: "collected" derives
   * from payments-against-fee (list_money_performances.collected), cobrar and
   * facturar are independent. Documents (factura/proforma) are optional and
   * driven by each workspace's invoicing_mode. Filter = sidebar pins (ADR-038).
   *
   * Reads are money-gated (fees NULLed without read:money). Fee editing lives
   * here by design (ADR-043). Payment is decoupled from the invoice: recording
   * one anchors to the gig and moves its collected state, with or without a
   * document.
   */

  import { createMutation, createQuery, useQueryClient } from '@tanstack/svelte-query';
  import { toStore } from 'svelte/store';
  import { fetchJSON, mutateJSON } from '$lib/api';
  import Button from '$lib/components/Button.svelte';
  import MoneyInvoices from '$lib/components/MoneyInvoices.svelte';
  import LensSwitcher from '$lib/components/LensSwitcher.svelte';
  import Dialog from '$lib/components/Dialog.svelte';
  import Input from '$lib/components/Input.svelte';
  import Select from '$lib/components/Select.svelte';
  import StateBadge from '$lib/components/StateBadge.svelte';
  import { addToast } from '$lib/components/Toast.svelte';
  import { dayLabel } from '$lib/datetime';
  import { categoryLabel, EXPENSE_CATEGORIES, type ExpenseItem } from '$lib/expense';
  import { fmtFee, fmtMoney, PAYMENT_METHODS, type MoneyInvoiceItem, type MoneyPayer } from '$lib/money';
  import { performanceStatusLabel, performanceStatusTone } from '$lib/performance';
  import { usePins } from '$lib/stores/pins.svelte';
  import {
    buildLineIndex,
    buildProjectIndex,
    resolveScope,
    lineUrl,
    type NavLine,
    type NavWorkspace,
    type RawLine,
  } from '$lib/nav';
  import { activeProjectsQueryOptions, allLinesQueryOptions } from '$lib/nav-queries';
  import { lineKindGlyph } from '$lib/utils/line-kind';
  import { goto } from '$app/navigation';

  type InvoicingMode = 'off' | 'interno' | 'legal';
  type WorkspaceLite = { id: string; slug: string; invoicing_mode: InvoicingMode | null };

  type MoneyPerformance = {
    id: string;
    slug: string | null;
    performed_at: string;
    status: string;
    venue_name: string | null;
    city: string | null;
    fee_amount: number | null;
    fee_currency: string | null;
    line_id: string | null;
    collected: number;
    project: { id: string; slug: string; name: string; workspace_id: string } | null;
  };

  const PAYMENT_METHOD_LABELS: Record<string, string> = {
    transfer: 'Transfer',
    card: 'Card',
    cash: 'Cash',
    other: 'Other',
  };

  const pins = usePins();

  const workspacesQuery = createQuery({
    queryKey: ['workspaces'],
    queryFn: ({ signal }: { signal: AbortSignal }) =>
      fetchJSON<{ items: WorkspaceLite[] }>('/api/workspaces', signal),
  });
  const projectsQuery = createQuery(activeProjectsQueryOptions());
  const linesQuery = createQuery(allLinesQueryOptions());

  let workspaceSlugById = $derived(
    new Map(($workspacesQuery.data?.items ?? []).map((w) => [w.id, w.slug])),
  );
  let workspaceModeById = $derived(
    new Map(($workspacesQuery.data?.items ?? []).map((w) => [w.id, (w.invoicing_mode ?? 'legal') as InvoicingMode])),
  );
  let defaultWorkspaceSlug = $derived($workspacesQuery.data?.items[0]?.slug ?? '');

  // ── Pins → scope (Adaptive Digest) ────────────────────────────────────
  let projectIndex = $derived(
    buildProjectIndex(($workspacesQuery.data?.items ?? []) as unknown as NavWorkspace[], $projectsQuery.data?.items ?? []),
  );
  let lineIndex = $derived(
    buildLineIndex(($workspacesQuery.data?.items ?? []) as unknown as NavWorkspace[], ($linesQuery.data?.items as RawLine[]) ?? []),
  );
  let scope = $derived(resolveScope(pins.pins, ($workspacesQuery.data?.items ?? []) as unknown as NavWorkspace[], lineIndex, projectIndex));
  let lineById = $derived(new Map(lineIndex.map((l) => [l.id, l])));
  let directProjectIds = $derived(new Set(scope.projects.map((p) => p.id)));
  let scopeUnresolved = $derived(
    (pins.lineIds().length > 0 && scope.lines.length !== pins.lineIds().length) ||
      (pins.projectIds().length > 0 && scope.projects.length !== pins.projectIds().length),
  );

  function feedParams(k: { projectIds: string[]; workspaceIds: string[] }): string {
    const p = new URLSearchParams();
    if (k.projectIds.length > 0) p.set('project_ids', k.projectIds.join(','));
    if (k.workspaceIds.length > 0) p.set('workspace_ids', k.workspaceIds.join(','));
    return p.toString();
  }
  let filterIds = $derived({ projectIds: scope.projectIds, workspaceIds: scope.workspaceIds });

  function openLine(line: NavLine) {
    void goto(lineUrl(line));
  }

  const feesOptions = toStore(() => {
    const k = { ...filterIds, unresolved: scopeUnresolved };
    return {
      queryKey: ['money-performances', { p: k.projectIds, w: k.workspaceIds }] as const,
      enabled: !k.unresolved,
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        fetchJSON<{ items: MoneyPerformance[] }>(`/api/money/performances?${feedParams(k)}`, signal),
    };
  });
  const invoicesOptions = toStore(() => {
    const k = { ...filterIds, unresolved: scopeUnresolved };
    return {
      queryKey: ['invoices', { p: k.projectIds, w: k.workspaceIds }] as const,
      enabled: !k.unresolved,
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        fetchJSON<{ items: MoneyInvoiceItem[] }>(`/api/invoices?${feedParams(k)}`, signal),
    };
  });
  const expensesOptions = toStore(() => {
    const k = { ...filterIds, unresolved: scopeUnresolved };
    return {
      queryKey: ['expenses', { p: k.projectIds, w: k.workspaceIds }] as const,
      enabled: !k.unresolved,
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        fetchJSON<{ items: ExpenseItem[] }>(`/api/expenses?${feedParams(k)}`, signal),
    };
  });
  const payersOptions = toStore(() => {
    const k = { ...filterIds, unresolved: scopeUnresolved };
    return {
      queryKey: ['money-payers', { p: k.projectIds, w: k.workspaceIds }] as const,
      enabled: !k.unresolved,
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        fetchJSON<{ items: MoneyPayer[] }>(`/api/money/payers?${feedParams(k)}`, signal),
    };
  });

  const feesQuery = createQuery(feesOptions);
  const invoicesQuery = createQuery(invoicesOptions);
  const expensesQuery = createQuery(expensesOptions);
  const payersQuery = createQuery(payersOptions);

  function feeInScope(f: MoneyPerformance): boolean {
    if (scope.isEmpty) return true;
    const ws = f.project?.workspace_id;
    if (ws && scope.workspaceIds.includes(ws)) return true;
    if (f.project && directProjectIds.has(f.project.id)) return true;
    if (f.line_id && scope.lineIds.includes(f.line_id)) return true;
    return false;
  }
  let fees = $derived(($feesQuery.data?.items ?? []).filter(feeInScope));
  let invoices = $derived($invoicesQuery.data?.items ?? []);
  let expenses = $derived($expensesQuery.data?.items ?? []);
  let payers = $derived($payersQuery.data?.items ?? []);

  // Any scoped fee's workspace issues documents → show the Documents section
  // and the per-currency invoiced column.
  let anyDocMode = $derived(
    fees.some((f) => (workspaceModeById.get(f.project?.workspace_id ?? '') ?? 'legal') !== 'off'),
  );
  function feeMode(f: MoneyPerformance): InvoicingMode {
    return workspaceModeById.get(f.project?.workspace_id ?? '') ?? 'legal';
  }

  type FeeState = 'unpaid' | 'partial' | 'full';
  function feeState(f: MoneyPerformance): FeeState {
    const fee = Number(f.fee_amount ?? 0);
    const coll = Number(f.collected ?? 0);
    if (coll <= 0) return 'unpaid';
    if (coll >= fee) return 'full';
    return 'partial';
  }
  const FEE_PILL: Record<FeeState, { tone: string; label: string }> = {
    full: { tone: 'ok', label: 'collected' },
    partial: { tone: 'warn', label: 'part-collected' },
    unpaid: { tone: 'faint', label: 'uncollected' },
  };

  // ── Per-currency truth + roll-up by line ──────────────────────────────
  type CurrencyRoll = { currency: string; confirmed: number; holds: number; expenses: number };
  type LineRoll = {
    key: string;
    name: string;
    kind: string;
    projectName: string;
    accent: string;
    line: NavLine | null;
    dates: number;
    currencies: CurrencyRoll[];
  };
  type MutableLineRoll = Omit<LineRoll, 'currencies'> & { currencies: Map<string, CurrencyRoll> };

  function ensureCurrency(map: Map<string, CurrencyRoll>, currency: string): CurrencyRoll {
    const existing = map.get(currency);
    if (existing) return existing;
    const created = { currency, confirmed: 0, holds: 0, expenses: 0 };
    map.set(currency, created);
    return created;
  }

  let feeById = $derived(new Map(fees.map((fee) => [fee.id, fee])));
  let byLine = $derived.by<LineRoll[]>(() => {
    const map = new Map<string, MutableLineRoll>();
    const ensureLine = (key: string, line: NavLine | null, projectName: string): MutableLineRoll => {
      const existing = map.get(key);
      if (existing) return existing;
      const created: MutableLineRoll = {
        key,
        name: line?.name ?? 'One-offs',
        kind: line?.kind ?? 'oneoff',
        projectName: line?.projectName ?? projectName,
        accent: line?.accent ?? 'var(--text-faint)',
        line,
        dates: 0,
        currencies: new Map(),
      };
      map.set(key, created);
      return created;
    };

    for (const fee of fees) {
      const line = (fee.line_id ? lineById.get(fee.line_id) : null) ?? null;
      const key = fee.line_id ?? `loose:${fee.project?.id ?? 'none'}`;
      const record = ensureLine(key, line, fee.project?.name ?? '—');
      if (fee.fee_amount === null) continue;
      const currency = fee.fee_currency ?? 'EUR';
      const amount = ensureCurrency(record.currencies, currency);
      if (['confirmed', 'done', 'invoiced', 'paid'].includes(fee.status)) {
        amount.confirmed += Number(fee.fee_amount);
        record.dates += 1;
      } else if (fee.status.startsWith('hold')) {
        amount.holds += Number(fee.fee_amount);
      }
    }

    for (const expense of expenses) {
      const performance = expense.performance_id ? feeById.get(expense.performance_id) : null;
      const lineId = expense.line_id ?? performance?.line_id ?? null;
      const line = (lineId ? lineById.get(lineId) : null) ?? null;
      const key = lineId ?? `loose:${performance?.project?.id ?? expense.workspace_id}`;
      const record = ensureLine(key, line, performance?.project?.name ?? 'One-offs');
      ensureCurrency(record.currencies, expense.currency).expenses += Number(expense.amount);
    }

    return [...map.values()]
      .map((record) => ({ ...record, currencies: [...record.currencies.values()].sort((a, b) => a.currency.localeCompare(b.currency)) }))
      .filter((record) => record.currencies.some((amount) => amount.confirmed || amount.holds || amount.expenses))
      .sort((a, b) => {
        const aTotal = a.currencies.reduce((sum, amount) => sum + amount.confirmed, 0);
        const bTotal = b.currencies.reduce((sum, amount) => sum + amount.confirmed, 0);
        return bTotal - aTotal;
      });
  });

  let byLineMax = $derived.by(() => {
    const max = new Map<string, number>();
    for (const line of byLine) {
      for (const amount of line.currencies) {
        max.set(amount.currency, Math.max(max.get(amount.currency) ?? 1, amount.confirmed + amount.holds));
      }
    }
    return max;
  });

  let loading = $derived($feesQuery.isLoading || $invoicesQuery.isLoading || $expensesQuery.isLoading);
  let errorMsg = $derived.by(() => {
    const error = $feesQuery.error ?? $invoicesQuery.error ?? $expensesQuery.error;
    return error instanceof Error ? error.message : '';
  });

  // Per currency: pipeline (confirmed fees) · collected (fee.collected, v3) ·
  // invoiced (issued documents, shown only where documents exist).
  let currencies = $derived([...new Set(fees.map((f) => f.fee_currency ?? 'EUR'))].sort());
  let totals = $derived.by(() => {
    const map = new Map<string, { currency: string; pipeline: number; collected: number; invoiced: number }>();
    const ensure = (currency: string) => {
      const existing = map.get(currency);
      if (existing) return existing;
      const created = { currency, pipeline: 0, collected: 0, invoiced: 0 };
      map.set(currency, created);
      return created;
    };
    for (const fee of fees) {
      if (fee.fee_amount === null) continue;
      const cur = fee.fee_currency ?? 'EUR';
      if (fee.status === 'confirmed' || fee.status === 'done') ensure(cur).pipeline += Number(fee.fee_amount);
      ensure(cur).collected += Number(fee.collected ?? 0);
    }
    for (const invoice of invoices) {
      if (invoice.status === 'issued' || invoice.status === 'paid') ensure(invoice.currency).invoiced += Number(invoice.total);
    }
    return [...map.values()].sort((a, b) => a.currency.localeCompare(b.currency));
  });

  let expenseTotals = $derived.by(() => {
    const map = new Map<string, number>();
    for (const expense of expenses) map.set(expense.currency, (map.get(expense.currency) ?? 0) + Number(expense.amount));
    return [...map.entries()].sort(([a], [b]) => a.localeCompare(b));
  });

  function perfHref(f: MoneyPerformance): string | null {
    if (!f.slug || !f.project) return null;
    const ws = workspaceSlugById.get(f.project.workspace_id) ?? defaultWorkspaceSlug;
    return `/h/${ws}/performance/${f.slug}`;
  }

  const queryClient = useQueryClient();

  // ── Fee editor (ADR-043) ──────────────────────────────────────────────
  let feeOpen = $state(false);
  let feeEditing = $state<MoneyPerformance | null>(null);
  let fAmount = $state('');
  let fCurrency = $state('EUR');
  function openFee(f: MoneyPerformance) {
    feeEditing = f;
    fAmount = f.fee_amount === null ? '' : String(f.fee_amount);
    fCurrency = f.fee_currency ?? 'EUR';
    feeOpen = true;
  }
  const feeMutation = createMutation({
    mutationFn: async (input: { id: string; fee_amount: number | null; fee_currency: string }) => {
      const body = await mutateJSON<{ performance?: unknown }>('PATCH', `/api/money/performances/${input.id}`, {
        fee_amount: input.fee_amount,
        fee_currency: input.fee_currency,
      });
      if (!body?.performance) throw new Error('Unexpected response');
      return body.performance;
    },
    onSuccess: () => {
      feeOpen = false;
      feeEditing = null;
      void queryClient.invalidateQueries({ queryKey: ['money-performances'] });
    },
    onError: (err) => addToast({ tone: 'danger', title: 'Fee not saved', message: `${err instanceof Error ? err.message : 'Unexpected error'} — try again.` }),
  });
  function saveFee() {
    if (!feeEditing) return;
    const trimmed = String(fAmount ?? '').trim();
    const amount = trimmed === '' ? null : Number(trimmed);
    if (amount !== null && (Number.isNaN(amount) || amount < 0)) {
      addToast({ tone: 'warning', message: 'Fee must be a positive number (or empty to clear).' });
      return;
    }
    $feeMutation.mutate({ id: feeEditing.id, fee_amount: amount, fee_currency: fCurrency });
  }

  // ── Record payment — anchored to the gig's fee (ADR-086 D3) ────────────
  let payOpen = $state(false);
  let payFee = $state<MoneyPerformance | null>(null);
  let payAmount = $state('');
  let payReceivedOn = $state('');
  let payMethod = $state<string>('transfer');
  let payCounterparty = $state('');
  let payCategory = $state('');
  let payReference = $state('');
  function todayIso(): string {
    return new Date().toISOString().slice(0, 10);
  }
  function openPay(f: MoneyPerformance) {
    payFee = f;
    const remaining = Math.max(0, Number(f.fee_amount ?? 0) - Number(f.collected ?? 0));
    payAmount = remaining ? remaining.toFixed(2) : '';
    payReceivedOn = todayIso();
    payMethod = 'transfer';
    payCounterparty = '';
    payCategory = '';
    payReference = '';
    payOpen = true;
  }
  const payMutation = createMutation({
    mutationFn: async () => {
      const amount = Number(String(payAmount).trim());
      if (!Number.isFinite(amount) || amount <= 0) throw new Error('Amount must be greater than zero');
      const body = await mutateJSON<{ payment?: unknown }>('POST', '/api/payments', {
        amount,
        received_on: payReceivedOn || todayIso(),
        method: payMethod,
        performance_id: payFee!.id,
        counterparty: payCounterparty.trim() || null,
        category: payCategory.trim() || null,
        reference: payReference.trim() || null,
      });
      if (!body?.payment) throw new Error('Unexpected response');
      return body.payment;
    },
    onSuccess: () => {
      payOpen = false;
      payFee = null;
      void queryClient.invalidateQueries({ queryKey: ['money-performances'] });
      addToast({ tone: 'success', message: 'Payment recorded against the fee.' });
    },
    onError: (err) => addToast({ tone: 'danger', title: 'Payment not recorded', message: err instanceof Error ? err.message : 'Unexpected error' }),
  });

  // ── Invoice creation (ADR-050) — doc_type driven by workspace mode ─────
  let invOpen = $state(false);
  let invPerf = $state<MoneyPerformance | null>(null);
  let iVat = $state('');
  let iIrpf = $state('');
  let iDueOn = $state('');
  let iExpectedOn = $state('');
  let iPaymentCondition = $state('');
  let iPayerId = $state('');
  let availablePayers = $derived(
    invPerf?.project ? payers.filter((payer) => payer.workspace_id === invPerf?.project?.workspace_id) : [],
  );
  let invDocType = $derived(invPerf ? (feeMode(invPerf) === 'interno' ? 'proforma' : 'factura') : 'factura');
  function openInvoice(f: MoneyPerformance) {
    invPerf = f;
    iVat = '';
    iIrpf = '';
    iDueOn = '';
    iExpectedOn = '';
    iPaymentCondition = '';
    iPayerId = '';
    invOpen = true;
  }
  function pctOrNull(raw: unknown): number | null {
    const s = String(raw ?? '').trim();
    if (s === '') return null;
    return Number(s);
  }
  let invTotal = $derived.by(() => {
    const fee = invPerf?.fee_amount ?? 0;
    const vat = pctOrNull(iVat);
    const irpf = pctOrNull(iIrpf);
    const vatAmt = vat === null ? 0 : Math.round(fee * vat) / 100;
    const irpfAmt = irpf === null ? 0 : Math.round(fee * irpf) / 100;
    return fee + vatAmt - irpfAmt;
  });
  const createInvoice = createMutation({
    mutationFn: async () => {
      const body = await mutateJSON<{ invoice?: unknown }>('POST', '/api/invoices', {
        performance_id: invPerf!.id,
        vat_pct: pctOrNull(iVat),
        irpf_pct: pctOrNull(iIrpf),
        due_on: iDueOn || null,
        expected_on: iExpectedOn || null,
        payment_condition: iPaymentCondition.trim() || null,
        payer_person_id: iPayerId || null,
        doc_type: invDocType,
      });
      if (!body?.invoice) throw new Error('Unexpected response');
      return body.invoice;
    },
    onSuccess: () => {
      invOpen = false;
      invPerf = null;
      void queryClient.invalidateQueries({ queryKey: ['invoices'] });
      addToast({ tone: 'success', message: `Draft ${invDocType} created.` });
    },
    onError: (err) => addToast({ tone: 'danger', title: 'Document not created', message: err instanceof Error ? err.message : 'Unexpected error' }),
  });
  function submitInvoice() {
    for (const p of [pctOrNull(iVat), pctOrNull(iIrpf)]) {
      if (p !== null && (Number.isNaN(p) || p < 0 || p > 100)) {
        addToast({ tone: 'warning', message: 'VAT / IRPF must be a percentage 0–100 (or empty).' });
        return;
      }
    }
    $createInvoice.mutate();
  }

  // ── Add expense (money out) — with counterparty (ADR-086 D4) ───────────
  let expOpen = $state(false);
  let eAmount = $state('');
  let eCurrency = $state('EUR');
  let eDescription = $state('');
  let eCategory = $state<string>('other');
  let eIncurredOn = $state('');
  let eCounterparty = $state('');
  let eAnchor = $state('');
  // Anchor an expense to a whole line OR an individual gig (ADR-086 D4). The
  // value encodes which: line:<id> | gig:<id>.
  let expenseAnchorOptions = $derived([
    ...byLine
      .filter((l) => l.line)
      .map((l) => ({ value: `line:${l.line!.id}`, label: `Line · ${l.name} — ${l.projectName}` })),
    ...fees.map((f) => ({
      value: `gig:${f.id}`,
      label: `Gig · ${[f.venue_name, f.city].filter(Boolean).join(', ') || f.project?.name || '—'} — ${dayLabel(f.performed_at)}`,
    })),
  ]);
  function openExpense() {
    eAmount = '';
    eCurrency = currencies[0] ?? 'EUR';
    eDescription = '';
    eCategory = 'other';
    eIncurredOn = todayIso();
    eCounterparty = '';
    eAnchor = expenseAnchorOptions[0]?.value ?? '';
    expOpen = true;
  }
  const createExpense = createMutation({
    mutationFn: async () => {
      const amount = Number(String(eAmount).trim());
      if (!Number.isFinite(amount) || amount <= 0) throw new Error('Amount must be greater than zero');
      if (!eAnchor) throw new Error('Pick a line or gig to anchor the expense');
      const [kind, id] = eAnchor.split(':');
      const body = await mutateJSON<{ expense?: unknown }>('POST', '/api/expenses', {
        ...(kind === 'gig' ? { performance_id: id } : { line_id: id }),
        category: eCategory,
        description: eDescription.trim() || 'Expense',
        amount,
        currency: eCurrency,
        incurred_on: eIncurredOn || null,
        counterparty: eCounterparty.trim() || null,
      });
      if (!body?.expense) throw new Error('Unexpected response');
      return body.expense;
    },
    onSuccess: () => {
      expOpen = false;
      void queryClient.invalidateQueries({ queryKey: ['expenses'] });
      addToast({ tone: 'success', message: 'Expense added.' });
    },
    onError: (err) => addToast({ tone: 'danger', title: 'Expense not added', message: err instanceof Error ? err.message : 'Unexpected error' }),
  });
</script>

<svelte:head>
  <title>Money — Hour</title>
</svelte:head>

<section class="mny">
  <header class="mny__head">
    <div class="mny__toprow">
      <p class="eyebrow">Money</p>
      <LensSwitcher />
    </div>
    <div class="mny__totals">
      {#each totals as total (total.currency)}
        <span class="mny__currency-total">
          <span class="mny__currency">{total.currency}</span>
          <span class="mny__total"><span class="mny__total-label">pipeline</span>{fmtMoney(total.pipeline)}</span>
          <span class="mny__total"><span class="mny__total-label">collected</span>{fmtMoney(total.collected)}</span>
          {#if anyDocMode}
            <span class="mny__total mny__total--soft"><span class="mny__total-label">invoiced</span>{fmtMoney(total.invoiced)}</span>
          {/if}
        </span>
      {/each}
      <span class="mny__total-note">current pins · currencies kept separate</span>
    </div>
  </header>

  {#if errorMsg}
    <p class="mny__state mny__state--danger">{errorMsg}</p>
  {:else if loading}
    <p class="mny__state">Loading…</p>
  {:else}
    {#if byLine.length > 0}
      <section class="mny__section" aria-label="By line">
        <p class="eyebrow">By line</p>
        <div class="mline-list">
          {#each byLine as l (l.key)}
            <button type="button" class="mline" style={`--c: ${l.accent}`} onclick={() => l.line && openLine(l.line)} disabled={!l.line}>
              <span class="mline__top">
                <span class="mline__glyph">{lineKindGlyph(l.kind)}</span>
                <span class="mline__name">{l.name}</span>
                <span class="mline__co">{l.projectName}</span>
              </span>
              {#each l.currencies as amount (amount.currency)}
                <span class="mline__money">
                  <span class="mline__amt">{fmtMoney(amount.confirmed)} {amount.currency}</span>
                  {#if amount.expenses > 0}
                    <span class="mline__expense">− {fmtMoney(amount.expenses)} expenses</span>
                    <span class="mline__net">net {fmtMoney(amount.confirmed - amount.expenses)}</span>
                  {/if}
                </span>
                <span class="mline__bar">
                  <span class="mline__fill" style={`inline-size: ${((amount.confirmed + amount.holds) / (byLineMax.get(amount.currency) ?? 1)) * 100}%`}>
                    <span class="mline__fillc" style={`inline-size: ${amount.confirmed + amount.holds ? (amount.confirmed / (amount.confirmed + amount.holds)) * 100 : 0}%`}></span>
                  </span>
                </span>
              {/each}
              <span class="mline__meta">
                <span>{l.dates} confirmed {l.dates === 1 ? 'date' : 'dates'}</span>
                {#if l.line}<span class="mline__go">Open line →</span>{/if}
              </span>
            </button>
          {/each}
        </div>
      </section>
    {/if}

    <section class="mny__section" aria-label="Fees">
      <div class="mny__section-head">
        <p class="eyebrow">Fees</p>
        <span class="mny__section-r">{fees.length} {fees.length === 1 ? 'gig' : 'gigs'}{currencies.length ? ` · ${currencies.join(' · ')}` : ''}</span>
      </div>
      {#if fees.length === 0}
        <p class="mny__state">No performances in the current pins.</p>
      {:else}
        <div class="fees">
          {#each fees as f (f.id)}
            {@const st = feeState(f)}
            {@const fee = Number(f.fee_amount ?? 0)}
            {@const coll = Number(f.collected ?? 0)}
            {@const rem = fee - coll}
            {@const cp = fee > 0 ? Math.min(100, Math.round((coll / fee) * 100)) : 0}
            {@const mode = feeMode(f)}
            <div class="fee" data-st={f.fee_amount === null ? 'none' : st}>
              <div class="fee__top">
                <span class="fee__date">{dayLabel(f.performed_at)}</span>
                <span class="fee__where">
                  {#if perfHref(f)}
                    <a class="fee__venue-main" href={perfHref(f)}>{f.venue_name || '—'}{#if f.city}<span class="fee__city"> · {f.city}</span>{/if}</a>
                  {:else}
                    <span class="fee__venue-main">{f.venue_name || '—'}{#if f.city}<span class="fee__city"> · {f.city}</span>{/if}</span>
                  {/if}
                  <span class="fee__proj-sub">{f.project?.name ?? '—'}</span>
                </span>
                <span class="fee__badge"><StateBadge label={performanceStatusLabel(f.status)} tone={performanceStatusTone(f.status)} /></span>
                <span class="fee__amt">
                  <button type="button" class="fee__fee" title="Edit fee" onclick={() => openFee(f)}>{fmtFee(f.fee_amount, f.fee_currency)}</button>
                  {#if f.fee_amount !== null}<span class="pill" data-tone={FEE_PILL[st].tone}>{FEE_PILL[st].label}</span>{/if}
                </span>
              </div>
              {#if f.fee_amount !== null}
                <div class="fee__bar"><span class="fee__coll" style={`inline-size:${cp}%`}></span></div>
                <div class="fee__foot">
                  <span class="fee__collected">collected {fmtMoney(coll)} / {fmtMoney(fee)}{#if rem > 0} · <span class="fee__rem">{fmtMoney(rem)} left</span>{/if}</span>
                  <span class="fee__acts">
                    <Button size="xs" variant="outline" onclick={() => openPay(f)}>Record payment</Button>
                    {#if mode !== 'off'}
                      <Button size="xs" variant="outline" onclick={() => openInvoice(f)}>{mode === 'interno' ? 'Create proforma' : 'Create invoice'}</Button>
                    {/if}
                  </span>
                </div>
              {/if}
            </div>
          {/each}
        </div>
      {/if}
    </section>

    {#if anyDocMode}
      <section class="mny__section" aria-label="Documents">
        <p class="eyebrow">Documents</p>
        <MoneyInvoices {invoices} />
      </section>
    {/if}

    <section class="mny__section" aria-label="Expenses">
      <div class="mny__section-head">
        <p class="eyebrow">Expenses</p>
        <div class="mny__section-headr">
          {#if expenseTotals.length > 0}
            <p class="mny__expense-totals">
              {#each expenseTotals as [currency, amount] (currency)}<span>− {fmtMoney(amount)} {currency}</span>{/each}
            </p>
          {/if}
          <Button size="xs" variant="outline" onclick={openExpense} disabled={expenseAnchorOptions.length === 0}>Add expense</Button>
        </div>
      </div>
      {#if expenses.length === 0}
        <p class="mny__state">No expenses in the current scope.</p>
      {:else}
        <ul class="mny__expenses" role="list">
          {#each expenses as expense (expense.id)}
            <li>
              <span class="mny__cell-date">{dayLabel(expense.incurred_on)}</span>
              <span class="mny__expense-description"><b>{expense.description}</b>{#if expense.counterparty}<span class="mny__expense-counter"> · {expense.counterparty}</span>{/if}</span>
              <span class="mny__expense-category">{categoryLabel(expense.category)}</span>
              <strong>− {fmtMoney(expense.amount)} {expense.currency}</strong>
            </li>
          {/each}
        </ul>
      {/if}
    </section>
  {/if}
</section>

<Dialog bind:open={feeOpen} title="Fee" size="s" onclose={() => (feeEditing = null)}>
  {#if feeEditing}
    <p class="mny__dialog-who">{feeEditing.project?.name ?? ''} — {[feeEditing.venue_name, feeEditing.city].filter(Boolean).join(', ')} · {dayLabel(feeEditing.performed_at)}</p>
  {/if}
  <div class="mny__fee-form">
    <Input label="Amount" type="number" bind:value={fAmount} placeholder="Empty clears the fee" />
    <Input label="Currency" bind:value={fCurrency} placeholder="EUR" />
  </div>
  {#snippet actions()}
    <Button variant="outline" onclick={() => (feeOpen = false)}>Cancel</Button>
    <Button onclick={saveFee} loading={$feeMutation.isPending}>Save</Button>
  {/snippet}
</Dialog>

<Dialog bind:open={payOpen} title="Record payment" size="s" description={payFee ? `${[payFee.venue_name, payFee.city].filter(Boolean).join(', ')} · ${dayLabel(payFee.performed_at)}` : ''} onclose={() => (payFee = null)}>
  <div class="mny__pay-form">
    <div class="mny__row2">
      <Input label={`Amount (${payFee?.fee_currency ?? 'EUR'})`} type="number" bind:value={payAmount} />
      <Input label="Received on" type="date" bind:value={payReceivedOn} />
    </div>
    <div class="mny__row2">
      <Select label="Method" bind:value={payMethod} options={PAYMENT_METHODS.map((m) => ({ value: m, label: PAYMENT_METHOD_LABELS[m] ?? m }))} />
      <Input label="Counterparty (who paid)" bind:value={payCounterparty} placeholder="e.g. Teatre Municipal" />
    </div>
    <Input label="Reference (optional)" bind:value={payReference} placeholder="Transfer no., concept…" />
  </div>
  <p class="mny__dialog-note">Collected derives from payments against the fee — not from a document.</p>
  {#snippet actions()}
    <Button variant="outline" onclick={() => (payOpen = false)}>Cancel</Button>
    <Button onclick={() => $payMutation.mutate()} loading={$payMutation.isPending}>Record</Button>
  {/snippet}
</Dialog>

<Dialog bind:open={invOpen} title={invDocType === 'proforma' ? 'New proforma' : 'New invoice'} size="m" onclose={() => (invPerf = null)}>
  {#if invPerf}
    <p class="mny__dialog-who">{invPerf.project?.name ?? ''} — {[invPerf.venue_name, invPerf.city].filter(Boolean).join(', ')} · {dayLabel(invPerf.performed_at)}</p>
    <p class="mny__inv-fee-line">Fee (subtotal): <strong>{fmtFee(invPerf.fee_amount, invPerf.fee_currency)}</strong> — amounts snapshot the fee at creation.</p>
    <div class="mny__inv-form">
      <Input label="VAT %" type="number" bind:value={iVat} placeholder="e.g. 21 — empty = none" />
      <Input label="IRPF %" type="number" bind:value={iIrpf} placeholder="e.g. 15 — empty = none" />
      <Input label="Due on" type="date" bind:value={iDueOn} />
      <Input label="Expected collection" type="date" bind:value={iExpectedOn} />
      <Select label="Payer" bind:value={iPayerId}>
        <option value="">Use the linked conversation</option>
        {#each availablePayers as payer (payer.id)}
          <option value={payer.id}>{payer.organization_name ? `${payer.organization_name} · ${payer.full_name}` : payer.full_name}</option>
        {/each}
      </Select>
    </div>
    <Input label="Payment condition" bind:value={iPaymentCondition} placeholder="e.g. pays when the town hall pays them — says October" />
    <p class="mny__inv-total-preview">Total: <strong>{fmtMoney(invTotal)} {invPerf.fee_currency ?? 'EUR'}</strong></p>
  {/if}
  {#snippet actions()}
    <Button variant="outline" onclick={() => (invOpen = false)}>Cancel</Button>
    <Button onclick={submitInvoice} loading={$createInvoice.isPending}>Create draft</Button>
  {/snippet}
</Dialog>

<Dialog bind:open={expOpen} title="Add expense" size="s" description="Money out · anchored to a line or a gig">
  <div class="mny__pay-form">
    <div class="mny__row2">
      <Input label="Amount" type="number" bind:value={eAmount} />
      <Input label="Currency" bind:value={eCurrency} placeholder="EUR" />
    </div>
    <Input label="Description" bind:value={eDescription} placeholder="e.g. Van rental" />
    <div class="mny__row2">
      <Input label="Date" type="date" bind:value={eIncurredOn} />
      <Select label="Category" bind:value={eCategory} options={EXPENSE_CATEGORIES.map((c) => ({ value: c, label: categoryLabel(c) }))} />
    </div>
    <Select label="Anchor (line or gig)" bind:value={eAnchor} options={expenseAnchorOptions} />
    <Input label="Counterparty (optional — who's paid)" bind:value={eCounterparty} placeholder="e.g. Rent-a-Car Vic" />
  </div>
  {#snippet actions()}
    <Button variant="outline" onclick={() => (expOpen = false)}>Cancel</Button>
    <Button onclick={() => $createExpense.mutate()} loading={$createExpense.isPending}>Add</Button>
  {/snippet}
</Dialog>

<style>
  @layer components {
    .mny { display: flex; flex-direction: column; gap: var(--space-l); }
    .mny__head { display: flex; flex-direction: column; gap: var(--space-s); }
    .mny__toprow { display: flex; align-items: center; justify-content: space-between; gap: var(--space-m); }
    .mny__totals { display: flex; align-items: end; gap: var(--space-m); flex-wrap: wrap; }
    .mny__currency-total {
      display: grid; grid-template-columns: auto repeat(3, minmax(7rem, auto));
      gap: var(--space-s) var(--space-m); align-items: baseline;
      padding: var(--space-s) var(--space-m); border: 1px solid var(--border-color-light);
      border-radius: var(--radius-m); background: color-mix(in oklch, var(--bg-light) 55%, transparent);
    }
    .mny__currency { font-family: var(--font-mono); font-size: var(--text-xs); color: var(--text-muted); letter-spacing: 0.08em; }
    .mny__total { font-family: var(--font-display); font-size: var(--text-l); color: var(--text-color); display: flex; align-items: baseline; gap: var(--space-xs); }
    .mny__total--soft { color: var(--text-muted); }
    .mny__total-label { font-family: var(--font-mono); font-size: var(--text-xs); letter-spacing: 0.08em; text-transform: uppercase; color: var(--text-faint); }
    .mny__total-note { font-size: var(--text-xs); color: var(--text-faint); }
    .mny__state { font-size: var(--text-s); color: var(--text-faint); }
    .mny__state--danger { color: var(--danger); }
    .mny__section { display: flex; flex-direction: column; gap: var(--space-s); }
    .mny__section-head { display: flex; align-items: baseline; justify-content: space-between; gap: var(--space-m); }
    .mny__section-headr { display: flex; align-items: center; gap: var(--space-m); }
    .mny__section-r { font-family: var(--font-mono); font-size: var(--text-xs); color: var(--text-faint); }

    /* ── by-line rollup ── */
    .mline-list { display: flex; flex-direction: column; }
    .mline { display: block; inline-size: 100%; text-align: start; border: 0; background: none; border-block-end: 1px solid var(--border-color-light); padding-block: var(--space-m); padding-inline: var(--space-xs); cursor: pointer; font-family: inherit; }
    .mline:disabled { cursor: default; }
    .mline:hover:not(:disabled) { background: var(--bg-light); }
    .mline__top { display: flex; align-items: center; gap: var(--space-s); }
    .mline__glyph { color: var(--c); font-size: var(--text-m); }
    .mline__name { font-size: var(--text-m); font-weight: 500; color: var(--text-color); }
    .mline__co { font-size: var(--text-xs); color: var(--text-faint); }
    .mline__amt { font-family: var(--font-mono); font-size: var(--text-l); color: var(--text-color); font-variant-numeric: tabular-nums; }
    .mline__money { display: flex; align-items: baseline; justify-content: flex-end; gap: var(--space-s); margin-block-start: var(--space-xs); font-size: var(--text-xs); color: var(--text-faint); }
    .mline__expense { color: var(--text-muted); }
    .mline__net { font-family: var(--font-mono); color: var(--text-color); font-variant-numeric: tabular-nums; }
    .mline__bar { display: block; block-size: 0.45rem; border-radius: var(--radius-circle); background: var(--bg-light); margin-block: var(--space-s) var(--space-xs); overflow: hidden; }
    .mline__fill { display: block; block-size: 100%; border-radius: var(--radius-circle); background: color-mix(in oklch, var(--c) 32%, var(--bg-light)); position: relative; }
    .mline__fillc { position: absolute; inset-block: 0; inset-inline-start: 0; block-size: 100%; border-radius: var(--radius-circle); background: var(--c); }
    .mline__meta { display: flex; align-items: center; gap: var(--space-m); font-size: var(--text-xs); color: var(--text-muted); }
    .mline__go { margin-inline-start: auto; color: var(--text-muted); }

    /* ── fee anchor cards (v3) ── */
    .fees { display: flex; flex-direction: column; gap: var(--space-s); }
    .fee {
      padding: var(--space-m); border: 1px solid var(--border-color-dark);
      border-inline-start-width: 3px; border-radius: var(--radius-l); background: var(--bg-ultra-light);
    }
    .fee:hover { border-color: var(--text-faint); }
    .fee[data-st='full'] { border-inline-start-color: var(--success); }
    .fee[data-st='partial'] { border-inline-start-color: var(--warning); }
    .fee[data-st='unpaid'], .fee[data-st='none'] { border-inline-start-color: var(--border-color-dark); }
    .fee__top { display: grid; grid-template-columns: auto 1fr auto auto; align-items: baseline; gap: var(--space-m); }
    .fee__date { font-family: var(--font-mono); font-size: var(--text-xs); color: var(--text-muted); white-space: nowrap; }
    .fee__where { min-inline-size: 0; }
    .fee__venue-main { font-size: var(--text-m); font-weight: 500; color: var(--text-color); text-decoration: none; }
    .fee__venue-main:hover { text-decoration: underline; }
    .fee__city { color: var(--text-muted); font-weight: 400; }
    .fee__proj-sub { display: block; font-size: var(--text-xs); color: var(--text-muted); }
    .fee__amt { text-align: end; display: flex; flex-direction: column; align-items: flex-end; gap: 4px; }
    .fee__fee { font-family: var(--font-mono); font-size: var(--text-m); color: var(--text-color); font-variant-numeric: tabular-nums; }
    .fee__fee:hover { text-decoration: underline; }
    .pill {
      display: inline-block; font-family: var(--font-mono); font-size: var(--text-xs); letter-spacing: 0.04em;
      text-transform: lowercase; padding: 2px 8px; border-radius: var(--radius-circle);
      border: 1px solid var(--border-color-dark); color: var(--text-muted); white-space: nowrap;
    }
    .pill[data-tone='ok'] { color: var(--success); border-color: color-mix(in oklch, var(--success) 42%, var(--border-color-light)); }
    .pill[data-tone='warn'] { color: var(--warning); border-color: color-mix(in oklch, var(--warning) 42%, var(--border-color-light)); }
    .pill[data-tone='faint'] { color: var(--text-faint); }
    .fee__bar { block-size: 6px; border-radius: var(--radius-circle); background: var(--bg-light); margin-block: var(--space-m) var(--space-s); overflow: hidden; }
    .fee__coll { display: block; block-size: 100%; border-radius: var(--radius-circle); background: var(--success); }
    .fee__foot { display: flex; align-items: center; gap: var(--space-m); padding-block-start: var(--space-s); border-block-start: 1px solid var(--border-color-light); flex-wrap: wrap; }
    .fee__collected { font-family: var(--font-mono); font-size: var(--text-xs); color: var(--text-muted); font-variant-numeric: tabular-nums; }
    .fee__rem { color: var(--text-faint); }
    .fee__acts { margin-inline-start: auto; display: flex; gap: var(--space-xs); align-items: center; }

    .mny__expense-totals { display: flex; flex-wrap: wrap; gap: var(--space-m); font-family: var(--font-mono); font-size: var(--text-xs); color: var(--text-muted); }
    .mny__expenses { display: flex; flex-direction: column; }
    .mny__expenses li { display: grid; grid-template-columns: minmax(8rem, 0.8fr) minmax(12rem, 2fr) minmax(6rem, 0.7fr) auto; gap: var(--space-m); align-items: baseline; padding: var(--space-xs); border-block-end: 1px solid var(--border-color-light); font-size: var(--text-s); }
    .mny__expenses strong { font-family: var(--font-mono); font-size: var(--text-xs); font-weight: 500; font-variant-numeric: tabular-nums; white-space: nowrap; color: var(--danger); }
    .mny__expense-category { color: var(--text-faint); font-family: var(--font-mono); font-size: var(--text-xs); text-transform: lowercase; }
    .mny__expense-description { color: var(--text-color); }
    .mny__expense-counter { color: var(--text-muted); }
    .mny__cell-date { font-family: var(--font-mono); font-size: var(--text-xs); color: var(--text-muted); white-space: nowrap; }

    .mny__dialog-who { font-size: var(--text-s); color: var(--text-muted); }
    .mny__dialog-note { font-size: var(--text-xs); color: var(--text-faint); margin-block-start: var(--space-s); }
    .mny__fee-form { display: grid; grid-template-columns: 2fr 1fr; gap: var(--space-m); margin-block-start: var(--space-s); }
    .mny__pay-form { display: flex; flex-direction: column; gap: var(--space-m); }
    .mny__row2 { display: grid; grid-template-columns: 1fr 1fr; gap: var(--space-m); }
    .mny__inv-fee-line { font-size: var(--text-s); color: var(--text-muted); margin-block-start: var(--space-xs); }
    .mny__inv-form { display: grid; grid-template-columns: repeat(auto-fit, minmax(9rem, 1fr)); gap: var(--space-s) var(--space-m); margin-block: var(--space-s); }
    .mny__inv-total-preview { font-size: var(--text-s); margin-block-start: var(--space-s); }

    @media (max-width: 760px) {
      .mny__toprow { align-items: start; }
      .mny__currency-total { inline-size: 100%; grid-template-columns: auto 1fr; }
      .mny__currency { grid-column: 1 / -1; }
      .mny__total { justify-content: space-between; }
      .mny__total-note { inline-size: 100%; }
      .mline__top { flex-wrap: wrap; }
      .mline__money { justify-content: flex-start; flex-wrap: wrap; }
      .fee__top { grid-template-columns: 1fr auto; }
      .fee__date, .fee__badge { grid-column: 1 / -1; }
      .mny__expenses li { grid-template-columns: 1fr auto; gap: var(--space-2xs) var(--space-s); }
      .mny__expense-description { grid-column: 1 / -1; }
      .mny__expenses strong { grid-column: 2; grid-row: 1; }
      .mny__row2, .mny__inv-form, .mny__fee-form { grid-template-columns: 1fr; }
    }
  }
</style>
