<script lang="ts">
  /**
   * Cuentas (`/h/books`) as a dashboard (ADR-117, propuesta A): a collection
   * radar on top, the ledger below.
   *
   *   1. Four figures per currency: por cobrar (issued and not collected, with
   *      what is past its EXPECTED date inside), por facturar, what comes in
   *      within 30 days, and the season (sold, with a three-part bar).
   *   2. Pide atención: one row per problem, worst first, ONE action each.
   *   3. Lo que entra: the next four months.
   *   4. The ledger (tabs Bolos · Documentos · Gastos), a table whose filters
   *      ARE the figures; a row unfolds in place into the bolo's sheet, and
   *      `#bolo-<id>` opens the page with that row unfolded.
   *
   * Every number comes from the pure functions in `$lib/money` (one look at
   * each bolo, `boloMoney`, summed), so a figure and its filter cannot count
   * different things. The BOLO is the money unit (ADR-087); filter = pins
   * (ADR-038). Season = September to August by function date (ADR-117 § 3);
   * por cobrar, vencido and por facturar ignore it (a debt does not expire with
   * the season), only the season figure and the ledger's «all» use it.
   *
   * Reads are money-gated by the RPCs; the lens itself is gated on read:money
   * in SOME project (`/api/money/access`), so a reader without it is told so
   * instead of «no bolos». Fee editing lives here by design (ADR-043).
   */

  import { createMutation, createQuery, useQueryClient } from '@tanstack/svelte-query';
  import { toStore } from 'svelte/store';
  import { fetchJSON, mutateJSON } from '$lib/api';
  import Button from '$lib/components/Button.svelte';
  import Chip from '$lib/components/Chip.svelte';
  import MoneyInvoices from '$lib/components/MoneyInvoices.svelte';
  import LensHeader from '$lib/components/LensHeader.svelte';
  import LensTitle from '$lib/components/LensTitle.svelte';
  import Dialog from '$lib/components/Dialog.svelte';
  import Input from '$lib/components/Input.svelte';
  import Select from '$lib/components/Select.svelte';
  import StateBadge from '$lib/components/StateBadge.svelte';
  import { addToast } from '$lib/components/Toast.svelte';
  import { dayLabel, localDayISO } from '$lib/datetime';
  import { DASH } from '$lib/glyphs';
  import { categoryLabel, EXPENSE_CATEGORIES, type ExpenseItem } from '$lib/expense';
  import {
    applyTaxLines,
    attentionItems,
    boloMoney,
    boloSeason,
    boloStatusLabel,
    esTaxLines,
    expectedInflow,
    fmtFee,
    fmtMoney,
    fmtMoneyCompact,
    invoicesByBolo as groupInvoicesByBolo,
    invoiceStatusLabel,
    LEDGER_FILTERS,
    matchesLedgerFilter,
    moneyPosition,
    observedPayerTermsDays,
    PAYMENT_METHODS,
    paymentProposal,
    paymentMethodLabel,
    seasonLabel,
    seasonOf,
    seasonsOf,
    totalsByCurrency,
    type AttentionItem,
    type BoloMoney,
    type InvoicingMode,
    type LedgerFilter,
    type MoneyBolo,
    type MoneyContext,
    type MoneyInvoiceItem,
    type MoneyPayer,
  } from '$lib/money';
  import { moneyAccessAnyQueryOptions } from '$lib/bolo-queries';
  import { detectLocale, LOCALE_TAG, t } from '$lib/i18n';
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
  import { tick } from 'svelte';

  type WorkspaceLite = { id: string; slug: string; invoicing_mode: InvoicingMode | null };

  const pins = usePins();
  const locale = detectLocale(navigator.language);
  const localeTag = LOCALE_TAG[locale];

  const accessQuery = createQuery(moneyAccessAnyQueryOptions());
  /** Only an explicit «no» closes the lens; pending or failed, it draws. */
  let noAccess = $derived($accessQuery.data?.read_money === false);

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

  function feedParams(k: { projectIds: string[]; workspaceIds: string[] }, extra: Record<string, string> = {}): string {
    const p = new URLSearchParams(extra);
    if (k.projectIds.length > 0) p.set('project_ids', k.projectIds.join(','));
    if (k.workspaceIds.length > 0) p.set('workspace_ids', k.workspaceIds.join(','));
    return p.toString();
  }
  let filterIds = $derived({ projectIds: scope.projectIds, workspaceIds: scope.workspaceIds });

  function openProject(projectSlug: string, workspaceId: string) {
    const ws = workspaceSlugById.get(workspaceId) ?? defaultWorkspaceSlug;
    void goto(`/h/${ws}/project/${projectSlug}/`);
  }

  // The bolos feed comes whole (up to 500) and the season is cut here: por
  // cobrar and por facturar must see every season, the season figure only one.
  const bolosOptions = toStore(() => {
    const k = { ...filterIds, unresolved: scopeUnresolved, gated: noAccess };
    return {
      queryKey: ['money-bolos', { p: k.projectIds, w: k.workspaceIds }] as const,
      enabled: !k.unresolved && !k.gated,
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        fetchJSON<{ items: MoneyBolo[] }>(`/api/money/bolos?${feedParams(k, { limit: '500' })}`, signal),
    };
  });
  const invoicesOptions = toStore(() => {
    const k = { ...filterIds, unresolved: scopeUnresolved, gated: noAccess };
    return {
      queryKey: ['invoices', { p: k.projectIds, w: k.workspaceIds }] as const,
      enabled: !k.unresolved && !k.gated,
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        fetchJSON<{ items: MoneyInvoiceItem[] }>(`/api/invoices?${feedParams(k)}`, signal),
    };
  });
  const expensesOptions = toStore(() => {
    const k = { ...filterIds, unresolved: scopeUnresolved, gated: noAccess };
    return {
      queryKey: ['expenses', { p: k.projectIds, w: k.workspaceIds }] as const,
      enabled: !k.unresolved && !k.gated,
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        fetchJSON<{ items: ExpenseItem[] }>(`/api/expenses?${feedParams(k)}`, signal),
    };
  });
  const payersOptions = toStore(() => {
    const k = { ...filterIds, unresolved: scopeUnresolved, gated: noAccess };
    return {
      queryKey: ['money-payers', { p: k.projectIds, w: k.workspaceIds }] as const,
      enabled: !k.unresolved && !k.gated,
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

  function boloMode(b: MoneyBolo): InvoicingMode {
    return workspaceModeById.get(b.project?.workspace_id ?? '') ?? 'legal';
  }
  let anyDocMode = $derived(bolos.some((b) => boloMode(b) !== 'off'));

  // Live "today" so aging re-derives across midnight on a dashboard left open.
  let nowMs = $state(Date.now());
  $effect(() => {
    const id = setInterval(() => (nowMs = Date.now()), 60_000);
    return () => clearInterval(id);
  });
  let today = $derived(new Date(nowMs));

  let docsByBolo = $derived(groupInvoicesByBolo(invoices));
  let termsByPayer = $derived(observedPayerTermsDays(invoices, invoices.flatMap((i) => i.payments)));
  let ctx = $derived<MoneyContext>({ invoicesByBolo: docsByBolo, termsByPayer, modeOf: boloMode, today });
  let moneyById = $derived(new Map(bolos.map((b) => [b.id, boloMoney(b, ctx)])));
  const moneyOf = (b: MoneyBolo): BoloMoney => moneyById.get(b.id) ?? boloMoney(b, ctx);

  // ── Season ────────────────────────────────────────────────────────────
  let currentSeason = $derived(seasonOf(today.toISOString()));
  let seasons = $derived(seasonsOf(bolos, today));
  let pickedSeason = $state<number | null>(null);
  let season = $derived(pickedSeason ?? currentSeason);
  let seasonBolos = $derived(bolos.filter((b) => boloSeason(b, today) === season));
  let obraNames = $derived([...new Set(seasonBolos.map((b) => b.project?.name).filter(Boolean))] as string[]);
  function seasonSpan(start: number): string {
    const m = (y: number, month: number) =>
      new Intl.DateTimeFormat(localeTag, { month: 'short', year: '2-digit', timeZone: 'UTC' }).format(
        new Date(Date.UTC(y, month, 1)),
      );
    return t('books.season_span', locale, { from: m(start, 8), to: m(start + 1, 7) });
  }

  // ── The radar ─────────────────────────────────────────────────────────
  let position = $derived(moneyPosition(bolos, ctx, season));
  let attention = $derived(attentionItems(bolos, ctx));
  let inflow = $derived(expectedInflow(bolos, ctx, 4));
  const ATTENTION_VISIBLE = 6;
  let attentionAll = $state(false);
  let attentionShown = $derived(attentionAll ? attention : attention.slice(0, ATTENTION_VISIBLE));

  function monthLabel(key: string): string {
    const [y, m] = key.split('-').map(Number);
    return new Intl.DateTimeFormat(localeTag, { month: 'short', timeZone: 'UTC' }).format(
      new Date(Date.UTC(y!, m! - 1, 1)),
    );
  }
  function pct(part: number, whole: number): number {
    return whole > 0 ? Math.max(0, Math.min(100, (part / whole) * 100)) : 0;
  }
  function where(b: MoneyBolo): string {
    return [b.venue_name, b.city].filter(Boolean).join(' · ') || b.project?.name || '—';
  }

  /** The why of an attention row, in words («68 days, usually pays at 45»). */
  function attentionWhy(item: AttentionItem): string {
    const b = item.bolo;
    const day = b.next_performed_at ? dayLabel(b.next_performed_at) : null;
    switch (item.kind) {
      case 'overdue': {
        const late = t(item.daysLate === 1 ? 'books.att_late_one' : 'books.att_late_many', locale, { n: item.daysLate });
        if (item.observedDays != null) return t('books.att_late_observed', locale, { late, days: Math.round(item.observedDays) });
        if (item.aging?.expectedOn) return t('books.att_late_expected', locale, { late, date: dayLabel(item.aging.expectedOn) });
        return late;
      }
      case 'to_invoice':
        return day ? t('books.att_to_invoice', locale, { date: day }) : t('books.att_to_invoice_nodate', locale);
      case 'draft':
        return day ? t('books.att_draft', locale, { date: day }) : t('books.att_draft_nodate', locale);
      case 'fiscal':
        return t('books.att_fiscal', locale);
      case 'no_fee':
        if (b.status === 'done') return day ? t('books.att_no_fee_done', locale, { date: day }) : t('books.att_no_fee_done_nodate', locale);
        return day ? t('books.att_no_fee', locale, { date: day }) : t('books.att_no_fee_nodate', locale);
    }
  }
  const ATTENTION_ACTION: Record<AttentionItem['kind'], string> = {
    overdue: 'books.record_payment',
    to_invoice: 'books.att_act_invoice',
    draft: 'books.att_act_issue',
    fiscal: 'books.att_act_fiscal',
    no_fee: 'books.att_act_fee',
  };
  function act(item: AttentionItem) {
    if (item.kind === 'overdue') openPay(item.bolo);
    else if (item.kind === 'to_invoice') openInvoice(item.bolo);
    else if (item.kind === 'no_fee') openFee(item.bolo);
    else if (item.doc) void showDocument(item.doc.id);
  }

  // ── The ledger ────────────────────────────────────────────────────────
  type Tab = 'bolos' | 'documents' | 'expenses';
  let tab = $state<Tab>('bolos');
  let filter = $state<LedgerFilter>('all');
  let expandedId = $state<string | null>(null);
  let focusInvoiceId = $state<string | null>(null);

  // «all» and «in progress» read the chosen season; owed, overdue and to
  // invoice are debts and read every season, so a chip counts exactly what
  // its figure says.
  function ledgerSource(f: LedgerFilter): MoneyBolo[] {
    return f === 'all' || f === 'in_progress' ? seasonBolos : bolos;
  }
  let filterCounts = $derived(
    Object.fromEntries(
      LEDGER_FILTERS.map((f) => [f, ledgerSource(f).filter((b) => matchesLedgerFilter(moneyOf(b), f)).length]),
    ) as Record<LedgerFilter, number>,
  );
  let ledgerRows = $derived(
    ledgerSource(filter)
      .filter((b) => matchesLedgerFilter(moneyOf(b), filter))
      .sort((a, c) => (a.next_performed_at ?? '9999').localeCompare(c.next_performed_at ?? '9999')),
  );
  type LedgerGroup = { projectId: string; name: string; accent: string; slug: string; workspaceId: string; rows: MoneyBolo[] };
  let ledgerGroups = $derived.by<LedgerGroup[]>(() => {
    const map = new Map<string, LedgerGroup>();
    for (const b of ledgerRows) {
      const key = b.project?.id ?? b.project_id;
      const group =
        map.get(key) ??
        {
          projectId: key,
          name: b.project?.name ?? '—',
          accent: b.project?.accent ?? 'var(--text-faint)',
          slug: b.project?.slug ?? '',
          workspaceId: b.project?.workspace_id ?? '',
          rows: [],
        };
      group.rows.push(b);
      map.set(key, group);
    }
    return [...map.values()];
  });
  /** Group by obra only when there is more than one: with one, the group is noise. */
  let grouped = $derived(ledgerGroups.length > 1);
  const FILTER_LABEL: Record<LedgerFilter, string> = {
    all: 'books.filter_all',
    owed: 'books.filter_owed',
    overdue: 'books.filter_overdue',
    to_invoice: 'books.filter_to_invoice',
    in_progress: 'books.filter_in_progress',
  };

  async function showLedger(f: LedgerFilter) {
    filter = f;
    tab = 'bolos';
    await tick();
    document.getElementById('mny-ledger')?.scrollIntoView({ block: 'start', behavior: 'smooth' });
  }
  async function showDocument(invoiceId: string) {
    tab = 'documents';
    focusInvoiceId = invoiceId;
    await tick();
    document.getElementById('mny-ledger')?.scrollIntoView({ block: 'start', behavior: 'smooth' });
  }
  /**
   * Bring one bolo into view, unfolded: its season (a July overdue lives in
   * last season's ledger), the filter in «all», the Bolos tab. The table waits
   * for invoices and expenses too (`loading`), so the scroll waits for the row
   * to exist, not for the bolos.
   */
  let pendingFocus = $state<string | null>(null);
  function focusBolo(id: string) {
    const target = bolos.find((b) => b.id === id);
    if (!target) return;
    const s = boloSeason(target, today);
    pickedSeason = s === currentSeason ? null : s;
    filter = 'all';
    tab = 'bolos';
    expandedId = id;
    pendingFocus = id;
    const url = new URL(location.href);
    url.hash = `bolo-${id}`;
    replaceState(url, {});
  }
  $effect(() => {
    const id = pendingFocus;
    if (!id || loading) return;
    void tick().then(() => {
      const row = document.getElementById(`bolo-${id}`);
      if (!row) return;
      row.scrollIntoView({ block: 'center' });
      pendingFocus = null;
    });
  });
  function toggleRow(b: MoneyBolo) {
    expandedId = expandedId === b.id ? null : b.id;
    const url = new URL(location.href);
    url.hash = expandedId ? `bolo-${expandedId}` : '';
    replaceState(url, {});
  }

  function collectLabel(m: BoloMoney): { tone: string; label: string } | null {
    if (m.overdue) return { tone: 'danger', label: t('books.pill_overdue', locale, { n: m.daysLate }) };
    if (m.toInvoice) return { tone: 'warn', label: t('books.filter_to_invoice', locale).toLowerCase() };
    if (m.collect === 'full') return { tone: 'ok', label: t('books.collected', locale) };
    if (m.collect === 'partial') return { tone: 'warn', label: t('books.pill_partial', locale) };
    if (m.collect === 'unpaid') return { tone: 'faint', label: t('books.pill_unpaid', locale) };
    return null;
  }

  let expensesByBolo = $derived.by(() => {
    const map = new Map<string, ExpenseItem[]>();
    for (const e of expenses) {
      if (!e.bolo_id) continue;
      map.set(e.bolo_id, [...(map.get(e.bolo_id) ?? []), e]);
    }
    return map;
  });

  // ── States ────────────────────────────────────────────────────────────
  let loading = $derived($bolosQuery.isLoading || $invoicesQuery.isLoading || $expensesQuery.isLoading);
  // aria-busy: the lens does not know what to draw until the pins resolve
  // against the indexes AND its feeds have answered (`tests/loaded.ts`).
  let busy = $derived(
    !noAccess &&
      ($accessQuery.isPending || $workspacesQuery.isPending || $projectsQuery.isPending || $linesQuery.isPending || loading),
  );
  const errText = (e: unknown) => (e instanceof Error ? e.message : '');
  let bolosError = $derived(errText($bolosQuery.error));
  let invoicesError = $derived(errText($invoicesQuery.error));
  let expensesError = $derived(errText($expensesQuery.error));
  let currencies = $derived([...new Set(bolos.map((b) => b.fee_currency ?? 'EUR'))].sort());
  /** With more than one currency every amount carries its code: a column of numbers invites summing. */
  let multiCurrency = $derived(currencies.length > 1);
  let expenseTotals = $derived(totalsByCurrency(expenses, (e) => e.currency, (e) => Number(e.amount)));
  let seasonEmpty = $derived(!loading && seasonBolos.length === 0 && attention.length === 0);
  let previousSeason = $derived(seasons.find((s) => s < season) ?? null);

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
  // With an issued document the payment goes against it, for what it still
  // lacks WITH taxes (ADR-123); without one, against the bolo's fee.
  let payInvoiceId = $state<string | null>(null);
  function openPay(b: MoneyBolo) {
    payBolo = b;
    const proposal = paymentProposal(b, moneyOf(b));
    payInvoiceId = proposal.invoiceId;
    payAmount = proposal.amount ? proposal.amount.toFixed(2) : '';
    payReceivedOn = localDayISO();
    payMethod = 'transfer';
    payCounterparty = proposal.counterparty;
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
        ...(payInvoiceId ? { invoice_id: payInvoiceId } : { bolo_id: payBolo!.id }),
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
      void queryClient.invalidateQueries({ queryKey: ['invoices'] });
      addToast({ tone: 'success', message: t(payInvoiceId ? 'books.payment_recorded_doc' : 'books.payment_recorded_fee', locale) });
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
  /** A chosen payer without fiscal data: a factura from it cannot be issued yet. */
  let invPayerNoFiscal = $derived(availablePayers.find((payer) => payer.id === iPayerId)?.has_fiscal_identity === false);
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
        payer_organization_id: iPayerId || null,
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
  // `#bolo-<id>` es la ficha del bolo: la fila existe solo cuando el feed
  // llega, así que el navegador no puede desplazarse solo. Una vez, cuando
  // llegan los bolos: `focusBolo`.
  let targetHandled = false;
  $effect(() => {
    if (targetHandled || !$bolosQuery.isSuccess || !location.hash.startsWith('#bolo-')) return;
    targetHandled = true;
    focusBolo(location.hash.slice('#bolo-'.length));
  });
</script>

<svelte:head>
  <title>{t('books.head_title', locale)}</title>
</svelte:head>

<section class="mny" aria-busy={busy}>
  <LensHeader>
    {#snippet title()}<LensTitle text={t('lens.money', locale)} />{/snippet}
    {#snippet sub()}
      {#if !noAccess}
        <span>{t('books.season_sub', locale, { season: seasonLabel(season) })}{#if obraNames.length === 1}&nbsp;· {obraNames[0]}{/if}</span>
        {#each seasons as s (s)}
          <button
            type="button"
            class="lenshead__frag mny__season"
            aria-current={s === season ? 'true' : undefined}
            onclick={() => (pickedSeason = s === currentSeason ? null : s)}
          >{seasonSpan(s)}</button>
        {/each}
      {/if}
    {/snippet}
  </LensHeader>

  {#if noAccess}
    <p class="mny__state" data-testid="money-no-access">{t('books.no_access', locale)}</p>
  {:else}
    <div class="mny__actions">
      <Button size="xs" variant="outline" onclick={openDeal} disabled={projectIndex.length === 0}>{t('books.new_deal', locale)}</Button>
    </div>

    {#if bolosError}
      <p class="mny__state mny__state--danger">{t('books.err_bolos', locale)} {bolosError}</p>
    {:else}
      <!-- 1 · Las cuatro cifras, una fila por moneda -->
      <div class="figs" aria-label={t('books.figures', locale)}>
        {#if loading}
          <div class="figs__row" aria-hidden="true">
            {#each ['books.fig_owed', 'books.fig_to_invoice', 'books.fig_inflow', 'books.fig_season'] as key (key)}
              <div class="fig"><span class="fig__label">{t(key, locale)}</span><span class="fig__num fig__num--skel">0.000</span></div>
            {/each}
          </div>
        {:else if !seasonEmpty}
          {#each position as pos (pos.currency)}
            <div class="figs__row" data-currency={pos.currency}>
              <button type="button" class="fig" data-fig="owed" onclick={() => showLedger('owed')}>
                <span class="fig__label">{t('books.fig_owed', locale)}</span>
                <span class="fig__num">{fmtMoneyCompact(pos.owed)}<span class="fig__cur">{pos.currency}</span></span>
                <span class="fig__sub">
                  {#if pos.overdue > 0}
                    <span class="fig__danger">{t('books.fig_overdue', locale, { amount: fmtMoneyCompact(pos.overdue) })}</span>
                    · {t(pos.owedCount === 1 ? 'books.fig_of_one' : 'books.fig_of_many', locale, { n: pos.owedCount })}
                  {:else if pos.owedCount > 0}
                    {t('books.fig_nothing_late', locale)} · {t(pos.owedCount === 1 ? 'books.fig_of_one' : 'books.fig_of_many', locale, { n: pos.owedCount })}
                  {:else}
                    {t('books.fig_owed_none', locale)}
                  {/if}
                </span>
              </button>
              <button type="button" class="fig" data-fig="to_invoice" onclick={() => showLedger('to_invoice')}>
                <span class="fig__label">{t('books.fig_to_invoice', locale)}</span>
                <span class="fig__num">{fmtMoneyCompact(pos.toInvoice)}<span class="fig__cur">{pos.currency}</span></span>
                <span class="fig__sub">{pos.toInvoiceCount === 0 ? t('books.fig_to_invoice_none', locale) : t(pos.toInvoiceCount === 1 ? 'books.fig_to_invoice_one' : 'books.fig_to_invoice_many', locale, { n: pos.toInvoiceCount })}</span>
              </button>
              <div class="fig" data-fig="inflow">
                <span class="fig__label">{t('books.fig_inflow', locale)}</span>
                <span class="fig__num">{fmtMoneyCompact(pos.inflow30)}<span class="fig__cur">{pos.currency}</span></span>
                <span class="fig__sub">{pos.inflow30Count === 0 ? t('books.fig_inflow_none', locale) : t(pos.inflow30Count === 1 ? 'books.fig_inflow_one' : 'books.fig_inflow_many', locale, { n: pos.inflow30Count })}</span>
              </div>
              <button type="button" class="fig" data-fig="season" onclick={() => showLedger('all')}>
                <span class="fig__label">{t('books.fig_season', locale)} {seasonLabel(season)}</span>
                <span class="fig__num">{fmtMoneyCompact(pos.collected)}<span class="fig__of">{t('books.fig_of_sold', locale, { amount: fmtMoneyCompact(pos.sold) })}</span></span>
                <span class="fig__bar" role="img" aria-label={t('books.fig_bar_aria', locale, { collected: fmtMoney(pos.collected), invoiced: fmtMoney(pos.invoicedOpen), uninvoiced: fmtMoney(pos.uninvoiced) })}>
                  {#each [['collected', pos.collected], ['invoiced', pos.invoicedOpen], ['open', pos.uninvoiced]] as [tone, value] (tone)}
                    {#if Number(value) > 0}<span class="mbar__seg" data-tone={tone} style={`inline-size:${pct(Number(value), pos.sold)}%`}></span>{/if}
                  {/each}
                </span>
                <span class="mkeys" aria-hidden="true">
                  <span><i class="mkey" data-tone="collected"></i>{t('books.key_collected', locale)}</span>
                  <span><i class="mkey" data-tone="invoiced"></i>{t('books.key_invoiced', locale)}</span>
                  <span><i class="mkey" data-tone="open"></i>{t('books.key_open', locale)}</span>
                </span>
                {#if pos.holds > 0}
                  <span class="fig__sub">{t('books.fig_holds', locale, { amount: fmtMoneyCompact(pos.holds), n: pos.holdsCount })}</span>
                {/if}
              </button>
            </div>
          {/each}
        {/if}
      </div>

      {#if seasonEmpty}
        <div class="mny__empty">
          <p class="mny__state">{t('books.season_empty', locale, { season: seasonLabel(season) })}</p>
          <div class="mny__empty-acts">
            <Button size="xs" onclick={openDeal} disabled={projectIndex.length === 0}>{t('books.new_deal', locale)}</Button>
            {#if previousSeason !== null}
              <Button size="xs" variant="outline" onclick={() => (pickedSeason = previousSeason)}>{t('books.season_previous', locale, { season: seasonLabel(previousSeason) })}</Button>
            {/if}
          </div>
        </div>
      {:else}
        <div class="radar">
          <!-- 2 · Pide atención -->
          <section class="att" aria-label={t('books.attention', locale)}>
            <header class="radar__head">
              <p class="eyebrow">{t('books.attention', locale)}{#if attention.length > 0}&nbsp;· {attention.length}{/if}</p>
              {#if attention.length > ATTENTION_VISIBLE}
                <button type="button" class="radar__more" onclick={() => (attentionAll = !attentionAll)}>
                  {attentionAll ? t('books.attention_less', locale) : t('books.attention_all', locale, { n: attention.length })}
                </button>
              {/if}
            </header>
            {#if invoicesError}
              <p class="mny__state mny__state--danger">{t('books.err_invoices', locale)}</p>
            {:else if loading}
              <p class="mny__state">{t('desk.loading', locale)}</p>
            {:else if attention.length === 0}
              <p class="mny__state">{t('books.attention_none', locale)}</p>
            {:else}
              <ul class="att__list" role="list">
                {#each attentionShown as item (item.kind + item.bolo.id)}
                  <li class="att__row" data-kind={item.kind}>
                    <span class="att__what">
                      <a class="att__who" href={`#bolo-${item.bolo.id}`} onclick={(e) => { e.preventDefault(); focusBolo(item.bolo.id); }}>
                        {item.doc?.payer?.name ?? item.bolo.venue_name ?? item.bolo.project?.name ?? '—'}
                      </a>
                      <span class="att__ctx">{[item.doc?.number ?? item.bolo.city, item.kind === 'fiscal' || item.kind === 'draft' ? invoiceStatusLabel('draft', locale) : null].filter(Boolean).map((x) => ` · ${x}`).join('')}</span>
                      <span class="att__why">{attentionWhy(item)}</span>
                    </span>
                    <span class="att__amt">{item.amount === null ? '·' : fmtMoney(item.amount)}{#if item.amount !== null && multiCurrency}&nbsp;{item.currency}{/if}</span>
                    <Button size="xs" variant="outline" onclick={() => act(item)}>{t(ATTENTION_ACTION[item.kind], locale)}</Button>
                  </li>
                {/each}
              </ul>
            {/if}
          </section>

          <!-- 3 · Lo que entra -->
          <section class="inflow" aria-label={t('books.inflow', locale)}>
            <header class="radar__head"><p class="eyebrow">{t('books.inflow', locale)}</p></header>
            {#if invoicesError}
              <p class="mny__state mny__state--danger">{t('books.err_invoices', locale)}</p>
            {:else if loading}
              <p class="mny__state">{t('desk.loading', locale)}</p>
            {:else}
              {#each inflow as f (f.currency)}
                {@const max = Math.max(1, ...f.months.map((m) => m.expected + m.contracted))}
                {#if inflow.length > 1}<p class="inflow__cur">{f.currency}</p>{/if}
                <ul class="inflow__list" role="list">
                  {#each f.months as m (m.month)}
                    <li class="inflow__row">
                      <span class="inflow__month">{monthLabel(m.month)}</span>
                      <span class="inflow__bar" aria-hidden="true">
                        {#if m.expected > 0}<span class="mbar__seg" data-tone="invoiced" style={`inline-size:${pct(m.expected, max)}%`}></span>{/if}
                        {#if m.contracted > 0}<span class="mbar__seg" data-tone="open" style={`inline-size:${pct(m.contracted, max)}%`}></span>{/if}
                      </span>
                      <span class="inflow__amt">{fmtMoneyCompact(m.expected)}{#if m.contracted > 0}<span class="inflow__con">{` + ${fmtMoneyCompact(m.contracted)}`}</span>{/if}</span>
                    </li>
                  {/each}
                </ul>
                {#if f.undated > 0}
                  <p class="mny__note">{t(f.undated === 1 ? 'books.inflow_undated_one' : 'books.inflow_undated_many', locale, { n: f.undated })}</p>
                {/if}
              {/each}
              <p class="mkeys">
                <span><i class="mkey" data-tone="invoiced"></i>{t('books.inflow_expected', locale)}</span>
                <span><i class="mkey" data-tone="open"></i>{t('books.inflow_contracted', locale)}</span>
              </p>
            {/if}
          </section>
        </div>
      {/if}

      <!-- 4 · El libro -->
      <section class="ledger" id="mny-ledger" aria-label={t('books.ledger', locale)}>
        <div class="ledger__tabs" role="tablist" aria-label={t('books.ledger', locale)}>
          <button type="button" role="tab" aria-selected={tab === 'bolos'} onclick={() => (tab = 'bolos')}>{t('books.tab_bolos', locale)}</button>
          {#if anyDocMode}
            <button type="button" role="tab" aria-selected={tab === 'documents'} onclick={() => (tab = 'documents')}>{t('books.documents', locale)}</button>
          {/if}
          <button type="button" role="tab" aria-selected={tab === 'expenses'} onclick={() => (tab = 'expenses')}>{t('books.expenses', locale)}</button>
        </div>

        {#if tab === 'bolos'}
          <div class="ledger__filters" role="group" aria-label={t('books.filters', locale)}>
            {#each LEDGER_FILTERS as f (f)}
              <Chip size="xs" selected={filter === f} onclick={() => (filter = f)}>
                {t(FILTER_LABEL[f], locale)}
                {#snippet tail()}<span class="ledger__count">{loading ? DASH : filterCounts[f]}</span>{/snippet}
              </Chip>
            {/each}
          </div>

          {#if loading}
            <p class="mny__state">{t('desk.loading', locale)}</p>
          {:else if ledgerRows.length === 0}
            <p class="mny__state">{t(filter === 'all' ? 'books.ledger_empty' : 'books.ledger_empty_filter', locale)}</p>
          {:else}
            <table class="book">
              <thead>
                <tr>
                  <th scope="col">{t('books.col_date', locale)}</th>
                  <th scope="col">{t('books.col_venue', locale)}</th>
                  <th scope="col">{t('books.col_status', locale)}</th>
                  <th scope="col">{t('books.col_doc', locale)}</th>
                  <th scope="col" class="book__num">{t('books.fee', locale)}</th>
                  <th scope="col" class="book__num">{t('books.collected', locale)}</th>
                  <th scope="col">{t('books.col_collect', locale)}</th>
                </tr>
              </thead>
              {#each ledgerGroups as group (group.projectId)}
                <tbody style={`--c: ${group.accent}`}>
                  {#if grouped}
                    <tr class="book__group">
                      <th colspan="7" scope="rowgroup">
                        <button type="button" class="book__obra" onclick={() => group.slug && openProject(group.slug, group.workspaceId)} disabled={!group.slug}>
                          <span class="book__dot"></span>{group.name}
                        </button>
                      </th>
                    </tr>
                  {/if}
                  {#each group.rows as b (b.id)}
                    {@const m = moneyOf(b)}
                    {@const pill = collectLabel(m)}
                    {@const open = expandedId === b.id}
                    <tr class="book__row" class:is-open={open} id={`bolo-${b.id}`} data-overdue={m.overdue || undefined}>
                      <td class="book__date">{b.next_performed_at ? dayLabel(b.next_performed_at) : t('books.no_date', locale)}{#if b.function_count > 1}<span class="book__fns">{` · ${t('books.fn_count', locale, { n: b.function_count })}`}</span>{/if}</td>
                      <td class="book__venue">
                        <button type="button" class="book__toggle" aria-expanded={open} aria-controls={`bolo-sheet-${b.id}`} onclick={() => toggleRow(b)}>
                          {b.venue_name || '—'}{#if b.city}<span class="book__city">{` · ${b.city}`}</span>{/if}
                        </button>
                      </td>
                      <td class="book__status"><StateBadge label={boloStatusLabel(b.status, locale)} tone={performanceStatusTone(b.status)} /></td>
                      <td class="book__doc">{#if m.doc}<span class="book__chip">{m.doc.number ?? invoiceStatusLabel(m.doc.status, locale)}</span>{:else}<span class="book__faint">·</span>{/if}</td>
                      <td class="book__num"><button type="button" class="book__fee" title={t('books.edit_fee', locale)} onclick={() => openFee(b)}>{b.fee_amount === null ? t('books.no_fee', locale) : fmtMoney(Number(b.fee_amount))}</button>{#if multiCurrency && b.fee_amount !== null}<span class="book__cur">{m.currency}</span>{/if}</td>
                      <td class="book__num">{#if m.fee === null && !m.doc}·{:else}{fmtMoney(m.collected)}{#if multiCurrency}<span class="book__cur">{m.currency}</span>{/if}{/if}</td>
                      <td class="book__collect">{#if pill}<span class="pill" data-tone={pill.tone}>{pill.label}</span>{/if}</td>
                    </tr>
                    {#if open}
                      {@const docs = docsByBolo.get(b.id) ?? []}
                      {@const spent = expensesByBolo.get(b.id) ?? []}
                      {@const mode = boloMode(b)}
                      <tr class="book__sheet" id={`bolo-sheet-${b.id}`}>
                        <td colspan="7">
                          <div class="sheet">
                            <div class="sheet__col">
                              <p class="sheet__h">{t('books.sheet_functions', locale)}</p>
                              <p>{b.next_performed_at ? dayLabel(b.next_performed_at) : t('books.no_date', locale)} · {t(b.function_count === 1 ? 'books.sheet_fn_one' : 'books.sheet_fn_many', locale, { n: b.function_count })}</p>
                              {#if b.project}<p class="sheet__faint">{b.project.name}</p>{/if}
                            </div>
                            <div class="sheet__col">
                              <p class="sheet__h">{t('books.documents', locale)}</p>
                              {#if docs.length === 0}
                                <p class="sheet__faint">{t('books.sheet_no_doc', locale)}</p>
                              {:else}
                                {#each docs as d (d.id)}
                                  <p>
                                    <button type="button" class="sheet__link" onclick={() => void showDocument(d.id)}>{d.number ?? invoiceStatusLabel(d.status, locale)}</button>
                                    · {invoiceStatusLabel(d.status, locale)} · {fmtMoney(Number(d.total))} {d.currency}
                                  </p>
                                  {#if d.id === m.doc?.id && m.aging?.expectedOn && d.status === 'issued'}
                                    <p class="sheet__faint" class:sheet__danger={m.overdue}>{t('books.sheet_expected', locale, { date: dayLabel(m.aging.expectedOn) })}{#if d.payer}{` · ${d.payer.name}`}{/if}</p>
                                  {/if}
                                {/each}
                              {/if}
                            </div>
                            <div class="sheet__col">
                              <p class="sheet__h">{t('books.sheet_money', locale)}</p>
                              <p>{t('books.collected_of', locale, { collected: fmtMoney(m.collected), fee: m.fee === null ? '·' : fmtMoney(m.fee) })}</p>
                              {#if spent.length > 0}
                                <p class="sheet__faint">{t('books.expenses', locale)}: {spent.map((e) => `${e.description} ${fmtMoney(Number(e.amount))}`).join(' · ')}</p>
                              {/if}
                            </div>
                            <div class="sheet__acts">
                              <Button size="xs" variant="outline" onclick={() => openPay(b)}>{t('books.record_payment', locale)}</Button>
                              <Button size="xs" variant="outline" onclick={() => openExpense(b)}>{t('books.add_expense', locale)}</Button>
                              {#if mode !== 'off' && !m.doc}
                                <Button size="xs" variant="outline" onclick={() => openInvoice(b)}>{t(mode === 'interno' ? 'books.create_proforma' : 'books.create_invoice', locale)}</Button>
                              {/if}
                            </div>
                          </div>
                        </td>
                      </tr>
                    {/if}
                  {/each}
                </tbody>
              {/each}
            </table>
          {/if}
        {:else if tab === 'documents'}
          {#if invoicesError}
            <p class="mny__state mny__state--danger">{t('books.err_invoices', locale)} {invoicesError}</p>
          {:else}
            <MoneyInvoices {invoices} {payers} focusId={focusInvoiceId} />
          {/if}
        {:else}
          <div class="mny__section-head">
            {#if expenseTotals.length > 0}
              <p class="mny__expense-totals">
                {#each expenseTotals as [currency, amount] (currency)}<span>− {fmtMoney(amount)} {currency}</span>{/each}
              </p>
            {/if}
            <Button size="xs" variant="outline" onclick={() => openExpense()} disabled={expenseAnchorOptions.length === 0}>{t('books.add_expense', locale)}</Button>
          </div>
          {#if expensesError}
            <p class="mny__state mny__state--danger">{t('books.err_expenses', locale)} {expensesError}</p>
          {:else if expenses.length === 0}
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
        {/if}
      </section>
    {/if}
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
  <p class="mny__dialog-note">{t(payInvoiceId ? 'books.pay_note_doc' : 'books.pay_note', locale)}</p>
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
      <Select
        label={t('books.payer', locale)}
        bind:value={iPayerId}
        helper={invDocType === 'factura' && invPayerNoFiscal ? t('books.payer_fiscal_later', locale) : undefined}
      >
        <option value="">{t('books.payer_linked', locale)}</option>
        {#each availablePayers as payer (payer.id)}
          <option value={payer.id}>{payer.name}{payer.has_fiscal_identity ? '' : ` · ${t('books.payer_no_fiscal', locale)}`}</option>
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
    /* The three states of the money, one grammar for both bars (season and
       «lo que entra»): collected, invoiced and not collected, contracted and
       not invoiced. Separated by lightness, not by a mix that fades into the
       track: in light they step up from the green toward the track, in dark
       they step down, because the mixes go toward --bg-light either way. */
    .mny {
      display: flex; flex-direction: column; gap: var(--space-l);
      --money-collected: var(--success);
      --money-invoiced: color-mix(in oklch, var(--success) 60%, var(--bg-light));
      --money-open: color-mix(in oklch, var(--text-color) 16%, var(--bg-light));
    }
    .mbar__seg, .mkey { display: block; background: var(--mbar-tone); }
    .mbar__seg { block-size: 100%; }
    [data-tone='collected'] { --mbar-tone: var(--money-collected); }
    [data-tone='invoiced'] { --mbar-tone: var(--money-invoiced); }
    [data-tone='open'] { --mbar-tone: var(--money-open); }
    .mkeys { display: flex; flex-wrap: wrap; gap: var(--space-2xs) var(--space-m); font-size: var(--text-xs); color: var(--text-muted); }
    .mkeys span { display: inline-flex; align-items: center; gap: var(--space-2xs); }
    .mkey { inline-size: 0.75rem; block-size: 0.5rem; border-radius: 2px; }
    .mny__actions { display: flex; justify-content: flex-end; margin-block-end: calc(-1 * var(--space-m)); }
    .mny__season { appearance: none; border: 0; background: none; padding: 0; font: inherit; cursor: pointer; }
    .mny__state { font-size: var(--text-s); color: var(--text-faint); }
    .mny__state--danger { color: var(--danger); }
    .mny__note { font-size: var(--text-xs); color: var(--text-faint); }
    .mny__empty { display: flex; flex-direction: column; gap: var(--space-s); align-items: flex-start; }
    .mny__empty-acts { display: flex; gap: var(--space-xs); flex-wrap: wrap; }
    .mny__section-head { display: flex; align-items: baseline; justify-content: space-between; gap: var(--space-m); }

    /* ── 1 · the four figures ── */
    .figs { display: flex; flex-direction: column; gap: var(--space-s); }
    .figs__row { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: var(--space-s); }
    .fig {
      appearance: none; text-align: start; font: inherit; color: inherit;
      display: flex; flex-direction: column; gap: var(--space-2xs);
      padding: var(--space-s) var(--space-m); border: 1px solid var(--border-color-light);
      border-radius: var(--radius-m); background: var(--bg-ultra-light); min-inline-size: 0;
    }
    button.fig { cursor: pointer; transition: border-color var(--transition); }
    button.fig:hover { border-color: var(--text-faint); }
    .fig__label { font-family: var(--font-mono); font-size: var(--text-xs); letter-spacing: 0.08em; text-transform: uppercase; color: var(--text-faint); }
    .fig__num { font-family: var(--font-display); font-size: var(--text-xl); line-height: 1.1; color: var(--text-color); font-variant-numeric: tabular-nums; display: flex; align-items: baseline; gap: var(--space-2xs); flex-wrap: wrap; }
    .fig__num--skel { color: transparent; background: var(--bg-light); border-radius: var(--radius-s); inline-size: 6ch; }
    .fig__cur, .fig__of { font-family: var(--font-mono); font-size: var(--text-xs); color: var(--text-muted); letter-spacing: 0.04em; }
    .fig__sub { font-size: var(--text-xs); color: var(--text-muted); }
    .fig__danger { color: var(--danger); }
    .fig__bar { display: flex; gap: 2px; block-size: 6px; border-radius: var(--radius-circle); background: var(--bg-light); overflow: hidden; margin-block: var(--space-2xs); }

    /* ── 2 + 3 · the radar ── */
    .radar { display: grid; grid-template-columns: minmax(0, 3fr) minmax(0, 2fr); gap: var(--space-l); align-items: start; }
    .radar__head { display: flex; align-items: baseline; justify-content: space-between; gap: var(--space-m); padding-block-end: var(--space-xs); border-block-end: 1px solid var(--border-color-light); margin-block-end: var(--space-xs); }
    .radar__more { appearance: none; border: 0; background: none; padding: 0; font: inherit; font-size: var(--text-xs); color: var(--text-muted); cursor: pointer; }
    .radar__more:hover { color: var(--text-color); }
    .att__list { display: flex; flex-direction: column; }
    .att__row { display: grid; grid-template-columns: minmax(0, 1fr) auto auto; gap: var(--space-m); align-items: center; padding-block: var(--space-xs); border-block-end: 1px solid var(--border-color-light); }
    .att__what { min-inline-size: 0; display: flex; flex-wrap: wrap; column-gap: var(--space-2xs); align-items: baseline; }
    .att__who { color: var(--text-color); font-weight: 500; text-decoration: none; }
    .att__who:hover { text-decoration: underline; }
    .att__ctx { font-size: var(--text-s); color: var(--text-muted); }
    .att__why { inline-size: 100%; font-size: var(--text-xs); color: var(--text-muted); }
    .att__row[data-kind='overdue'] .att__why { color: var(--danger); }
    .att__amt { font-family: var(--font-mono); font-size: var(--text-s); font-variant-numeric: tabular-nums; color: var(--text-color); white-space: nowrap; }
    .inflow__cur { font-family: var(--font-mono); font-size: var(--text-xs); color: var(--text-muted); }
    .inflow__list { display: flex; flex-direction: column; gap: var(--space-xs); padding-block: var(--space-2xs); }
    .inflow__row { display: grid; grid-template-columns: 3.5ch minmax(0, 1fr) auto; gap: var(--space-s); align-items: center; }
    .inflow__month { font-family: var(--font-mono); font-size: var(--text-xs); color: var(--text-muted); text-transform: lowercase; }
    .inflow__bar { display: flex; gap: 2px; block-size: 10px; border-radius: var(--radius-s); background: var(--bg-light); overflow: hidden; }
    .inflow__amt { font-family: var(--font-mono); font-size: var(--text-xs); font-variant-numeric: tabular-nums; color: var(--text-color); white-space: nowrap; }
    .inflow__con { color: var(--text-faint); }

    /* ── 4 · the ledger ── */
    .ledger { display: flex; flex-direction: column; gap: var(--space-s); scroll-margin-block-start: var(--space-l); }
    .ledger__tabs { display: flex; gap: var(--space-m); border-block-end: 1px solid var(--border-color-light); }
    .ledger__tabs button { appearance: none; border: 0; background: none; font: inherit; font-size: var(--text-s); color: var(--text-muted); padding: var(--space-xs) 0; border-block-end: 2px solid transparent; margin-block-end: -1px; cursor: pointer; }
    .ledger__tabs button[aria-selected='true'] { color: var(--text-color); border-block-end-color: var(--text-color); }
    .ledger__filters { display: flex; gap: var(--space-xs); flex-wrap: wrap; }
    .ledger__filters :global(button) { white-space: nowrap; flex-shrink: 0; }
    .ledger__count { font-family: var(--font-mono); font-size: var(--text-xs); color: var(--text-faint); margin-inline-start: var(--space-2xs); }
    .book { inline-size: 100%; border-collapse: collapse; font-size: var(--text-s); }
    .book th { text-align: start; font-family: var(--font-mono); font-size: var(--text-xs); font-weight: 400; letter-spacing: 0.06em; text-transform: uppercase; color: var(--text-faint); padding: var(--space-2xs) var(--space-xs); border-block-end: 1px solid var(--border-color-light); }
    .book td { padding: var(--space-xs); border-block-end: 1px solid var(--border-color-light); vertical-align: baseline; }
    .book__num { text-align: end !important; font-family: var(--font-mono); font-variant-numeric: tabular-nums; white-space: nowrap; }
    .book__row { scroll-margin-block: var(--space-xl); }
    .book__row:hover, .book__row.is-open { background: color-mix(in oklch, var(--bg-light) 55%, transparent); }
    .book__row[data-overdue] .book__date { color: var(--danger); }
    .book__date { font-family: var(--font-mono); font-size: var(--text-xs); color: var(--text-muted); white-space: nowrap; }
    .book__fns, .book__city, .book__faint { color: var(--text-faint); }
    .book__toggle { appearance: none; border: 0; background: none; padding: 0; font: inherit; color: var(--text-color); font-weight: 500; cursor: pointer; text-align: start; }
    .book__toggle:hover { text-decoration: underline; }
    .book__city { font-weight: 400; }
    .book__chip { font-family: var(--font-mono); font-size: var(--text-xs); color: var(--text-muted); padding: 1px 8px; border: 1px solid var(--border-color-dark); border-radius: var(--radius-circle); white-space: nowrap; }
    .book__cur { margin-inline-start: 0.5ch; font-size: var(--text-xs); color: var(--text-muted); letter-spacing: 0.04em; }
    .book__fee { appearance: none; border: 0; background: none; padding: 0; font: inherit; color: var(--text-color); cursor: pointer; }
    .book__fee:hover { text-decoration: underline; }
    .book__group th { padding-block-start: var(--space-m); text-transform: none; letter-spacing: 0; }
    .book__obra { display: inline-flex; align-items: center; gap: var(--space-xs); border: 0; background: none; padding: 0; font: inherit; font-family: var(--font-sans); font-size: var(--text-s); color: var(--text-color); cursor: pointer; }
    .book__obra:disabled { cursor: default; }
    .book__dot { inline-size: 0.5rem; block-size: 0.5rem; border-radius: var(--radius-circle); background: var(--c); }
    .book__sheet td { background: color-mix(in oklch, var(--bg-light) 55%, transparent); padding: var(--space-s) var(--space-m) var(--space-m); }
    .sheet { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: var(--space-m); font-size: var(--text-s); }
    .sheet p { margin: 0; }
    .sheet__col { display: flex; flex-direction: column; gap: var(--space-2xs); min-inline-size: 0; }
    .sheet__h { font-family: var(--font-mono); font-size: var(--text-xs); letter-spacing: 0.06em; text-transform: uppercase; color: var(--text-faint); }
    .sheet__faint { color: var(--text-muted); font-size: var(--text-xs); }
    .sheet__danger { color: var(--danger); }
    .sheet__link { appearance: none; border: 0; background: none; padding: 0; font: inherit; font-family: var(--font-mono); font-size: var(--text-xs); color: var(--text-color); text-decoration: underline; cursor: pointer; }
    .sheet__acts { grid-column: 1 / -1; display: flex; gap: var(--space-xs); flex-wrap: wrap; }
    .pill {
      display: inline-block; font-family: var(--font-mono); font-size: var(--text-xs); letter-spacing: 0.04em;
      text-transform: lowercase; padding: 2px 8px; border-radius: var(--radius-circle);
      border: 1px solid var(--border-color-dark); color: var(--text-muted); white-space: nowrap;
    }
    .pill[data-tone='ok'] { color: var(--success); border-color: color-mix(in oklch, var(--success) 42%, var(--border-color-light)); }
    .pill[data-tone='warn'] { color: var(--warning); border-color: color-mix(in oklch, var(--warning) 42%, var(--border-color-light)); }
    .pill[data-tone='danger'] { color: var(--danger); border-color: color-mix(in oklch, var(--danger) 42%, var(--border-color-light)); }
    .pill[data-tone='faint'] { color: var(--text-faint); }

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
      .figs__row { grid-template-columns: repeat(2, minmax(0, 1fr)); }
      .radar { grid-template-columns: 1fr; }
      .att__row { grid-template-columns: minmax(0, 1fr) auto; }
      .att__row :global(.btn) { grid-column: 1 / -1; justify-self: stretch; }
      .ledger__filters { flex-wrap: nowrap; overflow-x: auto; scrollbar-width: none; }
      .book thead { display: none; }
      .book, .book tbody { display: block; }
      .book__row {
        display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 2px var(--space-s);
        padding-block: var(--space-xs); border-block-end: 1px solid var(--border-color-light);
      }
      .book__row td { padding: 0; border: 0; }
      .book__venue { grid-column: 1; grid-row: 1; }
      .book__row .book__num:nth-of-type(5) { grid-column: 2; grid-row: 1; }
      .book__date { grid-column: 1; grid-row: 2; }
      .book__collect { grid-column: 2; grid-row: 2; justify-self: end; }
      .book__status, .book__doc, .book__row .book__num:nth-of-type(6) { display: none; }
      .book__group, .book__sheet { display: block; }
      .book__group th, .book__sheet td { display: block; }
      .sheet { grid-template-columns: 1fr; }
      .sheet__acts { flex-direction: column; align-items: stretch; }
      .mny__expenses li { grid-template-columns: 1fr auto; gap: var(--space-2xs) var(--space-s); }
      .mny__expense-description { grid-column: 1 / -1; }
      .mny__expenses strong { grid-column: 2; grid-row: 1; }
      .mny__row2, .mny__inv-form, .mny__fee-form { grid-template-columns: 1fr; }
    }
  }
</style>
