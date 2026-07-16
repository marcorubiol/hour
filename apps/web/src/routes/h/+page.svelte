<script lang="ts">
  /**
   * /h/ — the cross-space home. Scope v2: the home IS the Desk lens (scoped
   * by pins, cross-space). We land on the default workspace's /desk as
   * browsing context — the scope itself is pins-driven, so the URL workspace
   * only builds links, it doesn't narrow the data. If the account somehow has
   * no workspace (shouldn't happen — signup auto-creates one), fall back to
   * the space-less digest.
   */
  import { createQuery } from '@tanstack/svelte-query';
  import { goto } from '$app/navigation';
  import { workspacesQueryOptions } from '$lib/nav-queries';
  import HomeView from '$lib/components/HomeView.svelte';

  const workspacesQuery = createQuery(workspacesQueryOptions());
  let defaultWorkspaceSlug = $derived($workspacesQuery.data?.items[0]?.slug ?? '');

  $effect(() => {
    if (defaultWorkspaceSlug) {
      void goto(`/h/${defaultWorkspaceSlug}/desk`, { replaceState: true });
    }
  });
</script>

{#if $workspacesQuery.isSuccess && !defaultWorkspaceSlug}
  <HomeView workspaceSlug="" />
{/if}
