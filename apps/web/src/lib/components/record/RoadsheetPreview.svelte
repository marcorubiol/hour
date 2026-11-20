<script lang="ts">
  /**
   * RoadsheetPreview — «Ver como» (ADR-023 / ADR-224 / ADR-230): the road
   * sheet as a role will read it, inside the pass's «Compartir» dialog.
   *
   * An OPERATOR PREVIEW: filtering happens server-side per request, so
   * switching the role refetches; the browser never holds hidden sections.
   * The body is the pass in read mode (PassSheet), exactly what a public link
   * draws. Whoever can read the performance can see it, whether or not they
   * can manage links.
   */

  import { createQuery, keepPreviousData } from '@tanstack/svelte-query';
  import { toStore } from 'svelte/store';
  import { fetchJSON } from '$lib/api';
  import { retryLoad } from '$lib/load-fail';
  import RecordState from '$lib/components/RecordState.svelte';
  import Segmented from '$lib/components/Segmented.svelte';
  import PassSheet from './PassSheet.svelte';
  import { appLocale, t, type Locale } from '$lib/i18n';
  import { ROADSHEET_ROLES, type Roadsheet, type RoadsheetRole } from '$lib/roadsheet';

  type Response = { roadsheet: Roadsheet; venue_timezone: string | null };

  let {
    workspaceSlug,
    slug,
    role = $bindable('full'),
    locale = appLocale(),
  }: {
    workspaceSlug: string;
    slug: string;
    role?: RoadsheetRole;
    locale?: Locale;
  } = $props();

  /** The word for a road sheet role; the raw value with spaces if unknown. */
  function roleWord(r: string): string {
    const key = `roadsheet.role_${r}`;
    const word = t(key, locale);
    return word === key ? r.replace(/_/g, ' ') : word;
  }

  const options = $derived(ROADSHEET_ROLES.map((r) => ({ value: r, label: roleWord(r) })));

  const queryOptions = toStore(() => {
    const k = { ws: workspaceSlug, slug, role };
    return {
      queryKey: ['roadsheet', k] as const,
      retry: retryLoad,
      // Switching the role keeps the sheet on screen until the next one lands.
      placeholderData: keepPreviousData,
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        fetchJSON<Response>(
          `/api/performances/${encodeURIComponent(k.slug)}/roadsheet?ws=${encodeURIComponent(k.ws)}&role=${k.role}`,
          signal,
        ),
    };
  });

  const query = createQuery(queryOptions);

  let sheet = $derived($query.data?.roadsheet ?? null);
  let venueTz = $derived($query.data?.venue_timezone ?? null);
  let loading = $derived($query.isPending);
</script>

<div class="rsp" data-testid="pass-share-preview" aria-busy={loading}>
  <div class="rsp__roles">
    <span class="rsp__label">{t('roadsheet.view_as', locale)}</span>
    <Segmented
      {options}
      bind:value={role}
      ariaLabel={t('roadsheet.preview_as', locale)}
      optionTestid={(r) => `pass-share-role-${r}`}
    />
  </div>

  {#if loading || ($query.isError && !sheet)}
    <RecordState
      {loading}
      error={$query.error}
      missingText={t('roadsheet.not_found', locale)}
      failedText={t('roadsheet.load_error', locale)}
      onretry={() => void $query.refetch()}
      {locale}
    />
  {:else if sheet}
    <PassSheet {sheet} {venueTz} {locale} heading={false} />
  {/if}
</div>

<style>
  @layer components {
    .rsp {
      display: flex;
      flex-direction: column;
      gap: var(--space-m);
      min-inline-size: 0;
    }

    .rsp__roles {
      display: flex;
      flex-direction: column;
      gap: var(--space-2xs);
      min-inline-size: 0;
    }

    .rsp__label {
      font-family: var(--font-mono);
      font-size: var(--text-xs);
      letter-spacing: var(--tracking-s);
      color: var(--text-faint);
    }
  }
</style>
