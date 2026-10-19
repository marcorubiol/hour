<script lang="ts">
  /**
   * The fiscal data of an organization (ADR-102 phase 2b): what a factura
   * prints for the payer. Read through `/api/organizations/:id/fiscal`, written
   * through `set_organization_fiscal_identity` (can_edit_workspace_money).
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
    type OrganizationFiscalResponse,
    type ReceiverFiscal,
  } from '$lib/fiscal';
  import { appLocale, t } from '$lib/i18n';
  import Button from './Button.svelte';
  import Input from './Input.svelte';
  import { addToast } from './Toast.svelte';

  interface Props {
    organizationId: string;
    /** Open the form straight away when there is nothing yet. */
    startEditing?: boolean;
    onsaved?: () => void;
    /** The head's rank where it sits: a block of the page (2) or inside one (3). */
    level?: 2 | 3;
  }

  let { organizationId, startEditing = false, onsaved, level = 3 }: Props = $props();

  const locale = appLocale();
  const queryClient = useQueryClient();

  const query = createQuery(
    toStore(() => ({
      queryKey: ['organization-fiscal', organizationId] as const,
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        fetchJSON<OrganizationFiscalResponse>(`/api/organizations/${organizationId}/fiscal`, signal),
    })),
  );
  let data = $derived($query.data ?? null);
  let fiscal = $derived(data?.fiscal ?? null);
  let visible = $derived(Boolean(data && (data.can_edit || fiscal)));

  let editing = $state(false);
  let draft = $state<Record<keyof ReceiverFiscal, string>>(blank());

  function blank(): Record<keyof ReceiverFiscal, string> {
    return Object.fromEntries(RECEIVER_FISCAL_FIELDS.map((k) => [k, ''])) as Record<keyof ReceiverFiscal, string>;
  }

  function edit() {
    const next = blank();
    for (const k of RECEIVER_FISCAL_FIELDS) next[k] = fiscal?.[k] ?? '';
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
      mutateJSON('PUT', `/api/organizations/${organizationId}/fiscal`, {
        ...Object.fromEntries(RECEIVER_FISCAL_FIELDS.map((k) => [k, draft[k].trim() || null])),
        legal_name: draft.legal_name.trim(),
      }),
    onSuccess: () => {
      editing = false;
      addToast({ tone: 'success', message: t('fiscal.saved', locale) });
      void queryClient.invalidateQueries({ queryKey: ['organization-fiscal', organizationId] });
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

  function submit(ev: SubmitEvent) {
    ev.preventDefault();
    if (!draft.legal_name.trim()) {
      addToast({ tone: 'warning', message: t('fiscal.legal_name_required', locale) });
      return;
    }
    if (!$save.isPending) $save.mutate();
  }
</script>

{#if visible}
  <section class="org-fiscal" aria-label={t('fiscal.title', locale)}>
    {#if !editing && !fiscal}
      <!-- Nothing on file: the block is one line, with its way in. -->
      <EmptyLine label={t('fiscal.title', locale)} text={t('fiscal.none', locale)}>
        {#if data?.can_edit}
          <button type="button" class="empty-line__act" onclick={edit}>{t('fiscal.add', locale)}</button>
        {/if}
      </EmptyLine>
    {:else}
      <BlockHead title={t('fiscal.title', locale)} {level}>
        {#if data?.can_edit && !editing}
          <button type="button" class="block-head__act" onclick={edit}>{t('fiscal.edit', locale)}</button>
        {/if}
      </BlockHead>
    {/if}

    {#if editing}
      <form class="org-fiscal__form" onsubmit={submit}>
        <Input label={t('fiscal.legal_name', locale)} bind:value={draft.legal_name} required />
        <Input label={t('fiscal.tax_id', locale)} bind:value={draft.tax_id} />
        <Input label={t('fiscal.address_line_1', locale)} bind:value={draft.address_line_1} />
        <Input label={t('fiscal.address_line_2', locale)} bind:value={draft.address_line_2} />
        <div class="org-fiscal__row">
          <Input label={t('fiscal.postal_code', locale)} bind:value={draft.postal_code} />
          <Input label={t('fiscal.city', locale)} bind:value={draft.city} />
        </div>
        <div class="org-fiscal__row">
          <Input label={t('fiscal.region', locale)} bind:value={draft.region} />
          <Input label={t('fiscal.country', locale)} bind:value={draft.country} placeholder="ES" />
        </div>
        <p class="org-fiscal__hint">{t('fiscal.hint', locale)}</p>
        <div class="org-fiscal__actions">
          <Button size="xs" variant="quiet" onclick={() => (editing = false)}>{t('create.cancel', locale)}</Button>
          <Button size="xs" type="submit" loading={$save.isPending}>{t('fiscal.save', locale)}</Button>
        </div>
      </form>
    {:else if fiscal}
      <p class="org-fiscal__summary">{receiverFiscalSummary(fiscal)}</p>
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
    .org-fiscal__row {
      display: contents;
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
