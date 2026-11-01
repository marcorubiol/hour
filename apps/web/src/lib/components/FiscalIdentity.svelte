<script lang="ts">
  /**
   * One party's fiscal data, read and written through `endpoint` (GET and
   * PUT, a `FiscalBlockResponse`): an organization's as payer (ADR-102 phase
   * 2b, `/api/organizations/:id/fiscal`) or the space's as issuer (ADR-168,
   * `/api/workspaces/:id/fiscal`, which adds the bank account). The caller
   * names the fields; the block draws them in that order.
   *
   * Renders nothing for someone who can neither read nor edit them. `onsaved`
   * lets the caller follow up (Books re-sets the payer of a draft so it picks
   * the new data before issuing).
   */
  import BlockHead from '$lib/components/BlockHead.svelte';
  import EmptyLine from '$lib/components/EmptyLine.svelte';
  import { createMutation, createQuery, useQueryClient } from '@tanstack/svelte-query';
  import { toStore } from 'svelte/store';
  import { fetchJSON, mutateJSON } from '$lib/api';
  import {
    RECEIVER_FISCAL_FIELDS,
    receiverFiscalSummary,
    type FiscalBlockResponse,
    type FiscalField,
  } from '$lib/fiscal';
  import { appLocale, t } from '$lib/i18n';
  import Button from './Button.svelte';
  import Input from './Input.svelte';
  import { addToast } from './Toast.svelte';

  interface Props {
    /** GET reads the block, PUT saves it. */
    endpoint: string;
    queryKey: readonly unknown[];
    /** What the form asks, in order. `legal_name` is always first and required. */
    fields?: readonly FiscalField[];
    /** The block's head; «Datos fiscales» by default. */
    title?: string;
    /** The line under the form: what this party's data is for. */
    hint?: string;
    /** A line under the summary (where the record comes from). */
    note?: string;
    /** Prefix for the form's ids (two blocks on one page must not collide). */
    idPrefix?: string;
    /** Open the form straight away when there is nothing yet. */
    startEditing?: boolean;
    onsaved?: () => void;
    /** The head's rank where it sits: a block of the page (2) or inside one (3). */
    level?: 2 | 3;
    /** Always draw the head, with the empty line under it, as a block among
        headed blocks (Ajustes). Without it an empty block is one labelled line. */
    headed?: boolean;
    /** The block's anchor (`#fiscal`) and the class of the page it sits in. */
    id?: string;
    class?: string;
  }

  let {
    endpoint,
    queryKey,
    fields = RECEIVER_FISCAL_FIELDS,
    title,
    hint,
    note,
    idPrefix = 'fiscal',
    startEditing = false,
    onsaved,
    level = 3,
    headed = false,
    id,
    class: className,
  }: Props = $props();

  const locale = appLocale();
  let heading = $derived(title ?? t('fiscal.title', locale));
  const queryClient = useQueryClient();

  const query = createQuery(
    toStore(() => ({
      queryKey,
      queryFn: ({ signal }: { signal: AbortSignal }) => fetchJSON<FiscalBlockResponse>(endpoint, signal),
    })),
  );
  let data = $derived($query.data ?? null);
  let fiscal = $derived(data?.fiscal ?? null);
  let visible = $derived(Boolean(data && (data.can_edit || fiscal || data.hidden)));

  let editing = $state(false);
  let draft = $state<Record<FiscalField, string>>(blank());

  function blank(): Record<FiscalField, string> {
    return Object.fromEntries(fields.map((k) => [k, ''])) as Record<FiscalField, string>;
  }

  function edit() {
    const next = blank();
    for (const k of fields) next[k] = fiscal?.[k] ?? '';
    draft = next;
    editing = true;
  }

  // Once: after a cancel the form stays closed.
  let autoOpened = false;
  $effect(() => {
    if (!autoOpened && startEditing && data?.can_edit && !fiscal) {
      autoOpened = true;
      edit();
    }
  });

  const save = createMutation({
    mutationFn: () =>
      mutateJSON('PUT', endpoint, {
        ...Object.fromEntries(fields.map((k) => [k, draft[k].trim() || null])),
        legal_name: draft.legal_name.trim(),
      }),
    onSuccess: () => {
      editing = false;
      addToast({ tone: 'success', message: t('fiscal.saved', locale) });
      void queryClient.invalidateQueries({ queryKey: [...queryKey] });
      void queryClient.invalidateQueries({ queryKey: ['proforma'] });
      void queryClient.invalidateQueries({ queryKey: ['money-payers'] });
      void queryClient.invalidateQueries({ queryKey: ['invoices'] });
      onsaved?.();
    },
    onError: (err) =>
      addToast({
        tone: 'danger',
        title: t('fiscal.not_saved', locale),
        message: err instanceof Error ? err.message : String(err),
      }),
  });

  let legalNameError = $state<string | undefined>();
  $effect(() => {
    void draft.legal_name;
    legalNameError = undefined;
  });

  function submit(ev: SubmitEvent) {
    ev.preventDefault();
    if (!draft.legal_name.trim()) {
      // Said under the field (ADR-139 p7), never as a toast.
      legalNameError = t('fiscal.legal_name_required', locale);
      document.getElementById(`${idPrefix}-legal_name`)?.focus();
      return;
    }
    if (!$save.isPending) $save.mutate();
  }
</script>

{#if visible}
  <section class={['org-fiscal', className]} {id} aria-label={heading}>
    {#if !editing && !fiscal && !headed}
      <!-- Nothing on file: the block is one line, with its way in. -->
      <EmptyLine label={heading} text={t(data?.hidden ? 'proforma.party_hidden' : 'fiscal.none', locale)}>
        {#if data?.can_edit}
          <button type="button" class="empty-line__act" onclick={edit}>{t('fiscal.add', locale)}</button>
        {/if}
      </EmptyLine>
    {:else}
      <BlockHead title={heading} {level}>
        {#if data?.can_edit && !editing}
          <button type="button" class="block-head__act" onclick={edit}>{t(fiscal ? 'fiscal.edit' : 'fiscal.add', locale)}</button>
        {/if}
      </BlockHead>
    {/if}

    {#if editing}
      <form class="org-fiscal__form" onsubmit={submit}>
        {#each fields as field (field)}
          <Input
            id={`${idPrefix}-${field}`}
            label={t(`fiscal.${field}`, locale)}
            bind:value={draft[field]}
            required={field === 'legal_name'}
            error={field === 'legal_name' ? legalNameError : undefined}
            placeholder={field === 'country' ? 'ES' : undefined}
          />
        {/each}
        <p class="org-fiscal__hint">{hint ?? t('fiscal.hint', locale)}</p>
        <div class="org-fiscal__actions">
          <Button size="xs" variant="quiet" onclick={() => (editing = false)}>{t('create.cancel', locale)}</Button>
          <Button size="xs" type="submit" loading={$save.isPending}>{t('fiscal.save', locale)}</Button>
        </div>
      </form>
    {:else if fiscal}
      <p class="org-fiscal__summary">{receiverFiscalSummary({ legal_name: fiscal.legal_name ?? null, tax_id: fiscal.tax_id ?? null, city: fiscal.city ?? null })}</p>
      {#if note}<p class="org-fiscal__hint">{note}</p>{/if}
    {:else if headed}
      <EmptyLine text={t(data?.hidden ? 'proforma.party_hidden' : 'fiscal.none', locale)} />
    {/if}
  </section>
{/if}

<style>
  @layer components {
    .org-fiscal {
      display: flex;
      flex-direction: column;
      gap: var(--space-xs);
    }

    .org-fiscal__actions {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: var(--space-s);
    }
    .org-fiscal__actions {
      justify-content: flex-end;
    }
    /* Field rows, one under the other (ADR-139 p4). */
    .org-fiscal__form {
      display: flex;
      flex-direction: column;
    }
    .org-fiscal__summary {
      font-size: var(--text-s);
    }
    .org-fiscal__hint {
      font-size: var(--text-xs);
      color: var(--text-faint);
    }
  }
</style>
