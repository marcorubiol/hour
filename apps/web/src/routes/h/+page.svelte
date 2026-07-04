<script lang="ts">
  /**
   * /h/ — bare home. The logo lands here (or on /h/[ws]/). Since the agenda
   * is cross-workspace, /h/ just forwards to the first workspace's agenda so
   * the person-links etc. have a browsing context. No more "pick a workspace
   * from the sidebar" — the sidebar is gone (ADR-055).
   */

  import { createQuery } from '@tanstack/svelte-query';
  import { goto } from '$app/navigation';
  import { workspacesQueryOptions } from '$lib/nav-queries';

  const workspacesQuery = createQuery(workspacesQueryOptions());

  $effect(() => {
    const first = $workspacesQuery.data?.items[0]?.slug;
    if (first) void goto(`/h/${first}/`, { replaceState: true });
  });
</script>

<svelte:head><title>Hour</title></svelte:head>

<p class="loading">Loading…</p>

<style>
  @layer components {
    .loading {
      color: var(--text-faint);
      font-style: italic;
      font-family: var(--font-display);
      padding-block: var(--space-xl);
      text-align: center;
    }
  }
</style>
