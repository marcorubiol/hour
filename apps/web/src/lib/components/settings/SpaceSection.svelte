<script lang="ts">
  /**
   * What the space decides for everyone in it (ADR-156, folding ADR-128 § 2's
   * trade and ADR-099's privacy default): how Hour names things, and whether
   * new conversations are born private. The old `?section=privacy` and
   * `?section=languages` land here (`sectionFrom`). An admin changes them;
   * the rest see them. Also who bills (ADR-168): the space's issuer fiscal
   * data, what a proforma prints as «Emisor»; the proforma links here
   * (`#fiscal`) when it is missing, and the form opens straight away.
   * And the space's saved texts (ADR-171), for «Insertar texto» in the mail,
   * and the company logo that heads its mailouts (ADR-172). And the month its
   * season starts (tarea 78), September by default.
   */
  import RecordHead from '$lib/components/RecordHead.svelte';
  import { t, appLocale } from '$lib/i18n';
  import WorkspaceTrade from './WorkspaceTrade.svelte';
  import WorkspaceSeason from './WorkspaceSeason.svelte';
  import ConversationPrivacyDefault from './ConversationPrivacyDefault.svelte';
  import FiscalIdentity from '$lib/components/FiscalIdentity.svelte';
  import WorkspaceTexts from './WorkspaceTexts.svelte';
  import WorkspaceLogo from './WorkspaceLogo.svelte';
  import { createQuery } from '@tanstack/svelte-query';
  import { toStore } from 'svelte/store';
  import { page } from '$app/state';
  import { fetchJSON } from '$lib/api';
  import { ISSUER_FISCAL_FIELDS, type WorkspaceFiscalResponse } from '$lib/fiscal';

  let { workspaceId }: { workspaceId?: string } = $props();

  const locale = appLocale();

  // Same key and endpoint as the block's own read: one request, and the
  // block's note (where the data comes from) reads the shared answer.
  let fiscalKey = $derived(['workspace-fiscal', workspaceId ?? ''] as const);
  let fiscalEndpoint = $derived(`/api/workspaces/${workspaceId}/fiscal`);
  const fiscalQuery = createQuery(
    toStore(() => ({
      queryKey: fiscalKey,
      enabled: Boolean(workspaceId),
      queryFn: ({ signal }: { signal: AbortSignal }) => fetchJSON<WorkspaceFiscalResponse>(fiscalEndpoint, signal),
    })),
  );
  let fromAccount = $derived($fiscalQuery.data?.source === 'account');
</script>

<RecordHead crumbs={[{ label: t('settings.title', locale) }, { label: t('settings.space_kicker', locale) }]} title={t('settings.nav_space', locale)}>
  {#snippet facts()}<span>{t('settings.space_sub', locale)}</span>{/snippet}
</RecordHead>

<WorkspaceTrade {workspaceId} />
<WorkspaceSeason {workspaceId} />
<ConversationPrivacyDefault {workspaceId} />

{#if workspaceId}
  <FiscalIdentity
    endpoint={fiscalEndpoint}
    queryKey={fiscalKey}
    fields={ISSUER_FISCAL_FIELDS}
    title={t('fiscal.issuer_title', locale)}
    hint={t('fiscal.issuer_hint', locale)}
    note={fromAccount ? t('fiscal.issuer_from_account', locale) : undefined}
    idPrefix="issuer-fiscal"
    level={2}
    headed
    id="fiscal"
    class="set-group"
    startEditing={page.url.hash === '#fiscal'}
  />
{/if}

{#if workspaceId}
  <WorkspaceTexts {workspaceId} />
  <WorkspaceLogo {workspaceId} />
{/if}
