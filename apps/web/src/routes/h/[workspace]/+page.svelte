<script lang="ts">
  /**
   * /h/[workspace]/ — the space portada. HomeView in `asSpace` mode: a space
   * masthead (name · about · stats) over the same digest (agenda + projects),
   * scoped to this workspace. /h/ renders the same component without a space
   * (the cross-space home).
   */
  import { page } from '$app/state';
  import HomeView from '$lib/components/HomeView.svelte';
</script>

<HomeView workspaceSlug={page.params.workspace ?? ''} asSpace />
