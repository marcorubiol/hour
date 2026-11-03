<script lang="ts">
  /** A bolo's thread opened alone, as a group (punto 110): `?hilo=` is its facet, none the General. */
  import { page } from '$app/state';
  import BoloGroup from '$lib/components/BoloGroup.svelte';
</script>

<BoloGroup
  workspaceSlug={page.params.workspace ?? ''}
  performanceId={page.params.performanceId ?? ''}
  facetId={page.url.searchParams.get('hilo') || null}
/>
