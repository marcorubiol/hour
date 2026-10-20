<script lang="ts">
  /** The performance's page: the record itself, the same one the vistazo draws (ADR-139 p1). */
  import { page } from '$app/state';
  import PerformanceRecord from '$lib/components/record/PerformanceRecord.svelte';
</script>

<PerformanceRecord workspaceSlug={page.params.workspace ?? ''} slug={page.params.slug ?? ''} />
