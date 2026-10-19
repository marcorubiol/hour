<script lang="ts">
  /** The person's page: the record itself, the same one the vistazo draws (ADR-139 p1). */
  import { page } from '$app/state';
  import PersonRecord from '$lib/components/record/PersonRecord.svelte';
</script>

<PersonRecord workspaceSlug={page.params.workspace ?? ''} slug={page.params.slug ?? ''} />
