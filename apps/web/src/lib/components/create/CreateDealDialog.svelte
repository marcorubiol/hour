<script lang="ts">
  /**
   * «Nuevo bolo»: a deal recorded by hand (ADR-087). The backfill covers
   * existing gigs; this is how a deal is recorded going forward (its
   * functions are scheduled later in the Planner).
   *
   * Mounted once by the /h shell, opened through the creation store (163):
   * Cuentas' button and `?new_bolo=` lend their project; ⌘K, the scope's.
   * Outside Cuentas it asks what Cuentas gave: the project, among all.
   */
  import { createMutation, createQuery, useQueryClient } from '@tanstack/svelte-query';
  import { toStore } from 'svelte/store';
  import { untrack } from 'svelte';
  import { fetchJSON, mutateJSON } from '$lib/api';
  import Button from '$lib/components/Button.svelte';
  import Dialog from '$lib/components/Dialog.svelte';
  import Input from '$lib/components/Input.svelte';
  import Select from '$lib/components/Select.svelte';
  import { addToast } from '$lib/components/Toast.svelte';
  import { projectBolosQueryOptions } from '$lib/bolo-queries';
  import { CONVERSATIONS_WHOLE, conversationTitle, type ConversationItem } from '$lib/conversation';
  import { FormErrors } from '$lib/form-errors.svelte';
  import { appLocale, t } from '$lib/i18n';
  import { lastBoloFee } from '$lib/money';
  import { buildProjectIndex, type NavWorkspace } from '$lib/nav';
  import { activeProjectsQueryOptions, workspacesQueryOptions } from '$lib/nav-queries';
  import { spaceName } from '$lib/utils/identity';

  interface Props {
    open?: boolean;
    /** The project it opens on; absent, the first. */
    projectId?: string | null;
    currency?: string;
    /** Typed in ⌘K: the venue. */
    venue?: string;
  }
  let { open = $bindable(false), projectId = null, currency = 'EUR', venue = '' }: Props = $props();

  const locale = appLocale();
  const queryClient = useQueryClient();
  const formErrors = new FormErrors();
  const workspacesQuery = createQuery(workspacesQueryOptions());
  const projectsQuery = createQuery(activeProjectsQueryOptions());
  let projectIndex = $derived(
    buildProjectIndex(($workspacesQuery.data?.items ?? []) as NavWorkspace[], $projectsQuery.data?.items ?? []),
  );
  let dealOptions = $derived(
    projectIndex.map((p) => ({ value: p.id, label: `${p.name} · ${spaceName(p.workspaceName)}` })),
  );

  let dealProjectId = $state('');
  let dealVenue = $state('');
  let dealCity = $state('');
  let dealFee = $state('');
  let dealCurrency = $state('EUR');
  let dealFeeFilled = $state<string | null>(null);

  // Each opening starts from what the door lends.
  $effect(() => {
    if (!open) return;
    untrack(() => {
      dealProjectId = projectId && projectIndex.some((p) => p.id === projectId) ? projectId : (projectIndex[0]?.id ?? '');
      dealVenue = venue;
      dealCity = '';
      dealFee = '';
      dealFeeFilled = null;
      dealCurrency = currency;
      formErrors.clear();
    });
  });
  // The projects may answer after the dialog opened.
  $effect(() => {
    if (open && !dealProjectId && projectIndex.length > 0) {
      dealProjectId = untrack(() => (projectId && projectIndex.some((p) => p.id === projectId) ? projectId : projectIndex[0].id));
    }
  });

  // La conversación de la que nace el trato, opcional (ADR-138 § 3, ADR-102):
  // las del proyecto elegido, y al elegir una, su sala rellena lo vacío.
  let dealConversationId = $state('');
  const dealConversationsQuery = createQuery(
    toStore(() => ({
      queryKey: ['conversations', { project_ids: dealProjectId, limit: CONVERSATIONS_WHOLE, lean: 1 }] as const,
      enabled: open && Boolean(dealProjectId),
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        fetchJSON<{ items: ConversationItem[] }>(
          `/api/conversations?project_ids=${encodeURIComponent(dealProjectId)}&limit=${CONVERSATIONS_WHOLE}&lean=1`,
          signal,
        ),
    })),
  );
  let dealConversations = $derived($dealConversationsQuery.data?.items ?? []);
  let dealConversationOptions = $derived([
    { value: '', label: t('books.deal_no_conversation', locale) },
    ...dealConversations
      .map((c) => ({ value: c.id, label: conversationTitle(c) }))
      .filter((o) => o.label)
      .sort((a, b) => a.label.localeCompare(b.label, locale)),
  ]);
  // Otro proyecto, otras conversaciones: la elegida no viaja.
  $effect(() => {
    void dealProjectId;
    dealConversationId = '';
  });
  function pickDealConversation() {
    const c = dealConversations.find((x) => x.id === dealConversationId);
    if (!c?.organization) return;
    if (!dealVenue.trim()) dealVenue = c.organization.name;
    if (!dealCity.trim() && c.organization.city) dealCity = c.organization.city;
  }
  // El caché del último bolo de la obra, como relleno editable (ADR-168):
  // propuesto, nunca impuesto.
  const dealProjectBolosQuery = createQuery(toStore(() => projectBolosQueryOptions(dealProjectId, open)));
  let dealFeeProposal = $derived(
    dealProjectId ? lastBoloFee($dealProjectBolosQuery.data?.items ?? [], dealProjectId) : null,
  );
  // What the field was last filled with: while the person has not typed over
  // it, another obra's proposal replaces it; once they have, it is theirs.
  $effect(() => {
    const proposal = dealFeeProposal;
    if (!open) return;
    untrack(() => {
      const untouched = String(dealFee).trim() === '' || String(dealFee) === dealFeeFilled;
      if (!untouched) return;
      dealFee = proposal ? String(proposal.amount) : '';
      if (proposal) dealCurrency = proposal.currency;
      dealFeeFilled = proposal ? dealFee : null;
    });
  });
  let dealFeeIsProposal = $derived(dealFeeFilled !== null && String(dealFee) === dealFeeFilled);

  function feeOf(): number | null {
    const trimmed = String(dealFee).trim();
    return trimmed === '' ? null : Number(trimmed);
  }
  function submitDeal() {
    if ($createBolo.isPending) return;
    formErrors.clear();
    if (!dealProjectId) formErrors.set('deal-project', t('books.pick_project', locale));
    const fee = feeOf();
    if (fee !== null && (Number.isNaN(fee) || fee < 0)) formErrors.set('deal-fee', t('books.fee_invalid_short', locale));
    if (formErrors.any) return void formErrors.focusFirst();
    $createBolo.mutate();
  }
  const createBolo = createMutation({
    mutationFn: async () => {
      const body = await mutateJSON<{ bolo?: unknown }>('POST', '/api/money/bolos', {
        project_id: dealProjectId,
        venue_name: dealVenue.trim() || null,
        city: dealCity.trim() || null,
        fee_amount: feeOf(),
        fee_currency: dealCurrency.trim() || 'EUR',
        conversation_id: dealConversationId || null,
      });
      if (!body?.bolo) throw new Error(t('books.unexpected_response', locale));
      return body.bolo;
    },
    onSuccess: () => {
      open = false;
      void queryClient.invalidateQueries({ queryKey: ['money-bolos'] });
      void queryClient.invalidateQueries({ queryKey: ['conversation-bolos'] });
      addToast({ tone: 'success', message: t('books.deal_created', locale) });
    },
    onError: (err) => addToast({ tone: 'danger', title: t('books.deal_not_created', locale), message: err instanceof Error ? err.message : t('perf.unexpected', locale) }),
  });
</script>

<Dialog bind:open title={t('books.new_deal', locale)} size="m" description={t('books.deal_desc', locale)}>
  <form class="deal-form" novalidate oninput={formErrors.onedit} onchange={formErrors.onedit} onsubmit={(e) => { e.preventDefault(); submitDeal(); }}>
    <Select id="deal-project" label={t('books.project_obra', locale)} bind:value={dealProjectId} options={dealOptions} required error={formErrors.of('deal-project')} />
    {#if dealConversations.length > 0}
      <Select id="deal-conversation" label={t('books.deal_conversation', locale)} bind:value={dealConversationId} options={dealConversationOptions} onchange={pickDealConversation} />
    {/if}
    <Input label={t('perf.venue', locale)} bind:value={dealVenue} placeholder={t('books.ph_venue', locale)} />
    <Input label={t('create.city', locale)} bind:value={dealCity} placeholder={t('books.ph_city', locale)} />
    <Input id="deal-fee" label={t('books.fee', locale)} type="number" step="0.01" bind:value={dealFee} placeholder={t('books.ph_fee_later', locale)} helper={dealFeeIsProposal ? t('books.fee_proposed', locale) : undefined} error={formErrors.of('deal-fee')} />
    <Input label={t('books.currency', locale)} bind:value={dealCurrency} placeholder="EUR" />
    <button type="submit" hidden aria-hidden="true"></button>
  </form>
  {#snippet actions()}
    <Button variant="quiet" onclick={() => (open = false)}>{t('create.cancel', locale)}</Button>
    <Button onclick={submitDeal} loading={$createBolo.isPending}>{t('books.create_deal', locale)}</Button>
  {/snippet}
</Dialog>

<style>
  @layer components {
    /* The dialog's fields are rows, one under the other (ADR-139 p4). */
    .deal-form {
      display: flex;
      flex-direction: column;
      gap: var(--field-gap);
      margin-block-start: var(--space-s);
    }
  }
</style>
