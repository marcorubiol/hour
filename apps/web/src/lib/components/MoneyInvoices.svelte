<script lang="ts">
  import { createMutation, useQueryClient } from '@tanstack/svelte-query';
  import { mutateJSON } from '$lib/api';
  import {
    PAYMENT_METHODS,
    agingState,
    fmtMoney,
    invoiceTone,
    observedPayerTermsDays,
    type MoneyInvoiceItem,
    type PaymentMethod,
  } from '$lib/money';
  import { dayLabel } from '$lib/datetime';
  import Button from './Button.svelte';
  import Dialog from './Dialog.svelte';
  import Input from './Input.svelte';
  import Menu from './Menu.svelte';
  import Select from './Select.svelte';
  import StateBadge from './StateBadge.svelte';
  import { addToast } from './Toast.svelte';

  interface Props {
    invoices: MoneyInvoiceItem[];
  }

  let { invoices }: Props = $props();

  const queryClient = useQueryClient();
  const today = new Date();
  const EDITABLE_STATUSES = ['draft', 'issued', 'cancelled'] as const;
  const METHOD_LABELS: Record<PaymentMethod, string> = {
    transfer: 'Transfer',
    card: 'Card',
    cash: 'Cash',
    other: 'Other',
  };

  let allPayments = $derived(invoices.flatMap((invoice) => invoice.payments));
  let termsByPayer = $derived(observedPayerTermsDays(invoices, allPayments));
  let expandedId = $state<string | null>(null);

  function agingFor(invoice: MoneyInvoiceItem) {
    return agingState(
      {
        ...invoice,
        observed_terms_days: invoice.payer_person_id
          ? termsByPayer.get(invoice.payer_person_id)?.days ?? null
          : null,
      },
      invoice.payments,
      today,
    );
  }

  function payerName(invoice: MoneyInvoiceItem): string {
    return invoice.payer?.organization_name ?? invoice.payer?.full_name ?? 'payer';
  }

  function agingCopy(invoice: MoneyInvoiceItem): string {
    const aging = agingFor(invoice);
    if (aging.state === 'paid') return 'collected';
    if (aging.expectedDays === null) return `${aging.daysRunning} days · no expectation`;
    return `${aging.daysRunning} of ~${aging.expectedDays} days`;
  }

  function statusChoices(invoice: MoneyInvoiceItem): readonly string[] {
    return invoice.status === 'paid' ? ['cancelled'] : EDITABLE_STATUSES;
  }

  const invoicePatch = createMutation({
    mutationFn: async (input: { id: string; patch: Record<string, unknown> }) => {
      const body = await mutateJSON<{ invoice?: unknown }>(
        'PATCH',
        `/api/invoices/${input.id}`,
        input.patch,
      );
      if (!body?.invoice) throw new Error('Unexpected response');
      return body.invoice;
    },
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['invoices'] }),
    onError: (err) => {
      addToast({
        tone: 'danger',
        title: 'Invoice not updated',
        message: err instanceof Error ? err.message : 'Unexpected error',
      });
    },
  });

  const discardInvoice = createMutation({
    mutationFn: async (id: string) => mutateJSON('DELETE', `/api/invoices/${id}`),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['invoices'] }),
    onError: (err) => {
      addToast({
        tone: 'danger',
        title: 'Draft not discarded',
        message: err instanceof Error ? err.message : 'Unexpected error',
      });
    },
  });

  let paymentOpen = $state(false);
  let paymentInvoice = $state<MoneyInvoiceItem | null>(null);
  let pAmount = $state('');
  let pReceivedOn = $state(today.toISOString().slice(0, 10));
  let pMethod = $state<PaymentMethod>('transfer');
  let pReference = $state('');
  let pNotes = $state('');

  function openPayment(invoice: MoneyInvoiceItem) {
    paymentInvoice = invoice;
    pAmount = String(Math.max(0, Number(invoice.total) - Number(invoice.paid_amount)).toFixed(2));
    pReceivedOn = today.toISOString().slice(0, 10);
    pMethod = 'transfer';
    pReference = '';
    pNotes = '';
    paymentOpen = true;
  }

  const createPayment = createMutation({
    mutationFn: async () => {
      if (!paymentInvoice) throw new Error('No invoice selected');
      const body = await mutateJSON<{ payment?: unknown }>('POST', '/api/payments', {
        invoice_id: paymentInvoice.id,
        amount: Number(pAmount),
        received_on: pReceivedOn,
        method: pMethod,
        reference: pReference.trim() || null,
        notes: pNotes.trim() || null,
      });
      if (!body?.payment) throw new Error('Unexpected response');
      return body.payment;
    },
    onSuccess: () => {
      paymentOpen = false;
      paymentInvoice = null;
      void queryClient.invalidateQueries({ queryKey: ['invoices'] });
      void queryClient.invalidateQueries({ queryKey: ['payments'] });
      addToast({ tone: 'success', message: 'Payment recorded.' });
    },
    onError: (err) => {
      addToast({
        tone: 'danger',
        title: 'Payment not recorded',
        message: err instanceof Error ? err.message : 'Unexpected error',
      });
    },
  });

  function submitPayment() {
    const amount = Number(pAmount);
    if (!Number.isFinite(amount) || amount <= 0) {
      addToast({ tone: 'warning', message: 'Payment amount must be greater than zero.' });
      return;
    }
    $createPayment.mutate();
  }

  const deletePayment = createMutation({
    mutationFn: async (id: string) => mutateJSON('DELETE', `/api/payments/${id}`),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['invoices'] });
      void queryClient.invalidateQueries({ queryKey: ['payments'] });
      addToast({ tone: 'info', message: 'Payment removed; invoice status recalculated.' });
    },
    onError: (err) => {
      addToast({
        tone: 'danger',
        title: 'Payment not removed',
        message: err instanceof Error ? err.message : 'Unexpected error',
      });
    },
  });

  const createFollowUp = createMutation({
    mutationFn: async (invoice: MoneyInvoiceItem) => {
      const expectedOn = agingFor(invoice).expectedOn;
      if (!expectedOn) throw new Error('Set an expected collection date first.');
      const parent = invoice.project_id
        ? { project_id: invoice.project_id }
        : { workspace_id: invoice.workspace_id };
      return mutateJSON('POST', '/api/tasks', {
        title: `Ask ${payerName(invoice)} if they've collected`,
        note: invoice.payment_condition,
        from_at: expectedOn,
        ...parent,
      });
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['tasks', 'open'] });
      void queryClient.invalidateQueries({ queryKey: ['tasks'] });
      addToast({ tone: 'success', message: 'Follow-up added to Desk for that date.' });
    },
    onError: (err) => {
      addToast({
        tone: 'danger',
        title: 'Follow-up not created',
        message: err instanceof Error ? err.message : 'Unexpected error',
      });
    },
  });

  function updateExpectedOn(invoice: MoneyInvoiceItem, event: Event) {
    const value = (event.currentTarget as HTMLInputElement).value || null;
    if (value === invoice.expected_on) return;
    $invoicePatch.mutate({ id: invoice.id, patch: { expected_on: value } });
  }

  function updateCondition(invoice: MoneyInvoiceItem, event: FocusEvent) {
    const value = (event.currentTarget as HTMLTextAreaElement).value.trim() || null;
    if (value === invoice.payment_condition) return;
    $invoicePatch.mutate({ id: invoice.id, patch: { payment_condition: value } });
  }
</script>

{#if invoices.length === 0}
  <p class="mny-inv__empty">No invoices yet — create one from a gig's fee above.</p>
{:else}
  <ul class="mny__invoices" role="list">
    {#each invoices as invoice (invoice.id)}
      {@const aging = agingFor(invoice)}
      {@const observed = invoice.payer_person_id ? termsByPayer.get(invoice.payer_person_id) : null}
      <li class:expanded={expandedId === invoice.id}>
        <div class="mny-inv__row">
          <span class="mny-inv__number">{invoice.number ?? 'no number'}</span>
          <span class="mny-inv__main">
            {invoice.payer?.organization_name ?? invoice.payer?.full_name ?? '—'}
            {#if invoice.project}<span class="mny-inv__muted"> · {invoice.project.name}</span>{/if}
          </span>
          <span class="mny-inv__age mny-inv__age--{aging.state}">{agingCopy(invoice)}</span>
          <span class="mny-inv__total">{fmtMoney(invoice.total)} {invoice.currency}</span>
          <span class="mny-inv__actions">
            <button
              type="button"
              class="btn--outline btn--xs"
              aria-expanded={expandedId === invoice.id}
              onclick={() => (expandedId = expandedId === invoice.id ? null : invoice.id)}
            >
              {expandedId === invoice.id ? 'Close' : 'Details'}
            </button>
            <Menu label="Change invoice status" triggerClass="btn--outline btn--xs">
              {#snippet trigger()}
                <StateBadge label={invoice.status} tone={invoiceTone(invoice.status)} />
                <span aria-hidden="true">▾</span>
              {/snippet}
              {#snippet children({ close })}
                {#each statusChoices(invoice) as status (status)}
                  <li role="none">
                    <button
                      type="button"
                      role="menuitem"
                      class="menu__item{status === invoice.status ? ' menu__item--active' : ''}"
                      onclick={() => {
                        close();
                        if (status !== invoice.status) {
                          $invoicePatch.mutate({ id: invoice.id, patch: { status } });
                        }
                      }}
                    >
                      {status}
                    </button>
                  </li>
                {/each}
              {/snippet}
            </Menu>
            {#if invoice.status === 'draft'}
              <Button
                size="xs"
                variant="outline"
                tone="warn"
                loading={$discardInvoice.isPending}
                onclick={() => $discardInvoice.mutate(invoice.id)}
              >Discard</Button>
            {/if}
          </span>
        </div>

        {#if expandedId === invoice.id}
          <div class="mny-inv__detail">
            <div class="mny-inv__dates">
              <div>
                <span class="mny-inv__label">Issued</span>
                <span>{dayLabel(invoice.issued_on)}</span>
              </div>
              <div>
                <span class="mny-inv__label">Contractual due</span>
                <span>{invoice.due_on ? dayLabel(invoice.due_on) : 'not set'}</span>
              </div>
              <label>
                <span class="mny-inv__label">Expected collection</span>
                <input
                  type="date"
                  value={invoice.expected_on ?? ''}
                  aria-label={`Expected collection date for ${invoice.number ?? 'invoice'}`}
                  onchange={(event) => updateExpectedOn(invoice, event)}
                />
              </label>
            </div>

            {#if aging.source === 'observed' && observed}
              <p class="mny-inv__provenance">
                Usually pays in ~{Math.round(observed.days)} days · {observed.samples} observed invoices.
                Set a date above to correct this estimate.
              </p>
            {/if}

            <div class="mny-inv__condition">
              <label for={`condition-${invoice.id}`} class="mny-inv__label">Payment condition</label>
              <textarea
                id={`condition-${invoice.id}`}
                rows="2"
                placeholder="e.g. pays when the town hall pays them — says October"
                value={invoice.payment_condition ?? ''}
                onblur={(event) => updateCondition(invoice, event)}
              ></textarea>
              <Button
                size="xs"
                variant="outline"
                disabled={!aging.expectedOn}
                loading={$createFollowUp.isPending}
                onclick={() => $createFollowUp.mutate(invoice)}
              >Follow up later</Button>
            </div>

            <div class="mny-inv__progress-head">
              <span>
                <span class="mny-inv__label">Collected</span>
                {fmtMoney(invoice.paid_amount)} / {fmtMoney(invoice.total)} {invoice.currency}
              </span>
              {#if invoice.status === 'issued' || invoice.status === 'paid'}
                <Button size="xs" variant="outline" onclick={() => openPayment(invoice)}>
                  Record payment
                </Button>
              {/if}
            </div>
            <span class="mny-inv__progress" aria-hidden="true">
              <span style={`inline-size: ${Math.min(100, invoice.total > 0 ? (invoice.paid_amount / invoice.total) * 100 : 0)}%`}></span>
            </span>

            {#if invoice.payments.length > 0}
              <ul class="mny-inv__payments" aria-label="Payments">
                {#each invoice.payments as payment (payment.id)}
                  <li>
                    <span>{dayLabel(payment.received_on)}</span>
                    <span>{METHOD_LABELS[payment.method]}</span>
                    <span>{payment.reference ?? '—'}</span>
                    <strong>{fmtMoney(payment.amount)} {invoice.currency}</strong>
                    <Button
                      size="xs"
                      variant="outline"
                      tone="warn"
                      loading={$deletePayment.isPending}
                      onclick={() => $deletePayment.mutate(payment.id)}
                    >Remove</Button>
                  </li>
                {/each}
              </ul>
            {:else}
              <p class="mny-inv__empty">No payments recorded.</p>
            {/if}

            <dl class="mny-inv__tax">
              <div><dt>Subtotal</dt><dd>{fmtMoney(invoice.subtotal)} {invoice.currency}</dd></div>
              <div><dt>VAT {invoice.vat_pct ?? 0}%</dt><dd>+ {fmtMoney(invoice.vat_amount ?? 0)}</dd></div>
              <div><dt>IRPF {invoice.irpf_pct ?? 0}%</dt><dd>− {fmtMoney(invoice.irpf_amount ?? 0)}</dd></div>
              <div><dt>Total</dt><dd>{fmtMoney(invoice.total)} {invoice.currency}</dd></div>
            </dl>
          </div>
        {/if}
      </li>
    {/each}
  </ul>
{/if}

<Dialog bind:open={paymentOpen} title="Record payment" size="s" onclose={() => (paymentInvoice = null)}>
  {#if paymentInvoice}
    <p class="mny-inv__dialog-who">
      {paymentInvoice.number ?? 'Invoice'} · {payerName(paymentInvoice)} ·
      {fmtMoney(paymentInvoice.total)} {paymentInvoice.currency}
    </p>
    <div class="mny-inv__payment-form">
      <Input label="Amount" type="number" bind:value={pAmount} required />
      <Input label="Received on" type="date" bind:value={pReceivedOn} required />
      <Select
        label="Method"
        bind:value={pMethod}
        options={PAYMENT_METHODS.map((method) => ({ value: method, label: METHOD_LABELS[method] }))}
      />
      <Input label="Reference" bind:value={pReference} placeholder="Optional" />
    </div>
    <Input label="Notes" bind:value={pNotes} placeholder="Optional" />
  {/if}
  {#snippet actions()}
    <Button variant="outline" onclick={() => (paymentOpen = false)}>Cancel</Button>
    <Button onclick={submitPayment} loading={$createPayment.isPending}>Record</Button>
  {/snippet}
</Dialog>

<style>
  @layer components {
    .mny__invoices {
      display: flex;
      flex-direction: column;
    }

    .mny__invoices > li {
      border-block-end: 1px solid var(--border-color-light);
    }

    .mny__invoices > li.expanded {
      background: color-mix(in oklch, var(--bg-light) 68%, transparent);
    }

    .mny-inv__row {
      display: grid;
      grid-template-columns: minmax(5rem, 0.55fr) minmax(10rem, 1.5fr) minmax(8rem, 0.9fr) auto auto;
      gap: var(--space-m);
      align-items: center;
      padding: var(--space-s) var(--space-xs);
    }

    .mny-inv__number,
    .mny-inv__label,
    .mny-inv__age {
      font-family: var(--font-mono);
      font-size: var(--text-xs);
    }

    .mny-inv__number,
    .mny-inv__label,
    .mny-inv__muted,
    .mny-inv__empty,
    .mny-inv__provenance {
      color: var(--text-faint);
    }

    .mny-inv__main { font-size: var(--text-s); }
    .mny-inv__total {
      font-variant-numeric: tabular-nums;
      font-size: var(--text-s);
      white-space: nowrap;
    }
    .mny-inv__age { color: var(--text-muted); }
    .mny-inv__age--approaching { color: var(--warning); }
    .mny-inv__age--past-expected { color: var(--danger); }
    .mny-inv__age--paid { color: var(--success); }
    .mny-inv__actions {
      display: flex;
      gap: var(--space-xs);
      align-items: center;
    }

    .mny-inv__detail {
      display: flex;
      flex-direction: column;
      gap: var(--space-m);
      padding: var(--space-m);
      border-block-start: 1px solid var(--border-color-light);
    }

    .mny-inv__dates {
      display: grid;
      grid-template-columns: repeat(3, minmax(9rem, 1fr));
      gap: var(--space-m);
    }
    .mny-inv__dates > div,
    .mny-inv__dates > label {
      display: flex;
      flex-direction: column;
      gap: var(--space-xxs);
      font-size: var(--text-s);
    }
    .mny-inv__dates input {
      inline-size: 100%;
    }
    .mny-inv__label {
      letter-spacing: 0.07em;
      text-transform: uppercase;
    }
    .mny-inv__provenance,
    .mny-inv__empty,
    .mny-inv__dialog-who {
      font-size: var(--text-xs);
    }

    .mny-inv__condition {
      display: grid;
      grid-template-columns: 1fr auto;
      gap: var(--space-xs) var(--space-m);
      align-items: end;
    }
    .mny-inv__condition label { grid-column: 1 / -1; }
    .mny-inv__condition textarea {
      resize: vertical;
      min-block-size: 4rem;
    }

    .mny-inv__progress-head {
      display: flex;
      align-items: end;
      justify-content: space-between;
      gap: var(--space-m);
      font-size: var(--text-s);
    }
    .mny-inv__progress-head > span {
      display: flex;
      flex-direction: column;
      gap: var(--space-xxs);
    }
    .mny-inv__progress {
      display: block;
      block-size: 0.3rem;
      border-radius: var(--radius-circle);
      background: var(--bg-active);
      overflow: hidden;
    }
    .mny-inv__progress > span {
      display: block;
      block-size: 100%;
      background: var(--success);
      border-radius: inherit;
    }

    .mny-inv__payments {
      display: flex;
      flex-direction: column;
    }
    .mny-inv__payments li {
      display: grid;
      grid-template-columns: minmax(7rem, 1fr) minmax(5rem, 0.7fr) minmax(5rem, 1fr) auto auto;
      gap: var(--space-s);
      align-items: center;
      padding-block: var(--space-xs);
      border-block-end: 1px solid var(--border-color-light);
      font-size: var(--text-xs);
      color: var(--text-muted);
    }
    .mny-inv__payments strong {
      color: var(--text-color);
      font-weight: 500;
      font-variant-numeric: tabular-nums;
    }

    .mny-inv__tax {
      display: grid;
      grid-template-columns: repeat(4, minmax(8rem, 1fr));
      gap: var(--space-s);
      margin: 0;
    }
    .mny-inv__tax div {
      display: flex;
      justify-content: space-between;
      gap: var(--space-s);
      padding: var(--space-xs);
      background: var(--bg-light);
      font-size: var(--text-xs);
    }
    .mny-inv__tax dt { color: var(--text-faint); }
    .mny-inv__tax dd { margin: 0; font-variant-numeric: tabular-nums; }

    .mny-inv__payment-form {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: var(--space-s) var(--space-m);
      margin-block: var(--space-s);
    }

    @media (max-width: 760px) {
      .mny-inv__row {
        grid-template-columns: 1fr auto;
        gap: var(--space-xs) var(--space-s);
        align-items: start;
      }
      .mny-inv__main { grid-column: 1 / -1; font-size: var(--text-m); }
      .mny-inv__age { grid-column: 1; }
      .mny-inv__total { grid-column: 2; grid-row: 1; }
      .mny-inv__actions { grid-column: 1 / -1; flex-wrap: wrap; }
      .mny-inv__dates,
      .mny-inv__tax,
      .mny-inv__payment-form { grid-template-columns: 1fr; }
      .mny-inv__condition { grid-template-columns: 1fr; }
      .mny-inv__payments li {
        grid-template-columns: 1fr auto;
      }
      .mny-inv__payments strong { grid-column: 2; grid-row: 1; }
    }
  }
</style>
