<script lang="ts">
  /**
   * Money lens v3 (ADR-086 + ADR-087). The BOLO (the deal with a venue) is the
   * money unit: its fee is the anchor, "collected" derives from payments-against
   * -fee (list_money_bolos.collected), cobrar and facturar are independent.
   * Layout: a general position on top (per currency: pipeline · collected ·
   * pending), then bolos grouped BY OBRA (project, never by line) with per-obra
   * contratado · cobrado · pendiente, the document living on the bolo (a chip),
   * and the functions as a sub-detail count. Filter = sidebar pins (ADR-038).
   *
   * Reads are money-gated (fees NULLed without read:money). Fee editing lives
   * here by design (ADR-043). Payment is decoupled from the invoice: recording
   * one anchors to the deal and moves its collected state, with or without a
   * document.
   */

  import { createMutation, createQuery, useQueryClient } from '@tanstack/svelte-query';
  import { toStore } from 'svelte/store';
  import { fetchJSON, mutateJSON } from '$lib/api';
  import Button from '$lib/components/Button.svelte';
  import MoneyInvoices from '$lib/components/MoneyInvoices.svelte';
  import LensHeader from '$lib/components/LensHeader.svelte';
  import LensTitle from '$lib/components/LensTitle.svelte';
  import Dialog from '$lib/components/Dialog.svelte';
  import Input from '$lib/components/Input.svelte';
  import Select from '$lib/components/Select.svelte';
  import StateBadge from '$lib/components/StateBadge.svelte';
  import { addToast } from '$lib/components/Toast.svelte';
  import { dayLabel, localDayISO } from '$lib/datetime';
  import { categoryLabel, EXPENSE_CATEGORIES, type ExpenseItem } from '$lib/expense';
  import {
    agingState,
    applyTaxLines,
    boloStatusLabel,
    esTaxLines,
    fmtFee,
    fmtMoney,
    observedPayerTermsDays,
    invoiceStatusLabel,
    PAYMENT_METHODS,
    paymentMethodLabel,
    totalsByCurrency,
    type MoneyInvoiceItem,
    type MoneyPayer,
  } from '$lib/money';
  import { detectLocale, t } from '$lib/i18n';
  import { performanceStatusTone } from '$lib/performance';
  import { usePins } from '$lib/stores/pins.svelte';
  import {
    buildLineIndex,
    buildProjectIndex,
    resolveScope,
    type NavLine,
    type NavWorkspace,
    type RawLine,
  } from '$lib/nav';
  import { activeProjectsQueryOptions, allLinesQueryOptions } from '$lib/nav-queries';
  import { spaceName } from '$lib/utils/identity';
  import { goto, replaceState } from '$app/navigation';

  type InvoicingMode = 'off' | 'interno' | 'legal';
  type WorkspaceLite = { id: string; slug: string; invoicing_mode: InvoicingMode | null };

  type MoneyBolo = {
    id: string;
    project_id: string;
    line_id: string | null;
    conversation_id: string | null;
    venue_name: string | null;
    city: string | null;
    country: string | null;
    fee_amount: number | null;
    fee_currency: string | null;
    status: string;
    collected: number;
    function_count: number;
    next_performed_at: string | null;
    project: { id: string; slug: string; name: string; accent: string | null; workspace_id: string } | null;
  };

  const CONTRACTED = ['confirmed', 'done', 'invoiced', 'paid'];

  const pins = usePins();
  const locale = detectLocale(navigator.language);

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

  function openProject(projectSlug: string, workspaceId: string) {
    const ws = workspaceSlugById.get(workspaceId) ?? defaultWorkspaceSlug;
    void goto(`/h/${ws}/project/${projectSlug}/`);
  }

  const bolosOptions = toStore(() => {
    const k = { ...filterIds, unresolved: scopeUnresolved };
    return {
      queryKey: ['money-bolos', { p: k.projectIds, w: k.workspaceIds }] as const,
      enabled: !k.unresolved,
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        fetchJSON<{ items: MoneyBolo[] }>(`/api/money/bolos?${feedParams(k)}`, signal),
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

  const bolosQuery = createQuery(bolosOptions);
  const invoicesQuery = createQuery(invoicesOptions);
  const expensesQuery = createQuery(expensesOptions);
  const payersQuery = createQuery(payersOptions);

  function boloInScope(b: MoneyBolo): boolean {
    if (scope.isEmpty) return true;
    const ws = b.project?.workspace_id;
    if (ws && scope.workspaceIds.includes(ws)) return true;
    if (b.project && directProjectIds.has(b.project.id)) return true;
    if (b.line_id && scope.lineIds.includes(b.line_id)) return true;
    return false;
  }
  let bolos = $derived(($bolosQuery.data?.items ?? []).filter(boloInScope));
  let invoices = $derived($invoicesQuery.data?.items ?? []);
  let expenses = $derived($expensesQuery.data?.items ?? []);
  let payers = $derived($payersQuery.data?.items ?? []);

  let boloById = $derived(new Map(bolos.map((b) => [b.id, b])));
  // A line's project, learned from the bolos on it — enough to attribute a
  // line-anchored expense to an obra header.
  let lineToProjectId = $derived(
    new Map(bolos.filter((b) => b.line_id).map((b) => [b.line_id as string, b.project_id])),
  );

  // Documents live on the bolo: map each invoice to the bolo its line references.
  // Rank so the card's chip + net read the LIVE document (issued > paid > draft >
  // cancelled), newest first — not raw API order (which floats a new draft first).
  const DOC_RANK = (s: string) => (s === 'issued' ? 0 : s === 'paid' ? 1 : s === 'draft' ? 2 : 3);
  let invoicesByBolo = $derived.by(() => {
    const map = new Map<string, MoneyInvoiceItem[]>();
    for (const inv of invoices) {
      for (const l of inv.lines) {
        if (!l.bolo_id) continue;
        const bucket = map.get(l.bolo_id) ?? [];
        bucket.push(inv);
        map.set(l.bolo_id, bucket);
      }
    }
    for (const bucket of map.values()) {
      bucket.sort(
        (a, b) => DOC_RANK(a.status) - DOC_RANK(b.status) || (b.issued_on ?? '').localeCompare(a.issued_on ?? ''),
      );
    }
    return map;
  });

  // Any scoped bolo's workspace issues documents → show the Documents section
  // and the per-currency invoiced column.
  let anyDocMode = $derived(
    bolos.some((b) => (workspaceModeById.get(b.project?.workspace_id ?? '') ?? 'legal') !== 'off'),
  );
  function boloMode(b: MoneyBolo): InvoicingMode {
    return workspaceModeById.get(b.project?.workspace_id ?? '') ?? 'legal';
  }

  type FeeState = 'unpaid' | 'partial' | 'full';
  function feeState(b: MoneyBolo): FeeState {
    const fee = Number(b.fee_amount ?? 0);
    const coll = Number(b.collected ?? 0);
    if (coll <= 0) return 'unpaid';
    if (coll >= fee) return 'full';
    return 'partial';
  }
  const FEE_PILL: Record<FeeState, { tone: string; label: string }> = {
    full: { tone: 'ok', label: t('books.collected', locale) },
    partial: { tone: 'warn', label: t('books.pill_partial', locale) },
    unpaid: { tone: 'faint', label: t('books.pill_unpaid', locale) },
  };

  // ── Per-currency truth, grouped by obra (ADR-087) ─────────────────────
  type CurrencyRoll = { currency: string; contratado: number; holds: number; collected: number; expenses: number };
  type ObraGroup = {
    projectId: string;
    name: string;
    accent: string;
    slug: string;
    workspaceId: string;
    mode: InvoicingMode;
    bolos: MoneyBolo[];
    currencies: CurrencyRoll[];
  };
  type MutableObra = Omit<ObraGroup, 'currencies'> & { currencies: Map<string, CurrencyRoll> };

  function ensureCurrency(map: Map<string, CurrencyRoll>, currency: string): CurrencyRoll {
    const existing = map.get(currency);
    if (existing) return existing;
    const created = { currency, contratado: 0, holds: 0, collected: 0, expenses: 0 };
    map.set(currency, created);
    return created;
  }

  let byObra = $derived.by<ObraGroup[]>(() => {
    const map = new Map<string, MutableObra>();
    const ensureObra = (b: MoneyBolo): MutableObra => {
      const key = b.project?.id ?? b.project_id;
      const existing = map.get(key);
      if (existing) return existing;
      const created: MutableObra = {
        projectId: key,
        name: b.project?.name ?? '—',
        accent: b.project?.accent ?? 'var(--text-faint)',
        slug: b.project?.slug ?? '',
        workspaceId: b.project?.workspace_id ?? '',
        mode: boloMode(b),
        bolos: [],
        currencies: new Map(),
      };
      map.set(key, created);
      return created;
    };

    for (const b of bolos) {
      const obra = ensureObra(b);
      obra.bolos.push(b);
      const roll = ensureCurrency(obra.currencies, b.fee_currency ?? 'EUR');
      roll.collected += Number(b.collected ?? 0);
      if (b.fee_amount === null) continue;
      if (CONTRACTED.includes(b.status)) roll.contratado += Number(b.fee_amount);
      else if (b.status.startsWith('hold')) roll.holds += Number(b.fee_amount);
    }

    for (const expense of expenses) {
      const projectId = expense.bolo_id
        ? boloById.get(expense.bolo_id)?.project_id ?? null
        : expense.line_id
          ? lineToProjectId.get(expense.line_id) ?? null
          : null;
      if (!projectId) continue;
      const obra = map.get(projectId);
      if (!obra) continue;
      ensureCurrency(obra.currencies, expense.currency).expenses += Number(expense.amount);
    }

    return [...map.values()]
      .map((obra) => ({
        ...obra,
        bolos: [...obra.bolos].sort((a, c) => (a.next_performed_at ?? '9999').localeCompare(c.next_performed_at ?? '9999')),
        currencies: [...obra.currencies.values()].sort((a, c) => a.currency.localeCompare(c.currency)),
      }))
      .sort((a, c) => {
        const at = a.currencies.reduce((s, r) => s + r.contratado, 0);
        const ct = c.currencies.reduce((s, r) => s + r.contratado, 0);
        return ct - at;
      });
  });

  let loading = $derived($bolosQuery.isLoading || $invoicesQuery.isLoading || $expensesQuery.isLoading);
  // aria-busy: the lens does not know what to draw until the pins resolve
  // against the indexes AND its feeds have answered. One honest signal for
  // assistive tech and for the E2E (`tests/lens.ts`), instead of a guessed wait.
  let busy = $derived(
    $workspacesQuery.isPending || $projectsQuery.isPending || $linesQuery.isPending || loading,
  );
  let errorMsg = $derived.by(() => {
    const error = $bolosQuery.error ?? $invoicesQuery.error ?? $expensesQuery.error;
    return error instanceof Error ? error.message : '';
  });

  // ── General position (top) — per currency (grill 2026-07-23):
  //   Vendido (Σ gross fee) leads · Cobrado · Pendiente/Vencido (owed — the action
  //   number, from issued-unpaid invoices via aging) · pipeline (holds) demoted.
  let currencies = $derived([...new Set(bolos.map((b) => b.fee_currency ?? 'EUR'))].sort());
  // Live "today" so aging (overdue/approaching) re-derives across midnight on a
  // dashboard left open, instead of freezing against the mount-time date. Cheap:
  // a minute tick over a few hundred rows.
  let nowMs = $state(Date.now());
  $effect(() => {
    const id = setInterval(() => (nowMs = Date.now()), 60_000);
    return () => clearInterval(id);
  });
  let today = $derived(new Date(nowMs));
  let termsByPayer = $derived(
    observedPayerTermsDays(invoices, invoices.flatMap((i) => i.payments)),
  );
  let totals = $derived.by(() => {
    const map = new Map<
      string,
      { currency: string; vendido: number; collected: number; owed: number; overdue: number; pipeline: number }
    >();
    const ensure = (currency: string) => {
      const existing = map.get(currency);
      if (existing) return existing;
      const created = { currency, vendido: 0, collected: 0, owed: 0, overdue: 0, pipeline: 0 };
      map.set(currency, created);
      return created;
    };
    // Owed is measured at the BOLO level, from the same bolo.collected that feeds
    // Cobrado — never from invoice-linked payments — so a deal-card payment (which
    // anchors to the bolo, not the invoice) can't show as both collected AND still
    // owed. The issued invoice only supplies the tax-adjusted total + expected date.
    for (const b of bolos) {
      const roll = ensure(b.fee_currency ?? 'EUR');
      const collected = Number(b.collected ?? 0);
      roll.collected += collected;
      if (b.fee_amount === null) continue;
      const contracted = CONTRACTED.includes(b.status);
      if (contracted) roll.vendido += Number(b.fee_amount);
      else if (b.status.startsWith('hold')) roll.pipeline += Number(b.fee_amount);
      if (!contracted) continue;
      const issuedDoc = (invoicesByBolo.get(b.id) ?? []).find((i) => i.status === 'issued');
      const effectiveTotal = issuedDoc ? Number(issuedDoc.total) : Number(b.fee_amount);
      const outstanding = Math.max(0, effectiveTotal - collected);
      if (outstanding <= 0) continue;
      roll.owed += outstanding;
      if (issuedDoc) {
        const aging = agingState(
          {
            ...issuedDoc,
            observed_terms_days: issuedDoc.payer_person_id
              ? termsByPayer.get(issuedDoc.payer_person_id)?.days ?? null
              : null,
          },
          issuedDoc.payments,
          today,
        );
        if (aging.state === 'past-expected') roll.overdue += outstanding;
      }
    }
    return [...map.values()].sort((a, b) => a.currency.localeCompare(b.currency));
  });

  let expenseTotals = $derived(totalsByCurrency(expenses, (e) => e.currency, (e) => Number(e.amount)));

  const queryClient = useQueryClient();

  // ── Fee editor (ADR-043) — writes the bolo fee ────────────────────────
  let feeOpen = $state(false);
  let feeEditing = $state<MoneyBolo | null>(null);
  let fAmount = $state('');
  let fCurrency = $state('EUR');
  function openFee(b: MoneyBolo) {
    feeEditing = b;
    fAmount = b.fee_amount === null ? '' : String(b.fee_amount);
    fCurrency = b.fee_currency ?? 'EUR';
    feeOpen = true;
  }
  const feeMutation = createMutation({
    mutationFn: async (input: { id: string; fee_amount: number | null; fee_currency: string }) => {
      const body = await mutateJSON<{ bolo?: unknown }>('PATCH', `/api/money/bolos/${input.id}`, {
        fee_amount: input.fee_amount,
        fee_currency: input.fee_currency,
      });
      if (!body?.bolo) throw new Error(t('books.unexpected_response', locale));
      return body.bolo;
    },
    onSuccess: () => {
      feeOpen = false;
      feeEditing = null;
      void queryClient.invalidateQueries({ queryKey: ['money-bolos'] });
    },
    onError: (err) => addToast({ tone: 'danger', title: t('books.fee_not_saved', locale), message: t('books.try_again', locale, { error: err instanceof Error ? err.message : t('perf.unexpected', locale) }) }),
  });
  function saveFee() {
    if (!feeEditing || $feeMutation.isPending) return;
    const trimmed = String(fAmount ?? '').trim();
    const amount = trimmed === '' ? null : Number(trimmed);
    if (amount !== null && (Number.isNaN(amount) || amount < 0)) {
      addToast({ tone: 'warning', message: t('books.fee_invalid', locale) });
      return;
    }
    $feeMutation.mutate({ id: feeEditing.id, fee_amount: amount, fee_currency: fCurrency });
  }

  // ── Record payment — anchored to the deal's fee (ADR-086 D3) ───────────
  let payOpen = $state(false);
  let payBolo = $state<MoneyBolo | null>(null);
  let payAmount = $state('');
  let payReceivedOn = $state('');
  let payMethod = $state<string>('transfer');
  let payCounterparty = $state('');
  let payCategory = $state('');
  let payReference = $state('');
  // Stable per dialog-open, so a double-submit (two clicks before the button
  // disables) or a two-tab race carries the SAME key — create_payment dedups on
  // it (unique index + ON CONFLICT), preventing a duplicated, over-counted
  // payment. Fresh key each time openPay runs = each intended payment is new.
  let payIdempotencyKey = $state('');
  function openPay(b: MoneyBolo) {
    payBolo = b;
    const remaining = Math.max(0, Number(b.fee_amount ?? 0) - Number(b.collected ?? 0));
    payAmount = remaining ? remaining.toFixed(2) : '';
    payReceivedOn = localDayISO();
    payMethod = 'transfer';
    payCounterparty = b.venue_name ?? '';
    payCategory = '';
    payReference = '';
    payIdempotencyKey = crypto.randomUUID();
    payOpen = true;
  }
  const payMutation = createMutation({
    mutationFn: async () => {
      const amount = Number(String(payAmount).trim());
      if (!Number.isFinite(amount) || amount <= 0) throw new Error(t('books.amount_gt_zero', locale));
      const body = await mutateJSON<{ payment?: unknown }>('POST', '/api/payments', {
        amount,
        received_on: payReceivedOn || localDayISO(),
        method: payMethod,
        bolo_id: payBolo!.id,
        counterparty: payCounterparty.trim() || null,
        category: payCategory.trim() || null,
        reference: payReference.trim() || null,
        idempotency_key: payIdempotencyKey,
      });
      if (!body?.payment) throw new Error(t('books.unexpected_response', locale));
      return body.payment;
    },
    onSuccess: () => {
      payOpen = false;
      payBolo = null;
      void queryClient.invalidateQueries({ queryKey: ['money-bolos'] });
      addToast({ tone: 'success', message: t('books.payment_recorded_fee', locale) });
    },
    onError: (err) => addToast({ tone: 'danger', title: t('books.payment_not_recorded', locale), message: err instanceof Error ? err.message : t('perf.unexpected', locale) }),
  });

  // ── Invoice creation (ADR-050) — doc_type driven by workspace mode ─────
  let invOpen = $state(false);
  let invBolo = $state<MoneyBolo | null>(null);
  let iVat = $state('');
  let iIrpf = $state('');
  let iDueOn = $state('');
  let iExpectedOn = $state('');
  let iPaymentCondition = $state('');
  let iPayerId = $state('');
  let availablePayers = $derived(
    invBolo?.project ? payers.filter((payer) => payer.workspace_id === invBolo?.project?.workspace_id) : [],
  );
  let invDocType = $derived(invBolo ? (boloMode(invBolo) === 'interno' ? 'proforma' : 'factura') : 'factura');
  function openInvoice(b: MoneyBolo) {
    invBolo = b;
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
  let invTotal = $derived(
    applyTaxLines(invBolo?.fee_amount ?? 0, esTaxLines(pctOrNull(iVat), pctOrNull(iIrpf))),
  );
  const createInvoice = createMutation({
    mutationFn: async () => {
      const body = await mutateJSON<{ invoice?: unknown }>('POST', '/api/invoices', {
        bolo_id: invBolo!.id,
        // ES preset → generic tax lines; the model stays country-agnostic (grill).
        tax_lines: esTaxLines(pctOrNull(iVat), pctOrNull(iIrpf)),
        country: invBolo!.country ?? null,
        due_on: iDueOn || null,
        expected_on: iExpectedOn || null,
        payment_condition: iPaymentCondition.trim() || null,
        payer_person_id: iPayerId || null,
        doc_type: invDocType,
      });
      if (!body?.invoice) throw new Error(t('books.unexpected_response', locale));
      return body.invoice;
    },
    onSuccess: () => {
      invOpen = false;
      invBolo = null;
      void queryClient.invalidateQueries({ queryKey: ['invoices'] });
      addToast({ tone: 'success', message: t(invDocType === 'proforma' ? 'books.draft_proforma_created' : 'books.draft_invoice_created', locale) });
    },
    onError: (err) => addToast({ tone: 'danger', title: t('books.doc_not_created', locale), message: err instanceof Error ? err.message : t('perf.unexpected', locale) }),
  });
  function submitInvoice() {
    if ($createInvoice.isPending) return;
    for (const p of [pctOrNull(iVat), pctOrNull(iIrpf)]) {
      if (p !== null && (Number.isNaN(p) || p < 0 || p > 100)) {
        addToast({ tone: 'warning', message: t('books.vat_irpf_invalid', locale) });
        return;
      }
    }
    $createInvoice.mutate();
  }

  // ── Add expense (money out) — anchored to a deal or a line (ADR-087) ────
  let expOpen = $state(false);
  let eAmount = $state('');
  let eCurrency = $state('EUR');
  let eDescription = $state('');
  let eCategory = $state<string>('other');
  let eIncurredOn = $state('');
  let eCounterparty = $state('');
  let eAnchor = $state('');
  // Anchor an expense to a whole line OR an individual deal (ADR-087). The value
  // encodes which: line:<id> | bolo:<id>.
  let scopedLines = $derived.by(() => {
    const seen = new Map<string, NavLine>();
    for (const b of bolos) {
      if (b.line_id && !seen.has(b.line_id)) {
        const line = lineById.get(b.line_id);
        if (line) seen.set(b.line_id, line);
      }
    }
    return [...seen.values()];
  });
  let expenseAnchorOptions = $derived([
    ...scopedLines.map((l) => ({ value: `line:${l.id}`, label: t('books.anchor_line', locale, { name: l.name, project: l.projectName }) })),
    ...bolos.map((b) => ({
      value: `bolo:${b.id}`,
      label: t('books.anchor_deal', locale, { where: [b.venue_name, b.city].filter(Boolean).join(', ') || b.project?.name || '—' }),
    })),
  ]);
  function openExpense(b?: MoneyBolo) {
    eAmount = '';
    eCurrency = b?.fee_currency ?? currencies[0] ?? 'EUR';
    eDescription = '';
    eCategory = 'other';
    eIncurredOn = localDayISO();
    eCounterparty = '';
    eAnchor = b ? `bolo:${b.id}` : (expenseAnchorOptions[0]?.value ?? '');
    expOpen = true;
  }
  const createExpense = createMutation({
    mutationFn: async () => {
      const amount = Number(String(eAmount).trim());
      if (!Number.isFinite(amount) || amount <= 0) throw new Error(t('books.amount_gt_zero', locale));
      if (!eAnchor) throw new Error(t('books.pick_anchor', locale));
      const [kind, id] = eAnchor.split(':');
      const body = await mutateJSON<{ expense?: unknown }>('POST', '/api/expenses', {
        ...(kind === 'bolo' ? { bolo_id: id } : { line_id: id }),
        category: eCategory,
        description: eDescription.trim() || t('books.expense_default', locale),
        amount,
        currency: eCurrency,
        incurred_on: eIncurredOn || null,
        counterparty: eCounterparty.trim() || null,
      });
      if (!body?.expense) throw new Error(t('books.unexpected_response', locale));
      return body.expense;
    },
    onSuccess: () => {
      expOpen = false;
      void queryClient.invalidateQueries({ queryKey: ['expenses'] });
      addToast({ tone: 'success', message: t('books.expense_added', locale) });
    },
    onError: (err) => addToast({ tone: 'danger', title: t('books.expense_not_added', locale), message: err instanceof Error ? err.message : t('perf.unexpected', locale) }),
  });

  // ── New deal — create a bolo by hand (ADR-087) ─────────────────────────
  // The backfill covers existing gigs; this is how a deal is recorded going
  // forward (its functions are scheduled later in Planner).
  let dealOpen = $state(false);
  let dealProjectId = $state('');
  let dealVenue = $state('');
  let dealCity = $state('');
  let dealFee = $state('');
  let dealCurrency = $state('EUR');
  let dealOptions = $derived(
    projectIndex.map((p) => ({ value: p.id, label: `${p.name} · ${spaceName(p.workspaceName)}` })),
  );
  function openDeal() {
    dealProjectId = scope.projects[0]?.id ?? projectIndex[0]?.id ?? '';
    dealVenue = '';
    dealCity = '';
    dealFee = '';
    dealCurrency = currencies[0] ?? 'EUR';
    dealOpen = true;
  }
  const createBolo = createMutation({
    mutationFn: async () => {
      if (!dealProjectId) throw new Error(t('books.pick_project', locale));
      const trimmed = String(dealFee).trim();
      const fee = trimmed === '' ? null : Number(trimmed);
      if (fee !== null && (Number.isNaN(fee) || fee < 0)) throw new Error(t('books.fee_invalid_short', locale));
      const body = await mutateJSON<{ bolo?: unknown }>('POST', '/api/money/bolos', {
        project_id: dealProjectId,
        venue_name: dealVenue.trim() || null,
        city: dealCity.trim() || null,
        fee_amount: fee,
        fee_currency: dealCurrency.trim() || 'EUR',
      });
      if (!body?.bolo) throw new Error(t('books.unexpected_response', locale));
      return body.bolo;
    },
    onSuccess: () => {
      dealOpen = false;
      void queryClient.invalidateQueries({ queryKey: ['money-bolos'] });
      addToast({ tone: 'success', message: t('books.deal_created', locale) });
    },
    onError: (err) => addToast({ tone: 'danger', title: t('books.deal_not_created', locale), message: err instanceof Error ? err.message : t('perf.unexpected', locale) }),
  });

  // ── Llegadas desde el alta y la ficha de una función (`_tasks.md § 36`) ──
  // `?new_bolo=<proyecto>` abre «New deal» con ese proyecto puesto (el ámbito
  // ya viene en `scope=`, que aplica el shell). Una vez, y el parámetro se
  // quita para que recargar no vuelva a abrirlo.
  let newBoloHandled = false;
  $effect(() => {
    const want = new URL(location.href).searchParams.get('new_bolo');
    if (!want || newBoloHandled || !projectIndex.some((p) => p.id === want)) return;
    newBoloHandled = true;
    openDeal();
    dealProjectId = want;
    const url = new URL(location.href);
    url.searchParams.delete('new_bolo');
    replaceState(url, {});
  });
  // `#bolo-<id>`: la tarjeta existe solo cuando el feed llega, así que el
  // navegador no puede desplazarse solo. Una vez, cuando aparece.
  let targetHandled = false;
  $effect(() => {
    if (targetHandled || bolos.length === 0 || !location.hash.startsWith('#bolo-')) return;
    const el = document.getElementById(location.hash.slice(1));
    if (!el) return;
    targetHandled = true;
    el.scrollIntoView({ block: 'center' });
  });
</script>

<svelte:head>
  <title>{t('books.head_title', locale)}</title>
</svelte:head>

<section class="mny" aria-busy={busy}>
  <LensHeader>
    {#snippet title()}<LensTitle text={t('lens.money', locale)} />{/snippet}
    <!-- TEMP sub — placeholder until this lens's real subtitle is defined. -->
    {#snippet sub()}<span class="lenshead__todo">temporal · define esta lente</span>{/snippet}
  </LensHeader>

  <div class="mny__actions">
    <Button size="xs" variant="outline" onclick={openDeal} disabled={projectIndex.length === 0}>{t('books.new_deal', locale)}</Button>
  </div>

  <div class="mny__totals">
    {#each totals as total (total.currency)}
      <span class="mny__currency-total">
        <span class="mny__currency">{total.currency}</span>
        <span class="mny__total"><span class="mny__total-label">{t('books.sold', locale)}</span>{fmtMoney(total.vendido)}</span>
        <span class="mny__total"><span class="mny__total-label">{t('books.collected', locale)}</span>{fmtMoney(total.collected)}</span>
        <span class="mny__total"><span class="mny__total-label">{t('books.owed', locale)}</span>{fmtMoney(total.owed)}</span>
        {#if total.overdue > 0}
          <span class="mny__total mny__total--danger"><span class="mny__total-label">{t('books.overdue', locale)}</span>{fmtMoney(total.overdue)}</span>
        {/if}
        {#if total.pipeline > 0}
          <span class="mny__total mny__total--soft"><span class="mny__total-label">{t('books.pipeline', locale)}</span>{fmtMoney(total.pipeline)}</span>
        {/if}
      </span>
    {/each}
    <span class="mny__total-note">{t('books.totals_note', locale)}</span>
  </div>

  {#if errorMsg}
    <p class="mny__state mny__state--danger">{errorMsg}</p>
  {:else if loading}
    <p class="mny__state">{t('desk.loading', locale)}</p>
  {:else if bolos.length === 0}
    <p class="mny__state">{t('books.empty_pins', locale)}</p>
  {:else}
    {#each byObra as obra (obra.projectId)}
      <section class="obra" style={`--c: ${obra.accent}`} aria-label={obra.name}>
        <header class="obra__head">
          <button type="button" class="obra__title" onclick={() => obra.slug && openProject(obra.slug, obra.workspaceId)} disabled={!obra.slug}>
            <span class="obra__dot"></span>
            <span class="obra__name">{obra.name}</span>
            <span class="obra__count">{t(obra.bolos.length === 1 ? 'books.deal_count_one' : 'books.deal_count_other', locale, { n: obra.bolos.length })}</span>
          </button>
          <div class="obra__rolls">
            {#each obra.currencies as roll (roll.currency)}
              <span class="obra__roll">
                <span class="obra__cur">{roll.currency}</span>
                <span class="obra__stat"><span class="obra__stat-l">{t('books.contracted', locale)}</span>{fmtMoney(roll.contratado)}</span>
                <span class="obra__stat"><span class="obra__stat-l">{t('books.collected', locale)}</span>{fmtMoney(roll.collected)}</span>
                <span class="obra__stat"><span class="obra__stat-l">{t('books.pending', locale)}</span>{fmtMoney(Math.max(0, roll.contratado - roll.collected))}</span>
                {#if roll.expenses > 0}
                  <span class="obra__stat obra__stat--soft"><span class="obra__stat-l">{t('books.net', locale)}</span>{fmtMoney(roll.contratado - roll.expenses)}</span>
                {/if}
              </span>
            {/each}
          </div>
        </header>

        <div class="fees">
          {#each obra.bolos as b (b.id)}
            {@const st = feeState(b)}
            {@const fee = Number(b.fee_amount ?? 0)}
            {@const coll = Number(b.collected ?? 0)}
            {@const rem = fee - coll}
            {@const cp = fee > 0 ? Math.min(100, Math.round((coll / fee) * 100)) : 0}
            {@const mode = obra.mode}
            {@const docs = invoicesByBolo.get(b.id) ?? []}
            <div class="fee" id={`bolo-${b.id}`} data-st={b.fee_amount === null ? 'none' : st}>
              <div class="fee__top">
                <span class="fee__date">
                  {b.next_performed_at ? dayLabel(b.next_performed_at) : t('books.no_date', locale)}
                  {#if b.function_count > 1}<span class="fee__fns">· {t('books.fn_count', locale, { n: b.function_count })}</span>{/if}
                </span>
                <span class="fee__where">
                  <span class="fee__venue-main">{b.venue_name || '—'}{#if b.city}<span class="fee__city"> · {b.city}</span>{/if}</span>
                  {#if docs.length > 0}
                    <a class="fee__doc" href="#mny-documents" title={t('books.doc_title', locale)}>{docs[0]!.number ?? invoiceStatusLabel(docs[0]!.status, locale)}</a>
                  {/if}
                </span>
                <span class="fee__badge"><StateBadge label={boloStatusLabel(b.status, locale)} tone={performanceStatusTone(b.status)} /></span>
                <span class="fee__amt">
                  <button type="button" class="fee__fee" title={t('books.edit_fee', locale)} onclick={() => openFee(b)}>{fmtFee(b.fee_amount, b.fee_currency)}</button>
                  {#if docs.length > 0 && (docs[0]!.status === 'issued' || docs[0]!.status === 'paid') && Number(docs[0]!.total) !== Number(docs[0]!.subtotal)}
                    <span class="fee__net">{t('books.net', locale)} {fmtMoney(Number(docs[0]!.total))} {docs[0]!.currency}</span>
                  {/if}
                  {#if b.fee_amount !== null}<span class="pill" data-tone={FEE_PILL[st].tone}>{FEE_PILL[st].label}</span>{/if}
                </span>
              </div>
              {#if b.fee_amount !== null}
                <div class="fee__bar"><span class="fee__coll" style={`inline-size:${cp}%`}></span></div>
                <div class="fee__foot">
                  <span class="fee__collected">{t('books.collected_of', locale, { collected: fmtMoney(coll), fee: fmtMoney(fee) })}{#if rem > 0} · <span class="fee__rem">{t('books.left', locale, { amount: fmtMoney(rem) })}</span>{/if}</span>
                  <span class="fee__acts">
                    <Button size="xs" variant="outline" onclick={() => openPay(b)}>{t('books.record_payment', locale)}</Button>
                    <Button size="xs" variant="outline" onclick={() => openExpense(b)}>{t('books.add_expense', locale)}</Button>
                    {#if mode !== 'off'}
                      <Button size="xs" variant="outline" onclick={() => openInvoice(b)}>{t(mode === 'interno' ? 'books.create_proforma' : 'books.create_invoice', locale)}</Button>
                    {/if}
                  </span>
                </div>
              {/if}
            </div>
          {/each}
        </div>
      </section>
    {/each}

    {#if anyDocMode}
      <section class="mny__section" id="mny-documents" aria-label={t('books.documents', locale)}>
        <p class="eyebrow">{t('books.documents', locale)}</p>
        <MoneyInvoices {invoices} />
      </section>
    {/if}

    <section class="mny__section" aria-label={t('books.expenses', locale)}>
      <div class="mny__section-head">
        <p class="eyebrow">{t('books.expenses', locale)}</p>
        <div class="mny__section-headr">
          {#if expenseTotals.length > 0}
            <p class="mny__expense-totals">
              {#each expenseTotals as [currency, amount] (currency)}<span>− {fmtMoney(amount)} {currency}</span>{/each}
            </p>
          {/if}
          <Button size="xs" variant="outline" onclick={() => openExpense()} disabled={expenseAnchorOptions.length === 0}>{t('books.add_expense', locale)}</Button>
        </div>
      </div>
      {#if expenses.length === 0}
        <p class="mny__state">{t('books.no_expenses_scope', locale)}</p>
      {:else}
        <ul class="mny__expenses" role="list">
          {#each expenses as expense (expense.id)}
            <li>
              <span class="mny__cell-date">{expense.incurred_on ? dayLabel(expense.incurred_on) : '—'}</span>
              <span class="mny__expense-description"><b>{expense.description}</b>{#if expense.counterparty}<span class="mny__expense-counter"> · {expense.counterparty}</span>{/if}</span>
              <span class="mny__expense-category">{categoryLabel(expense.category, locale)}</span>
              <strong>− {fmtMoney(expense.amount)} {expense.currency}</strong>
            </li>
          {/each}
        </ul>
      {/if}
    </section>
  {/if}
</section>

<Dialog bind:open={feeOpen} title={t('books.fee', locale)} size="s" onclose={() => (feeEditing = null)}>
  {#if feeEditing}
    <p class="mny__dialog-who">{feeEditing.project?.name ?? ''} — {[feeEditing.venue_name, feeEditing.city].filter(Boolean).join(', ')}</p>
  {/if}
  <div class="mny__fee-form">
    <Input label={t('books.amount', locale)} type="number" bind:value={fAmount} placeholder={t('books.ph_fee_clear', locale)} />
    <Input label={t('books.currency', locale)} bind:value={fCurrency} placeholder="EUR" />
  </div>
  {#snippet actions()}
    <Button variant="outline" onclick={() => (feeOpen = false)}>{t('create.cancel', locale)}</Button>
    <Button onclick={saveFee} loading={$feeMutation.isPending}>{t('blackout.save', locale)}</Button>
  {/snippet}
</Dialog>

<Dialog bind:open={payOpen} title={t('books.record_payment', locale)} size="s" description={payBolo ? `${[payBolo.venue_name, payBolo.city].filter(Boolean).join(', ')}` : ''} onclose={() => (payBolo = null)}>
  <div class="mny__pay-form">
    <div class="mny__row2">
      <Input label={t('books.amount_cur', locale, { currency: payBolo?.fee_currency ?? 'EUR' })} type="number" bind:value={payAmount} />
      <Input label={t('books.received_on', locale)} type="date" bind:value={payReceivedOn} />
    </div>
    <div class="mny__row2">
      <Select label={t('books.method', locale)} bind:value={payMethod} options={PAYMENT_METHODS.map((m) => ({ value: m, label: paymentMethodLabel(m, locale) }))} />
      <Input label={t('books.counterparty_payer', locale)} bind:value={payCounterparty} placeholder={t('books.ph_venue', locale)} />
    </div>
    <Input label={t('books.reference_opt', locale)} bind:value={payReference} placeholder={t('books.ph_reference', locale)} />
  </div>
  <p class="mny__dialog-note">{t('books.pay_note', locale)}</p>
  {#snippet actions()}
    <Button variant="outline" onclick={() => (payOpen = false)}>{t('create.cancel', locale)}</Button>
    <Button onclick={() => !$payMutation.isPending && $payMutation.mutate()} loading={$payMutation.isPending}>{t('books.record', locale)}</Button>
  {/snippet}
</Dialog>

<Dialog bind:open={invOpen} title={t(invDocType === 'proforma' ? 'books.new_proforma' : 'books.new_invoice', locale)} size="m" onclose={() => (invBolo = null)}>
  {#if invBolo}
    <p class="mny__dialog-who">{invBolo.project?.name ?? ''} — {[invBolo.venue_name, invBolo.city].filter(Boolean).join(', ')}</p>
    <p class="mny__inv-fee-line">{t('books.fee_subtotal', locale)} <strong>{fmtFee(invBolo.fee_amount, invBolo.fee_currency)}</strong> {t('books.snapshot_note', locale)}</p>
    <div class="mny__inv-form">
      <Input label={t('books.vat_pct', locale)} type="number" bind:value={iVat} placeholder={t('books.ph_vat', locale)} />
      <Input label={t('books.irpf_pct', locale)} type="number" bind:value={iIrpf} placeholder={t('books.ph_irpf', locale)} />
      <Input label={t('books.due_on', locale)} type="date" bind:value={iDueOn} />
      <Input label={t('books.expected_collection', locale)} type="date" bind:value={iExpectedOn} />
      <Select label={t('books.payer', locale)} bind:value={iPayerId}>
        <option value="">{t('books.payer_linked', locale)}</option>
        {#each availablePayers as payer (payer.id)}
          <option value={payer.id}>{payer.organization_name ? `${payer.organization_name} · ${payer.full_name}` : payer.full_name}</option>
        {/each}
      </Select>
    </div>
    <Input label={t('books.payment_condition', locale)} bind:value={iPaymentCondition} placeholder={t('books.ph_condition', locale)} />
    <p class="mny__inv-total-preview">{t('books.total_label', locale)} <strong>{fmtMoney(invTotal)} {invBolo.fee_currency ?? 'EUR'}</strong></p>
  {/if}
  {#snippet actions()}
    <Button variant="outline" onclick={() => (invOpen = false)}>{t('create.cancel', locale)}</Button>
    <Button onclick={submitInvoice} loading={$createInvoice.isPending}>{t('books.create_draft', locale)}</Button>
  {/snippet}
</Dialog>

<Dialog bind:open={dealOpen} title={t('books.new_deal', locale)} size="s" description={t('books.deal_desc', locale)}>
  <div class="mny__pay-form">
    <Select label={t('books.project_obra', locale)} bind:value={dealProjectId} options={dealOptions} />
    <div class="mny__row2">
      <Input label={t('create.venue', locale)} bind:value={dealVenue} placeholder={t('books.ph_venue', locale)} />
      <Input label={t('create.city', locale)} bind:value={dealCity} placeholder={t('books.ph_city', locale)} />
    </div>
    <div class="mny__row2">
      <Input label={t('books.fee_optional', locale)} type="number" bind:value={dealFee} placeholder={t('books.ph_fee_later', locale)} />
      <Input label={t('books.currency', locale)} bind:value={dealCurrency} placeholder="EUR" />
    </div>
  </div>
  {#snippet actions()}
    <Button variant="outline" onclick={() => (dealOpen = false)}>{t('create.cancel', locale)}</Button>
    <Button onclick={() => !$createBolo.isPending && $createBolo.mutate()} loading={$createBolo.isPending}>{t('books.create_deal', locale)}</Button>
  {/snippet}
</Dialog>

<Dialog bind:open={expOpen} title={t('books.add_expense', locale)} size="s" description={t('books.expense_desc', locale)}>
  <div class="mny__pay-form">
    <div class="mny__row2">
      <Input label={t('books.amount', locale)} type="number" bind:value={eAmount} />
      <Input label={t('books.currency', locale)} bind:value={eCurrency} placeholder="EUR" />
    </div>
    <Input label={t('books.description', locale)} bind:value={eDescription} placeholder={t('books.ph_expense', locale)} />
    <div class="mny__row2">
      <Input label={t('perf.date', locale)} type="date" bind:value={eIncurredOn} />
      <Select label={t('books.category', locale)} bind:value={eCategory} options={EXPENSE_CATEGORIES.map((c) => ({ value: c, label: categoryLabel(c, locale) }))} />
    </div>
    <Select label={t('books.anchor', locale)} bind:value={eAnchor} options={expenseAnchorOptions} />
    <Input label={t('books.counterparty_paid', locale)} bind:value={eCounterparty} placeholder={t('books.ph_counterparty', locale)} />
  </div>
  {#snippet actions()}
    <Button variant="outline" onclick={() => (expOpen = false)}>{t('create.cancel', locale)}</Button>
    <Button onclick={() => !$createExpense.isPending && $createExpense.mutate()} loading={$createExpense.isPending}>{t('composer.add', locale)}</Button>
  {/snippet}
</Dialog>

<style>
  @layer components {
    .mny { display: flex; flex-direction: column; gap: var(--space-l); }
    /* Header is now the shared LensHeader (global .lenshead* classes). */
    .mny__actions { display: flex; justify-content: flex-end; }
    .mny__totals { display: flex; align-items: end; gap: var(--space-m); flex-wrap: wrap; }
    .mny__currency-total {
      display: grid; grid-template-columns: auto repeat(4, minmax(6rem, auto));
      gap: var(--space-s) var(--space-m); align-items: baseline;
      padding: var(--space-s) var(--space-m); border: 1px solid var(--border-color-light);
      border-radius: var(--radius-m); background: color-mix(in oklch, var(--bg-light) 55%, transparent);
    }
    .mny__currency { font-family: var(--font-mono); font-size: var(--text-xs); color: var(--text-muted); letter-spacing: 0.08em; }
    .mny__total { font-family: var(--font-display); font-size: var(--text-l); color: var(--text-color); display: flex; align-items: baseline; gap: var(--space-xs); }
    .mny__total--soft { color: var(--text-muted); }
    .mny__total--danger { color: var(--danger); }
    .mny__total-label { font-family: var(--font-mono); font-size: var(--text-xs); letter-spacing: 0.08em; text-transform: uppercase; color: var(--text-faint); }
    .mny__total-note { font-size: var(--text-xs); color: var(--text-faint); }
    .mny__state { font-size: var(--text-s); color: var(--text-faint); }
    .mny__state--danger { color: var(--danger); }
    .mny__section { display: flex; flex-direction: column; gap: var(--space-s); }
    .mny__section-head { display: flex; align-items: baseline; justify-content: space-between; gap: var(--space-m); }
    .mny__section-headr { display: flex; align-items: center; gap: var(--space-m); }

    /* ── obra group (deals grouped by project) ── */
    .obra { display: flex; flex-direction: column; gap: var(--space-s); }
    .obra__head { display: flex; align-items: baseline; justify-content: space-between; gap: var(--space-m); flex-wrap: wrap; padding-block-end: var(--space-xs); border-block-end: 1px solid var(--border-color-light); }
    .obra__title { display: flex; align-items: center; gap: var(--space-s); border: 0; background: none; padding: 0; cursor: pointer; font-family: inherit; }
    .obra__title:disabled { cursor: default; }
    .obra__dot { inline-size: 0.5rem; block-size: 0.5rem; border-radius: var(--radius-circle); background: var(--c); }
    .obra__name { font-size: var(--text-m); font-weight: 500; color: var(--text-color); }
    .obra__title:hover:not(:disabled) .obra__name { text-decoration: underline; }
    .obra__count { font-family: var(--font-mono); font-size: var(--text-xs); color: var(--text-faint); }
    .obra__rolls { display: flex; gap: var(--space-m); flex-wrap: wrap; }
    .obra__roll { display: flex; align-items: baseline; gap: var(--space-s); font-family: var(--font-mono); font-variant-numeric: tabular-nums; }
    .obra__cur { font-size: var(--text-xs); color: var(--text-muted); letter-spacing: 0.06em; }
    .obra__stat { font-size: var(--text-s); color: var(--text-color); display: flex; align-items: baseline; gap: var(--space-2xs); }
    .obra__stat--soft { color: var(--text-muted); }
    .obra__stat-l { font-size: var(--text-xs); text-transform: uppercase; letter-spacing: 0.06em; color: var(--text-faint); }

    /* ── deal (bolo) cards, venue-first ── */
    .fees { display: flex; flex-direction: column; gap: var(--space-s); }
    .fee {
      padding: var(--space-m); border: 1px solid var(--border-color-dark);
      border-inline-start-width: 3px; border-radius: var(--radius-l); background: var(--bg-ultra-light);
    }
    .fee:hover, .fee:target { border-color: var(--text-faint); }
    .fee[data-st='full'] { border-inline-start-color: var(--success); }
    .fee[data-st='partial'] { border-inline-start-color: var(--warning); }
    .fee[data-st='unpaid'], .fee[data-st='none'] { border-inline-start-color: var(--border-color-dark); }
    .fee__top { display: grid; grid-template-columns: auto 1fr auto auto; align-items: baseline; gap: var(--space-m); }
    .fee__date { font-family: var(--font-mono); font-size: var(--text-xs); color: var(--text-muted); white-space: nowrap; }
    .fee__fns { color: var(--text-faint); }
    .fee__where { min-inline-size: 0; display: flex; flex-direction: column; gap: 2px; }
    .fee__venue-main { font-size: var(--text-m); font-weight: 500; color: var(--text-color); }
    .fee__city { color: var(--text-muted); font-weight: 400; }
    .fee__doc {
      align-self: start; font-family: var(--font-mono); font-size: var(--text-xs); color: var(--text-muted);
      text-decoration: none; padding: 1px 8px; border: 1px solid var(--border-color-dark); border-radius: var(--radius-circle);
    }
    .fee__doc:hover { color: var(--text-color); border-color: var(--text-faint); }
    .fee__amt { text-align: end; display: flex; flex-direction: column; align-items: flex-end; gap: 4px; }
    .fee__fee { font-family: var(--font-mono); font-size: var(--text-m); color: var(--text-color); font-variant-numeric: tabular-nums; }
    .fee__fee:hover { text-decoration: underline; }
    .fee__net { font-family: var(--font-mono); font-size: var(--text-xs); color: var(--text-muted); font-variant-numeric: tabular-nums; }
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
      .mny__currency-total { inline-size: 100%; grid-template-columns: auto 1fr; }
      .mny__currency { grid-column: 1 / -1; }
      .mny__total { justify-content: space-between; }
      .mny__total-note { inline-size: 100%; }
      .obra__head { flex-direction: column; align-items: stretch; }
      .obra__rolls { flex-direction: column; gap: var(--space-xs); }
      .fee__top { grid-template-columns: 1fr auto; }
      .fee__date, .fee__badge { grid-column: 1 / -1; }
      .mny__expenses li { grid-template-columns: 1fr auto; gap: var(--space-2xs) var(--space-s); }
      .mny__expense-description { grid-column: 1 / -1; }
      .mny__expenses strong { grid-column: 2; grid-row: 1; }
      .mny__row2, .mny__inv-form, .mny__fee-form { grid-template-columns: 1fr; }
    }
  }
</style>
