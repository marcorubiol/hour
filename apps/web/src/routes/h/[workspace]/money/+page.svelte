<script lang="ts">
  /**
   * Money lens — Phase 0.3 (ADR-046). Read path is `performance_redacted`
   * (fees NULLed without read:money); fee editing lives HERE by design —
   * ADR-043 deliberately kept fee out of the performance write path.
   * Invoices are read-only (creation is Phase 0.5).
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
  import StateBadge from '$lib/components/StateBadge.svelte';
  import { addToast } from '$lib/components/Toast.svelte';
  import { dayLabel } from '$lib/datetime';
  import { performanceStatusLabel, performanceStatusTone } from '$lib/performance';
  import { resolveSelectionIds } from '$lib/selection-filter';
  import { useSelection } from '$lib/stores/selection.svelte';

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

  const selection = useSelection();

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

  let workspacesBySlug = $derived(
    new Map(($workspacesQuery.data?.items ?? []).map((w) => [w.slug, w])),
  );
  let workspaceSlugById = $derived(
    new Map(($workspacesQuery.data?.items ?? []).map((w) => [w.id, w.slug])),
  );
  let projectsBySlug = $derived(
    new Map(($projectsQuery.data?.items ?? []).map((p) => [p.slug, p])),
  );

  let ids = $derived(resolveSelectionIds(selection, projectsBySlug, workspacesBySlug));

  function feedParams(k: { projectIds: string[]; workspaceIds: string[] }): string {
    const p = new URLSearchParams();
    if (k.projectIds.length > 0) p.set('project_ids', k.projectIds.join(','));
    if (k.workspaceIds.length > 0) p.set('workspace_ids', k.workspaceIds.join(','));
    return p.toString();
  }

  const feesOptions = toStore(() => {
    const k = ids;
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
    const k = ids;
    return {
      queryKey: ['invoices', { p: k.projectIds, w: k.workspaceIds }] as const,
      enabled: !k.unresolved,
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        fetchJSON<{ items: InvoiceItem[] }>(`/api/invoices?${feedParams(k)}`, signal),
    };
  });

  const feesQuery = createQuery(feesOptions);
  const invoicesQuery = createQuery(invoicesOptions);

  let fees = $derived($feesQuery.data?.items ?? []);
  let invoices = $derived($invoicesQuery.data?.items ?? []);
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
</script>

<svelte:head>
  <title>Money — Hour</title>
</svelte:head>

<section class="mny">
  <header class="mny__head">
    <p class="eyebrow">Money</p>
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
    <section class="mny__section" aria-label="Fees">
      <p class="eyebrow">Fees</p>
      {#if fees.length === 0}
        <p class="mny__state">No performances in the current filter.</p>
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
        <p class="mny__state">No invoices yet — invoice creation lands in Phase 0.5.</p>
      {:else}
        <ul class="mny__invoices" role="list">
          {#each invoices as inv (inv.id)}
            <li>
              <span class="mny__inv-number">{inv.number ?? 'draft'}</span>
              <span class="mny__inv-main">
                {inv.payer?.organization_name ?? inv.payer?.full_name ?? '—'}
                {#if inv.project}<span class="mny__cell-muted"> · {inv.project.name}</span>{/if}
              </span>
              <span class="mny__cell-date">{dayLabel(inv.issued_on)}</span>
              <span class="mny__inv-total">{money.format(inv.total)} {inv.currency}</span>
              <span class="mny__inv-status">{inv.status}</span>
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

    .mny__inv-status {
      font-family: var(--font-mono);
      font-size: var(--text-xs);
      color: var(--text-muted);
      text-transform: lowercase;
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
  }
</style>
