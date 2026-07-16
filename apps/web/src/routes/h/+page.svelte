<script lang="ts">
  /**
   * /h — the home: the cross-space Desk digest (ADR-065 "the home IS Desk";
   * ADR-067 made it a real page instead of a trampoline to a workspace's
   * desk route). `workspaceSlug` is browsing context only — it builds links
   * (agenda "+N more", person pages); the data is pins-driven and global.
   * An account with no workspace (shouldn't happen — signup auto-creates
   * one) renders the same digest with no link context.
   */
  import { createQuery } from '@tanstack/svelte-query';
  import { workspacesQueryOptions } from '$lib/nav-queries';
  import HomeView from '$lib/components/HomeView.svelte';

  const workspacesQuery = createQuery(workspacesQueryOptions());
  let defaultWorkspaceSlug = $derived($workspacesQuery.data?.items[0]?.slug ?? '');
</script>

{#if $workspacesQuery.isSuccess}
  <HomeView workspaceSlug={defaultWorkspaceSlug} />
{/if}
