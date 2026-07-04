<script lang="ts">
  /**
   * Money lens — Phase 0.3 (ADR-046). Read path is `performance_redacted`
   * (fees NULLed without read:money); fee editing lives HERE by design —
   * ADR-043 deliberately kept fee out of the performance write path.
   *
   * Invoices (ADR-050): created FROM a gig's fee (one line, amounts
   * snapshot the fee + VAT/IRPF at creation — later fee edits don't
   * retro-edit). Lifecycle: draft → issued → paid, cancelled from
   * anywhere; only drafts can be discarded.
   *
   * Filter = sidebar selection (ADR-038), like every lens.
   */

  import { createMutation, createQuery, useQueryClient } from '@tanstack/svelte-query';
  import { toStore } from 'svelte/store';
  import { page } from '$app/state';
  import { fetchJSON } from '$lib/api';
  import Button from '$lib/components/Button.svelte';
  import Dialog from '$lib/components/Dialog.svelte';
  import Input from '$lib/components/Input.svelte';
  import Menu from '$lib/components/Menu.svelte';
  import StateBadge from '$lib/components/StateBadge.svelte';
  import { addToast } from '$lib/components/Toast.svelte';
  import ScopeStrip from '$lib/components/ScopeStrip.svelte';
  import { dayLabel } from '$lib/datetime';
  import { performanceStatusLabel, performanceStatusTone } from '$lib/performance';
  import { usePins } from '$lib/stores/pins.svelte';
  import {
    buildLineIndex,
    resolveScope,
    lineUrl,
    type NavLine,
    type NavWorkspace,
    type RawLine,
  } from '$lib/nav';
  import { allLinesQueryOptions } from '$lib/nav-queries';
  import { lineKindGlyph, lineKindLabel } from '$lib/utils/line-kind';
  import { goto } from '$app/navigation';

  type WorkspaceLite = { id: string; slug: string };
  type ProjectLite = { id: string; slug: string };

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
    project: {
      id: string;
      slug: string;
      name: string;
      workspace_id: string;
    } | null;
  };

  type InvoiceItem = {
    id: string;
    number: string | null;
    status: string;
    issued_on: string;
    total: number;
    currency: string;
    project: { name: string } | null;
    payer: { full_name: string; organization_name: string | null } | null;
  };

  const pins = usePins();

  const workspacesQuery = createQuery({
    queryKey: ['workspaces'],
    queryFn: ({ signal }: { signal: AbortSignal }) =>
      fetchJSON<{ items: WorkspaceLite[] }>('/api/workspaces', signal),
  });
  const projectsQuery = createQuery({
    queryKey: ['projects', { status: 'active' }],
    queryFn: ({ signal }: { signal: AbortSignal }) =>
      fetchJSON<{ items: ProjectLite[] }>('/api/projects?status=active', signal),
  });
  const linesQuery = createQuery(allLinesQueryOptions());

  let workspaceSlugById = $derived(
    new Map(($workspacesQuery.data?.items ?? []).map((w) => [w.id, w.slug])),
  );

  // ── Pins → scope (Adaptive Digest) ────────────────────────────────────
  let lineIndex = $derived(
    buildLineIndex(($workspacesQuery.data?.items ?? []) as NavWorkspace[], ($linesQuery.data?.items as RawLine[]) ?? []),
  );
  let scope = $derived(resolveScope(pins.pins, ($workspacesQuery.data?.items ?? []) as NavWorkspace[], lineIndex));
  let lineById = $derived(new Map(lineIndex.map((l) => [l.id, l])));
  let linePinProjectIds = $derived(new Set(scope.lines.map((l) => l.projectId)));
  let scopeUnresolved = $derived(
    pins.lineIds().length > 0 && scope.lines.length !== pins.lineIds().length,
  );

  function feedParams(k: { projectIds: string[]; workspaceIds: string[] }): string {
    const p = new URLSearchParams();
    if (k.projectIds.length > 0) p.set('project_ids', k.projectIds.join(','));
    if (k.workspaceIds.length > 0) p.set('workspace_ids', k.workspaceIds.join(','));
    return p.toString();
  }
  let filterIds = $derived({
    projectIds: [...linePinProjectIds],
    workspaceIds: scope.workspaceIds,
  });

  function openLine(line: NavLine) {
    void goto(lineUrl(line));
  }

  const feesOptions = toStore(() => {
    const k = { ...filterIds, unresolved: scopeUnresolved };
    return {
      queryKey: ['money-performances', { p: k.projectIds, w: k.workspaceIds }] as const,
      enabled: !k.unresolved,
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        fetchJSON<{ items: MoneyPerformance[] }>(
          `/api/money/performances?${feedParams(k)}`,
          signal,
        ),
    };
  });
  const invoicesOptions = toStore(() => {
    const k = { ...filterIds, unresolved: scopeUnresolved };
    return {
      queryKey: ['invoices', { p: k.projectIds, w: k.workspaceIds }] as const,
      enabled: !k.unresolved,
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        fetchJSON<{ items: InvoiceItem[] }>(`/api/invoices?${feedParams(k)}`, signal),
    };
  });

  const feesQuery = createQuery(feesOptions);
  const invoicesQuery = createQuery(invoicesOptions);

  // Exact-line narrowing (the endpoint returns a pinned line's whole project).
  function feeInScope(f: MoneyPerformance): boolean {
    if (scope.isEmpty) return true;
    const ws = f.project?.workspace_id;
    if (ws && scope.workspaceIds.includes(ws)) return true;
    if (f.line_id && scope.lineIds.includes(f.line_id)) return true;
    return false;
  }
  let fees = $derived(($feesQuery.data?.items ?? []).filter(feeInScope));
  let invoices = $derived($invoicesQuery.data?.items ?? []);

  // ── Roll-up by line (the Money-by-line view) ──────────────────────────
  type LineRoll = {
    key: string;
    name: string;
    kind: string;
    projectName: string;
    accent: string;
    line: NavLine | null;
    confirmed: number;
    holds: number;
    dates: number;
  };
  let byLine = $derived.by<LineRoll[]>(() => {
    const map = new Map<string, LineRoll>();
    for (const f of fees) {
      const line = (f.line_id ? lineById.get(f.line_id) : null) ?? null;
      const key = f.line_id ?? `loose:${f.project?.id ?? 'none'}`;
      if (!map.has(key)) {
        map.set(key, {
          key,
          name: line?.name ?? 'One-offs',
          kind: line?.kind ?? 'oneoff',
          projectName: line?.projectName ?? f.project?.name ?? '—',
          accent: line?.accent ?? 'var(--text-faint)',
          line,
          confirmed: 0,
          holds: 0,
          dates: 0,
        });
      }
      const rec = map.get(key)!;
      if (f.fee_amount != null) {
        if (['confirmed', 'done', 'invoiced', 'paid'].includes(f.status)) {
          rec.confirmed += f.fee_amount;
          rec.dates += 1;
        } else if (f.status.startsWith('hold')) {
          rec.holds += f.fee_amount;
        }
      }
    }
    return [...map.values()]
      .filter((r) => r.confirmed || r.holds)
      .sort((a, b) => b.confirmed - a.confirmed);
  });
  let byLineMax = $derived(Math.max(1, ...byLine.map((l) => l.confirmed + l.holds)));
  let loading = $derived($feesQuery.isLoading);
  let errorMsg = $derived(
    $feesQuery.error instanceof Error ? $feesQuery.error.message : '',
  );

  const money = new Intl.NumberFormat('en-GB', { minimumFractionDigits: 2 });

  function fmtFee(amount: number | null, currency: string | null): string {
    if (amount === null) return '—';
    return `${money.format(amount)} ${currency ?? 'EUR'}`;
  }

  /** Sums per lifecycle bucket, over the rows currently listed. */
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

  function perfHref(f: MoneyPerformance): string | null {
    if (!f.slug || !f.project) return null;
    const ws = workspaceSlugById.get(f.project.workspace_id) ?? page.params.workspace;
    return `/h/${ws}/performance/${f.slug}`;
  }

  // ── Fee editor ────────────────────────────────────────────────────────
  const queryClient = useQueryClient();
  let dialogOpen = $state(false);
  let editing = $state<MoneyPerformance | null>(null);
  let fAmount = $state('');
  let fCurrency = $state('EUR');

  function openFee(f: MoneyPerformance) {
    editing = f;
    fAmount = f.fee_amount === null ? '' : String(f.fee_amount);
    fCurrency = f.fee_currency ?? 'EUR';
    dialogOpen = true;
  }

  const feeMutation = createMutation({
    mutationFn: async (input: { id: string; fee_amount: number | null; fee_currency: string }) => {
      const res = await fetch(`/api/money/performances/${input.id}`, {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${localStorage.getItem('hour_jwt')}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          fee_amount: input.fee_amount,
          fee_currency: input.fee_currency,
        }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        performance?: unknown;
        hint?: string;
        detail?: string;
        error?: string;
      };
      if (!res.ok || !body.performance) {
        throw new Error(body.hint || body.detail || body.error || `Error ${res.status}`);
      }
      return body.performance;
    },
    onSuccess: () => {
      dialogOpen = false;
      editing = null;
      void queryClient.invalidateQueries({ queryKey: ['money-performances'] });
    },
    onError: (err) => {
      addToast({
        tone: 'danger',
        title: 'Fee not saved',
        message: `${err instanceof Error ? err.message : 'Unexpected error'} — try again.`,
      });
    },
  });

  function saveFee() {
    if (!editing) return;
    // type=number binds a number (or undefined on empty) through Svelte —
    // normalize via String before deciding empty-vs-value.
    const trimmed = String(fAmount ?? '').trim();
    const amount = trimmed === '' ? null : Number(trimmed);
    if (amount !== null && (Number.isNaN(amount) || amount < 0)) {
      addToast({ tone: 'warning', message: 'Fee must be a positive number (or empty to clear).' });
      return;
    }
    $feeMutation.mutate({ id: editing.id, fee_amount: amount, fee_currency: fCurrency });
  }

  // ── Invoice creation (ADR-050) ────────────────────────────────────────
  const INVOICE_STATUSES = ['draft', 'issued', 'paid', 'cancelled'] as const;

  function invoiceTone(status: string): 'neutral' | 'warning' | 'faint' | 'danger' {
    if (status === 'issued') return 'warning';
    if (status === 'paid') return 'faint';
    if (status === 'cancelled') return 'danger';
    return 'neutral';
  }

  let invOpen = $state(false);
  let invPerf = $state<MoneyPerformance | null>(null);
  let iVat = $state('');
  let iIrpf = $state('');
  let iNumber = $state('');
  let iDueOn = $state('');
  let iNotes = $state('');

  function openInvoice(f: MoneyPerformance) {
    invPerf = f;
    iVat = '';
    iIrpf = '';
    iNumber = '';
    iDueOn = '';
    iNotes = '';
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
      const res = await fetch('/api/invoices', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${localStorage.getItem('hour_jwt')}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          performance_id: invPerf!.id,
          vat_pct: pctOrNull(iVat),
          irpf_pct: pctOrNull(iIrpf),
          number: iNumber.trim() || null,
          due_on: iDueOn || null,
          notes: iNotes.trim() || null,
        }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        invoice?: unknown;
        detail?: string;
        error?: string;
      };
      if (!res.ok || !body.invoice) {
        throw new Error(body.detail || body.error || `Error ${res.status}`);
      }
      return body.invoice;
    },
    onSuccess: () => {
      invOpen = false;
      invPerf = null;
      void queryClient.invalidateQueries({ queryKey: ['invoices'] });
      addToast({ tone: 'success', message: 'Draft invoice created.' });
    },
    onError: (err) => {
      addToast({
        tone: 'danger',
        title: 'Invoice not created',
        message: err instanceof Error ? err.message : 'Unexpected error',
      });
    },
  });

  function submitInvoice() {
    const vat = pctOrNull(iVat);
    const irpf = pctOrNull(iIrpf);
    for (const p of [vat, irpf]) {
      if (p !== null && (Number.isNaN(p) || p < 0 || p > 100)) {
        addToast({ tone: 'warning', message: 'VAT / IRPF must be a percentage 0–100 (or empty).' });
        return;
      }
    }
    $createInvoice.mutate();
  }

  const invoiceStatusMutation = createMutation({
    mutationFn: async (input: { id: string; status: string }) => {
      const res = await fetch(`/api/invoices/${input.id}`, {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${localStorage.getItem('hour_jwt')}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ status: input.status }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        invoice?: unknown;
        detail?: string;
        error?: string;
      };
      if (!res.ok || !body.invoice) {
        throw new Error(body.detail || body.error || `Error ${res.status}`);
      }
      return body.invoice;
    },
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['invoices'] }),
    onError: (err) => {
      addToast({
        tone: 'danger',
        title: 'Status not changed',
        message: err instanceof Error ? err.message : 'Unexpected error',
      });
    },
  });

  const discardInvoice = createMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/invoices/${id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${localStorage.getItem('hour_jwt')}` },
      });
      if (!res.ok && res.status !== 204) {
        const body = (await res.json().catch(() => ({}))) as { detail?: string; error?: string };
        throw new Error(body.detail || body.error || `Error ${res.status}`);
      }
    },
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['invoices'] }),
    onError: (err) => {
      addToast({
        tone: 'danger',
        title: 'Draft not discarded',
        message: err instanceof Error ? err.message : 'Unexpected error',
      });
    },
  });
</script>

<svelte:head>
  <title>Money — Hour</title>
</svelte:head>

<section class="mny">
  <header class="mny__head">
    <p class="eyebrow">Money</p>
    <ScopeStrip onOpenLine={openLine} compact />
    <div class="mny__totals">
      <span class="mny__total">
        <span class="mny__total-label">pipeline</span>
        {money.format(totals.pipeline)}
      </span>
      <span class="mny__total">
        <span class="mny__total-label">invoiced</span>
        {money.format(totals.invoiced)}
      </span>
      <span class="mny__total">
        <span class="mny__total-label">paid</span>
        {money.format(totals.paid)}
      </span>
      <span class="mny__total-note">over the {fees.length} listed gigs</span>
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
            <button
              type="button"
              class="mline"
              style={`--c: ${l.accent}`}
              onclick={() => l.line && openLine(l.line)}
              disabled={!l.line}
            >
              <span class="mline__top">
                <span class="mline__glyph">{lineKindGlyph(l.kind)}</span>
                <span class="mline__name">{l.name}</span>
                <span class="mline__co">{l.projectName}</span>
                <span class="mline__amt">{money.format(l.confirmed)}</span>
              </span>
              <span class="mline__bar">
                <span class="mline__fill" style={`inline-size: ${((l.confirmed + l.holds) / byLineMax) * 100}%`}>
                  <span class="mline__fillc" style={`inline-size: ${l.confirmed + l.holds ? (l.confirmed / (l.confirmed + l.holds)) * 100 : 0}%`}></span>
                </span>
              </span>
              <span class="mline__meta">
                <span>{l.dates} confirmed {l.dates === 1 ? 'date' : 'dates'}</span>
                {#if l.holds > 0}<span class="mline__hold">+ {money.format(l.holds)} in holds</span>{/if}
                {#if l.line}<span class="mline__go">open line →</span>{/if}
              </span>
            </button>
          {/each}
        </div>
      </section>
    {/if}

    <section class="mny__section" aria-label="Fees">
      <p class="eyebrow">Fees</p>
      {#if fees.length === 0}
        <p class="mny__state">No performances in the current pins.</p>
      {:else}
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Date</th>
                <th>Project</th>
                <th>Where</th>
                <th>Status</th>
                <th>Fee</th>
                <th aria-label="Actions"></th>
              </tr>
            </thead>
            <tbody>
              {#each fees as f (f.id)}
                <tr>
                  <td class="mny__cell-date">{dayLabel(f.performed_at)}</td>
                  <td>
                    {#if perfHref(f)}
                      <a class="mny__perf-link" href={perfHref(f)}>{f.project?.name ?? '—'}</a>
                    {:else}
                      {f.project?.name ?? '—'}
                    {/if}
                  </td>
                  <td class="mny__cell-muted">
                    {[f.venue_name, f.city].filter(Boolean).join(' · ') || '—'}
                  </td>
                  <td>
                    <StateBadge
                      label={performanceStatusLabel(f.status)}
                      tone={performanceStatusTone(f.status)}
                    />
                  </td>
                  <td>
                    <button
                      type="button"
                      class="mny__fee"
                      title="Edit fee"
                      onclick={() => openFee(f)}
                    >
                      {fmtFee(f.fee_amount, f.fee_currency)}
                    </button>
                  </td>
                  <td class="mny__cell-actions">
                    {#if f.fee_amount !== null}
                      <Button size="xs" variant="outline" onclick={() => openInvoice(f)}>
                        Invoice
                      </Button>
                    {/if}
                  </td>
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
      {/if}
    </section>

    <section class="mny__section" aria-label="Invoices">
      <p class="eyebrow">Invoices</p>
      {#if invoices.length === 0}
        <p class="mny__state">No invoices yet — create one from a gig's fee above.</p>
      {:else}
        <ul class="mny__invoices" role="list">
          {#each invoices as inv (inv.id)}
            <li>
              <span class="mny__inv-number">{inv.number ?? 'no number'}</span>
              <span class="mny__inv-main">
                {inv.payer?.organization_name ?? inv.payer?.full_name ?? '—'}
                {#if inv.project}<span class="mny__cell-muted"> · {inv.project.name}</span>{/if}
              </span>
              <span class="mny__cell-date">{dayLabel(inv.issued_on)}</span>
              <span class="mny__inv-total">{money.format(inv.total)} {inv.currency}</span>
              <span class="mny__inv-actions">
                <Menu label="Change invoice status" triggerClass="btn--outline btn--xs">
                  {#snippet trigger()}
                    <StateBadge label={inv.status} tone={invoiceTone(inv.status)} />
                    <span aria-hidden="true">▾</span>
                  {/snippet}
                  {#snippet children({ close })}
                    {#each INVOICE_STATUSES as s (s)}
                      <li role="none">
                        <button
                          type="button"
                          role="menuitem"
                          class="menu__item{s === inv.status ? ' menu__item--active' : ''}"
                          onclick={() => {
                            close();
                            if (s !== inv.status)
                              $invoiceStatusMutation.mutate({ id: inv.id, status: s });
                          }}
                        >
                          {s}
                        </button>
                      </li>
                    {/each}
                  {/snippet}
                </Menu>
                {#if inv.status === 'draft'}
                  <Button
                    size="xs"
                    variant="outline"
                    tone="warn"
                    loading={$discardInvoice.isPending}
                    onclick={() => $discardInvoice.mutate(inv.id)}
                  >
                    Discard
                  </Button>
                {/if}
              </span>
            </li>
          {/each}
        </ul>
      {/if}
    </section>
  {/if}
</section>

<Dialog bind:open={dialogOpen} title="Fee" size="s" onclose={() => (editing = null)}>
  {#if editing}
    <p class="mny__dialog-who">
      {editing.project?.name ?? ''} — {[editing.venue_name, editing.city]
        .filter(Boolean)
        .join(', ')} · {dayLabel(editing.performed_at)}
    </p>
  {/if}
  <div class="mny__fee-form">
    <Input label="Amount" type="number" bind:value={fAmount} placeholder="Empty clears the fee" />
    <Input label="Currency" bind:value={fCurrency} placeholder="EUR" />
  </div>
  {#snippet actions()}
    <Button variant="outline" onclick={() => (dialogOpen = false)}>Cancel</Button>
    <Button onclick={saveFee} loading={$feeMutation.isPending}>Save</Button>
  {/snippet}
</Dialog>

<Dialog bind:open={invOpen} title="New invoice" size="m" onclose={() => (invPerf = null)}>
  {#if invPerf}
    <p class="mny__dialog-who">
      {invPerf.project?.name ?? ''} — {[invPerf.venue_name, invPerf.city]
        .filter(Boolean)
        .join(', ')} · {dayLabel(invPerf.performed_at)}
    </p>
    <p class="mny__inv-fee-line">
      Fee (subtotal): <strong>{fmtFee(invPerf.fee_amount, invPerf.fee_currency)}</strong>
      — amounts snapshot the fee at creation.
    </p>
    <div class="mny__inv-form">
      <Input label="VAT %" type="number" bind:value={iVat} placeholder="e.g. 21 — empty = none" />
      <Input label="IRPF %" type="number" bind:value={iIrpf} placeholder="e.g. 15 — empty = none" />
      <Input label="Number" bind:value={iNumber} placeholder="Optional — your series" />
      <Input label="Due on" type="date" bind:value={iDueOn} />
    </div>
    <Input label="Notes" bind:value={iNotes} placeholder="Optional" />
    <p class="mny__inv-total-preview">
      Total: <strong>{money.format(invTotal)} {invPerf.fee_currency ?? 'EUR'}</strong>
    </p>
  {/if}
  {#snippet actions()}
    <Button variant="outline" onclick={() => (invOpen = false)}>Cancel</Button>
    <Button onclick={submitInvoice} loading={$createInvoice.isPending}>Create draft</Button>
  {/snippet}
</Dialog>

<style>
  @layer components {
    .mny {
      display: flex;
      flex-direction: column;
      gap: var(--space-l);
    }

    .mny__head {
      display: flex;
      flex-direction: column;
      gap: var(--space-s);
    }

    .mny__totals {
      display: flex;
      align-items: baseline;
      gap: var(--space-l);
      flex-wrap: wrap;
    }

    .mny__total {
      font-family: var(--font-display);
      font-size: var(--text-xl);
      color: var(--text-color);
      display: flex;
      align-items: baseline;
      gap: var(--space-xs);
    }

    .mny__total-label {
      font-family: var(--font-mono);
      font-size: var(--text-xs);
      letter-spacing: 0.08em;
      text-transform: uppercase;
      color: var(--text-faint);
    }

    .mny__total-note {
      font-size: var(--text-xs);
      color: var(--text-faint);
    }

    .mny__state {
      font-size: var(--text-s);
      color: var(--text-faint);
    }
    .mny__state--danger {
      color: var(--danger);
    }

    .mny__section {
      display: flex;
      flex-direction: column;
      gap: var(--space-s);
    }

    /* ── by-line rollup ── */
    .mline-list {
      display: flex;
      flex-direction: column;
    }
    .mline {
      display: block;
      inline-size: 100%;
      text-align: start;
      border: 0;
      background: none;
      border-block-end: 1px solid var(--border-color-light);
      padding-block: var(--space-m);
      padding-inline: var(--space-xs);
      cursor: pointer;
      font-family: inherit;
    }
    .mline:disabled {
      cursor: default;
    }
    .mline:hover:not(:disabled) {
      background: var(--bg-light);
    }
    .mline__top {
      display: flex;
      align-items: center;
      gap: var(--space-s);
    }
    .mline__glyph {
      color: var(--c);
      font-size: var(--text-m);
    }
    .mline__name {
      font-size: var(--text-m);
      font-weight: 500;
      color: var(--text-color);
    }
    .mline__co {
      font-size: var(--text-xs);
      color: var(--text-faint);
    }
    .mline__amt {
      margin-inline-start: auto;
      font-family: var(--font-mono);
      font-size: var(--text-l);
      color: var(--text-color);
      font-variant-numeric: tabular-nums;
    }
    .mline__bar {
      display: block;
      block-size: 0.45rem;
      border-radius: var(--radius-circle);
      background: var(--bg-light);
      margin-block: var(--space-s) var(--space-xs);
      overflow: hidden;
    }
    .mline__fill {
      display: block;
      block-size: 100%;
      border-radius: var(--radius-circle);
      background: color-mix(in oklch, var(--c) 32%, var(--bg-light));
      position: relative;
    }
    .mline__fillc {
      position: absolute;
      inset-block: 0;
      inset-inline-start: 0;
      block-size: 100%;
      border-radius: var(--radius-circle);
      background: var(--c);
    }
    .mline__meta {
      display: flex;
      align-items: center;
      gap: var(--space-m);
      font-size: var(--text-xs);
      color: var(--text-muted);
    }
    .mline__hold {
      color: var(--text-faint);
    }
    .mline__go {
      margin-inline-start: auto;
      color: var(--text-faint);
    }

    .table-wrap {
      overflow-x: auto;
    }

    .mny__cell-date {
      font-family: var(--font-mono);
      font-size: var(--text-xs);
      color: var(--text-muted);
      white-space: nowrap;
    }

    .mny__cell-muted {
      color: var(--text-dark-muted);
      font-size: var(--text-s);
    }

    .mny__perf-link {
      color: var(--text-color);
      font-weight: 500;
      text-decoration: none;
    }
    .mny__perf-link:hover {
      text-decoration: underline;
    }

    .mny__fee {
      font-variant-numeric: tabular-nums;
      font-size: var(--text-s);
      color: var(--text-color);
      text-align: end;
    }
    .mny__fee:hover {
      text-decoration: underline;
    }

    .mny__invoices li {
      display: flex;
      gap: var(--space-m);
      align-items: baseline;
      padding-block: var(--space-xs);
      border-block-end: 1px solid var(--border-color-light);
    }

    .mny__inv-number {
      font-family: var(--font-mono);
      font-size: var(--text-xs);
      color: var(--text-faint);
      min-inline-size: 6rem;
    }

    .mny__inv-main {
      flex: 1;
      font-size: var(--text-s);
    }

    .mny__inv-total {
      font-variant-numeric: tabular-nums;
      font-size: var(--text-s);
    }

    .mny__inv-actions {
      display: flex;
      align-items: center;
      gap: var(--space-xs);
    }

    .mny__cell-actions {
      text-align: end;
    }

    .mny__dialog-who {
      font-size: var(--text-s);
      color: var(--text-muted);
    }

    .mny__fee-form {
      display: grid;
      grid-template-columns: 2fr 1fr;
      gap: var(--space-m);
      margin-block-start: var(--space-s);
    }

    .mny__inv-fee-line {
      font-size: var(--text-s);
      color: var(--text-muted);
      margin-block-start: var(--space-xs);
    }

    .mny__inv-form {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(9rem, 1fr));
      gap: var(--space-s) var(--space-m);
      margin-block: var(--space-s);
    }

    .mny__inv-total-preview {
      font-size: var(--text-s);
      margin-block-start: var(--space-s);
    }
  }
</style>
