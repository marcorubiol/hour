<script lang="ts">
  /**
   * /h/[workspace]/ — the space portada: a space masthead (name · about ·
   * stats) over this space's agenda + projects. HomeView is portada-only
   * since 2026-07-17 (the cross-space digest died with the hall; /h greets
   * and its door goes to /h/desk).
   */
  import { page } from '$app/state';
  import HomeView from '$lib/components/HomeView.svelte';
</script>

<HomeView workspaceSlug={page.params.workspace ?? ''} />
