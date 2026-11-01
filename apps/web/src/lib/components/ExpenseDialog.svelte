<script module lang="ts">
  /** Where an expense hangs: a bolo or a line (ADR-087), and its space. */
  export interface ExpenseAnchor {
    /** `bolo:<id>` or `line:<id>`. */
    value: string;
    label: string;
    workspaceId: string;
  }
</script>

<script lang="ts">
  /**
   * The one «+ Gasto» (ADR-170): Cuentas, the line's Money module, the bolo's
   * record and Ahora open this dialog, each with its anchors. A record that
   * knows its bolo passes that one and `lockAnchor`.
   *
   * «Lo pagó» (79): somebody of the team who advanced it, a person with a
   * dossier in the anchor's space (the base refuses anyone else, 23514).
   * Empty means the company paid. The picker offers the team of that space and,
   * as you type, anybody in its directory; a name that is nobody yet is
   * created there (ADR-107), so the guard always finds the dossier.
   */
  import { createMutation, createQuery, useQueryClient } from '@tanstack/svelte-query';
  import { toStore } from 'svelte/store';
  import { fetchJSON, mutateJSON } from '$lib/api';
  import Button from '$lib/components/Button.svelte';
  import Dialog from '$lib/components/Dialog.svelte';
  import Input from '$lib/components/Input.svelte';
  import PersonPicker from '$lib/components/PersonPicker.svelte';
  import Select from '$lib/components/Select.svelte';
  import { addToast } from '$lib/components/Toast.svelte';
  import { toastCreated } from '$lib/created';
  import { localDayISO } from '$lib/datetime';
  import { categoryLabel, EXPENSE_CATEGORIES } from '$lib/expense';
  import { FormErrors } from '$lib/form-errors.svelte';
  import { appLocale, t } from '$lib/i18n';
  import { teamQueryOptions } from '$lib/nav-queries';
  import type { PaletteSearchResult } from '$lib/palette-search';
  import type { PersonOption } from '$lib/persons';

  interface Props {
    open: boolean;
    anchors: ExpenseAnchor[];
    /** The anchor it opens on; the first one if none. */
    anchor?: string;
    /** The anchor is the host's (a bolo's record): it is shown, not chosen. */
    lockAnchor?: boolean;
    currency?: string;
  }

  let { open = $bindable(false), anchors, anchor, lockAnchor = false, currency = 'EUR' }: Props = $props();

  const locale = appLocale();
  const queryClient = useQueryClient();
  const formErrors = new FormErrors();
  const uid = $props.id();

  let eAmount = $state('');
  let eCurrency = $state('EUR');
  let eDescription = $state('');
  let eCategory = $state<string>('other');
  let eIncurredOn = $state('');
  let eCounterparty = $state('');
  let eNotes = $state('');
  let eAnchor = $state('');
  let payerText = $state('');
  let payer = $state<PersonOption | null>(null);

  // Each opening starts clean, on the host's anchor.
  $effect(() => {
    if (!open) return;
    eAmount = '';
    eCurrency = currency;
    eDescription = '';
    eCategory = 'other';
    eIncurredOn = localDayISO();
    eCounterparty = '';
    eNotes = '';
    eAnchor = anchor ?? anchors[0]?.value ?? '';
    payerText = '';
    payer = null;
    formErrors.clear();
  });

  let workspaceId = $derived(anchors.find((a) => a.value === eAnchor)?.workspaceId ?? '');
  // Another space, another directory: who paid has to be of this one.
  let payerSpace = '';
  $effect(() => {
    if (workspaceId !== payerSpace) {
      payerSpace = workspaceId;
      payer = null;
      payerText = '';
    }
  });
  // Typing over a chosen name un-chooses it: an empty field is the company.
  $effect(() => {
    if (payer && payerText !== payer.full_name) payer = null;
  });

  const teamQuery = createQuery(
    toStore(() => teamQueryOptions(workspaceId ? [workspaceId] : [], { enabled: open && Boolean(workspaceId) })),
  );
  let found = $state<PersonOption[]>([]);
  let timer: ReturnType<typeof setTimeout> | undefined;
  $effect(() => {
    const q = payerText.trim();
    clearTimeout(timer);
    if (!open || !workspaceId || q.length < 2 || q === payer?.full_name) return;
    const ws = workspaceId;
    timer = setTimeout(async () => {
      try {
        const r = await fetchJSON<PaletteSearchResult>(
          `/api/search?q=${encodeURIComponent(q)}&workspace_ids=${encodeURIComponent(ws)}`,
        );
        found = r.persons.filter((p) => p.workspace_id === ws).map((p) => ({ person_id: p.person_id, full_name: p.full_name }));
      } catch {
        found = [];
      }
    }, 200);
    return () => clearTimeout(timer);
  });
  let payerOptions = $derived.by(() => {
    const seen = new Map<string, PersonOption>();
    for (const m of $teamQuery.data?.items ?? []) {
      if (m.workspace_id === workspaceId) seen.set(m.person_id, { person_id: m.person_id, full_name: m.full_name });
    }
    for (const p of found) if (!seen.has(p.person_id)) seen.set(p.person_id, p);
    return [...seen.values()].sort((a, b) => a.full_name.localeCompare(b.full_name));
  });

  const categoryOptions = EXPENSE_CATEGORIES.map((c) => ({ value: c, label: categoryLabel(c, locale) }));

  /** Every read of expenses: Cuentas', the bolo's and the line's. */
  function refresh() {
    return Promise.all([
      queryClient.invalidateQueries({ queryKey: ['expenses'] }),
      queryClient.invalidateQueries({ queryKey: ['line-expenses'] }),
    ]);
  }

  const createExpense = createMutation({
    mutationFn: async () => {
      const amount = Number(String(eAmount).trim());
      const [kind, id] = eAnchor.split(':');
      const body = await mutateJSON<{ expense?: { id?: string } }>('POST', '/api/expenses', {
        ...(kind === 'bolo' ? { bolo_id: id } : { line_id: id }),
        category: eCategory,
        description: eDescription.trim() || t('books.expense_default', locale),
        amount: Number(amount.toFixed(2)),
        currency: eCurrency.trim().toUpperCase(),
        incurred_on: eIncurredOn || null,
        counterparty: eCounterparty.trim() || null,
        notes: eNotes.trim() || null,
        paid_by_person_id: payer?.person_id ?? null,
      });
      if (!body?.expense) throw new Error(t('books.unexpected_response', locale));
      return body.expense;
    },
    onSuccess: (expense) => {
      open = false;
      void refresh();
      const id = expense.id;
      toastCreated({
        locale,
        message: t('books.expense_added', locale),
        undo: id
          ? async () => {
              await mutateJSON('DELETE', `/api/expenses/${id}`);
              await refresh();
            }
          : undefined,
      });
    },
    onError: (err) =>
      addToast({
        tone: 'danger',
        title: t('books.expense_not_added', locale),
        message: err instanceof Error ? err.message : t('perf.unexpected', locale),
      }),
  });

  const amountId = `exp-amount-${uid}`;
  const currencyId = `exp-currency-${uid}`;
  const anchorId = `exp-anchor-${uid}`;

  function submit() {
    if ($createExpense.isPending) return;
    formErrors.clear();
    const amount = Number(String(eAmount).trim());
    if (!String(eAmount).trim() || !Number.isFinite(amount) || amount <= 0) {
      formErrors.set(amountId, t('books.amount_gt_zero', locale));
    }
    if (!/^[A-Z]{3}$/.test(eCurrency.trim().toUpperCase())) formErrors.set(currencyId, t('books.currency_code', locale));
    if (!eAnchor) formErrors.set(anchorId, t('books.pick_anchor', locale));
    if (formErrors.any) return void formErrors.focusFirst();
    $createExpense.mutate();
  }
</script>

<Dialog bind:open title={t('books.add_expense', locale)} size="s">
  <form
    class="expense-form"
    novalidate
    oninput={formErrors.onedit}
    onchange={formErrors.onedit}
    onsubmit={(e) => {
      e.preventDefault();
      submit();
    }}
  >
    <Input id={amountId} label={t('books.amount', locale)} type="number" step="0.01" bind:value={eAmount} required error={formErrors.of(amountId)} />
    <Input id={currencyId} label={t('books.currency', locale)} bind:value={eCurrency} placeholder="EUR" error={formErrors.of(currencyId)} />
    <Input label={t('books.description', locale)} bind:value={eDescription} placeholder={t('books.ph_expense', locale)} />
    <Input label={t('perf.date', locale)} type="date" bind:value={eIncurredOn} />
    <Select label={t('books.category', locale)} bind:value={eCategory} options={categoryOptions} />
    <Select
      id={anchorId}
      label={t('books.anchor', locale)}
      bind:value={eAnchor}
      options={anchors.map((a) => ({ value: a.value, label: a.label }))}
      disabled={lockAnchor}
      required
      error={formErrors.of(anchorId)}
    />
    {#if workspaceId}
      <PersonPicker
        options={payerOptions}
        {workspaceId}
        label={t('books.paid_by', locale)}
        placeholder={t('books.paid_by_ph', locale)}
        helper={payer ? t('books.paid_by_owed', locale, { name: payer.full_name }) : t('books.paid_by_company', locale)}
        {locale}
        bind:text={payerText}
        onpick={(p) => (payer = p)}
      />
    {/if}
    <Input label={t('books.counterparty_paid', locale)} bind:value={eCounterparty} placeholder={t('books.ph_counterparty', locale)} />
    <Input label={t('books.notes', locale)} bind:value={eNotes} />
    <button type="submit" hidden aria-hidden="true"></button>
  </form>
  {#snippet actions()}
    <Button variant="quiet" onclick={() => (open = false)}>{t('create.cancel', locale)}</Button>
    <Button onclick={submit} loading={$createExpense.isPending}>{t('composer.add', locale)}</Button>
  {/snippet}
</Dialog>

<style>
  @layer components {
    /* The dialog's fields are rows, one under the other (ADR-139 p4). */
    .expense-form {
      display: flex;
      flex-direction: column;
      gap: var(--field-gap);
      margin-block-start: var(--space-s);
    }
  }
</style>
