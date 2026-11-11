<script lang="ts">
  /**
   * /h/[workspace]/ — the space portada: a space masthead (name · about ·
   * stats) over this space's agenda + projects. HomeView is portada-only
   * since 2026-07-17 (the cross-space digest died with the hall; /h greets
   * and its door goes to /h/desk).
   *
   * A space you do not belong to (or that does not exist: the two are not
   * told apart, ADR-106) says so, with the way back to Hoy (tarea 132): it
   * used to draw an empty «Proyectos» with «+ Nuevo proyecto». An alias is
   * not unknown: the shell swaps it for the slug (ADR-067).
   */
  import { page } from '$app/state';
  import { createQuery } from '@tanstack/svelte-query';
  import HomeView from '$lib/components/HomeView.svelte';
  import RecordState from '$lib/components/RecordState.svelte';
  import { ApiError, fetchJSON } from '$lib/api';
  import { docTitle } from '$lib/doc-title';
  import { appLocale, t } from '$lib/i18n';

  const locale = appLocale();
  let slug = $derived(page.params.workspace ?? '');

  // The shell's own list (same key and shape): no second request.
  const workspacesQuery = createQuery({
    queryKey: ['workspaces'],
    queryFn: ({ signal }) =>
      fetchJSON<{ items: { slug: string; alias?: string | null }[] }>('/api/workspaces', signal),
  });
  let known = $derived.by(() => {
    const items = $workspacesQuery.data?.items;
    if (!items) return null;
    return items.some((w) => w.slug === slug || w.alias === slug);
  });
</script>

<svelte:head>
  {#if known === false}<title>{docTitle(t('space.missing', locale))}</title>{/if}
</svelte:head>

{#if known === false}
  <RecordState
    loading={false}
    error={new ApiError(404, 'Not found')}
    missingText={t('space.missing', locale)}
    failedText={t('ui.failed', locale)}
    onretry={() => void $workspacesQuery.refetch()}
    back={{ href: '/h/desk', label: t('ui.back_today', locale) }}
    {locale}
  />
{:else if known}
  <HomeView workspaceSlug={slug} />
{:else if $workspacesQuery.isError}
  <RecordState
    loading={false}
    error={$workspacesQuery.error}
    missingText={t('space.missing', locale)}
    failedText={t('ui.failed', locale)}
    onretry={() => void $workspacesQuery.refetch()}
    back={{ href: '/h/desk', label: t('ui.back_today', locale) }}
    {locale}
  />
{:else}
  <RecordState loading={true} error={null} missingText="" failedText="" onretry={() => {}} {locale} />
{/if}
