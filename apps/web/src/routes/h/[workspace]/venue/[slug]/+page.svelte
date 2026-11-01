<script lang="ts">
  /** The venue's page: the record itself, the same one the vistazo draws (ADR-139 p1, ADR-164). */
  import { page } from '$app/state';
  import VenueRecord from '$lib/components/record/VenueRecord.svelte';
</script>

<VenueRecord workspaceSlug={page.params.workspace ?? ''} slug={page.params.slug ?? ''} />
